from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from catalog.models import Worker
from labor.calculation import calculate
from labor.constants import FLOOR, LABELS, PRICES, RATE_TABLE
from labor.models import (
    BulletinLine,
    BulletinParticipant,
    BulletinRevision,
    DailyBulletin,
    ServiceRate,
)


def service_rates():
    stored = {rate.code: rate.price for rate in ServiceRate.objects.all()}
    return {code: stored.get(code, price) for code, price in PRICES.items()}


def values(bulletin):
    lines = [
        {
            "category": line.category,
            "label": LABELS[line.category],
            "unloading": str(line.unloading),
            "removal": str(line.removal),
            "transfer": str(line.transfer),
            "price": str(line.price),
        }
        for line in bulletin.lines.all()
    ]
    people = [
        {
            "worker": str(p.worker_id),
            "registration": p.worker.registration,
            "name": p.worker.name,
            "fraction": str(p.fraction),
        }
        for p in bulletin.participants.select_related("worker")
    ]
    return {
        "id": str(bulletin.pk),
        "warehouse": str(bulletin.warehouse_id),
        "warehouse_name": bulletin.warehouse.name,
        "reference_date": bulletin.reference_date.isoformat(),
        "origin": bulletin.origin,
        "status": bulletin.status,
        "revision": bulletin.revision,
        "lines": lines,
        "participants": people,
        "calculation": bulletin.calculation
        if bulletin.status == "CLOSED"
        else calculate(lines, people, bulletin.floor_per_day),
        "closed_at": bulletin.closed_at.isoformat() if bulletin.closed_at else None,
    }


def preview(data):
    rates = service_rates()
    return calculate(
        [{**line, "price": rates[line["category"]]} for line in data["lines"]],
        data["participants"],
        FLOOR,
    )


def replace_contents(bulletin, data):
    if "lines" in data:
        rates = service_rates()
        bulletin.lines.all().delete()
        indexed = {line["category"]: line for line in data["lines"]}
        BulletinLine.objects.bulk_create(
            [
                BulletinLine(
                    bulletin=bulletin,
                    category=code,
                    price=rates[code],
                    **{
                        key: indexed.get(code, {}).get(key, Decimal(0))
                        for key in ("unloading", "removal", "transfer")
                    },
                )
                for code, _, _ in RATE_TABLE
            ]
        )
    if "participants" in data:
        bulletin.participants.all().delete()
        BulletinParticipant.objects.bulk_create(
            [BulletinParticipant(bulletin=bulletin, **person) for person in data["participants"]]
        )


def check_revision(bulletin, expected):
    revision = None
    if isinstance(expected, int) and not isinstance(expected, bool):
        revision = expected
    elif isinstance(expected, str) and expected.isascii() and expected.isdigit():
        revision = int(expected)
    if revision != bulletin.revision:
        raise ValidationError(
            {"revision": "Registro atualizado por outro operador. Recarregue antes de salvar."},
            code="REVISION_CONFLICT",
        )


@transaction.atomic
def close_bulletin(bulletin_id, actor, expected):
    bulletin = (
        DailyBulletin.objects.select_for_update().select_related("warehouse").get(pk=bulletin_id)
    )
    check_revision(bulletin, expected)
    if bulletin.status != "DRAFT":
        raise ValidationError("O boletim já está fechado.")
    people = list(bulletin.participants.select_related("worker"))
    if not people:
        raise ValidationError("Informe a equipe antes de fechar. Sem atividade permanece rascunho.")
    worker_ids = [person.worker_id for person in people]
    list(
        Worker.objects.select_for_update().filter(pk__in=worker_ids).order_by("registration", "pk")
    )
    existing = dict(
        BulletinParticipant.objects.filter(
            worker_id__in=worker_ids,
            bulletin__reference_date=bulletin.reference_date,
            bulletin__status="CLOSED",
        )
        .exclude(bulletin=bulletin)
        .values("worker_id")
        .annotate(total=Sum("fraction"))
        .values_list("worker_id", "total")
    )
    conflicts = [
        p.worker.registration
        for p in people
        if existing.get(p.worker_id, Decimal(0)) + p.fraction > Decimal(1)
    ]
    if conflicts:
        raise ValidationError(
            {
                "participants": "Rateio provisório excede 1 diária por matrícula/data: "
                + ", ".join(conflicts)
            }
        )
    payload = values(bulletin)
    bulletin.calculation = payload["calculation"]
    bulletin.status = "CLOSED"
    bulletin.closed_at = timezone.now()
    bulletin.revision += 1
    bulletin.save(update_fields=["calculation", "status", "closed_at", "revision"])
    BulletinRevision.objects.create(
        bulletin=bulletin,
        revision=bulletin.revision,
        actor=actor,
        reason="Fechamento",
        snapshot=values(bulletin),
    )
    return bulletin


@transaction.atomic
def reopen_bulletin(bulletin_id, actor, expected, reason):
    if not reason or not str(reason).strip():
        raise ValidationError({"reason": "Descreva o motivo da reabertura."})
    bulletin = (
        DailyBulletin.objects.select_for_update().select_related("warehouse").get(pk=bulletin_id)
    )
    check_revision(bulletin, expected)
    if bulletin.status != "CLOSED":
        raise ValidationError("Somente um boletim fechado pode ser reaberto.")
    list(
        Worker.objects.select_for_update()
        .filter(pk__in=bulletin.participants.values("worker_id"))
        .order_by("registration", "pk")
    )
    BulletinRevision.objects.create(
        bulletin=bulletin,
        revision=bulletin.revision,
        actor=actor,
        reason=str(reason).strip(),
        snapshot=values(bulletin),
    )
    bulletin.status = "DRAFT"
    bulletin.closed_at = None
    bulletin.revision += 1
    bulletin.save(update_fields=["status", "closed_at", "revision"])
    return bulletin
