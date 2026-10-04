from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from catalog.models import Worker
from labor.calculation import calculate, calculate_v2, allocate_individuals, DAILY_SERVICE_PRICES
from labor.constants import FLOOR, LABELS, PRICES, RATE_TABLE
from labor.bulletin import snapshot_summary
from labor.models import (
    BulletinLine,
    BulletinParticipant,
    BulletinRevision,
    DailyBulletin,
    ServiceRate,
    WorkerDay,
    BulletinDailyService,
    IndividualAllocation,
)


def service_rates():
    stored = {rate.code: rate.price for rate in ServiceRate.objects.all()}
    return {code: stored.get(code, price) for code, price in PRICES.items()}


def values(bulletin):
    pending_rule = bulletin.rule_occurrences.filter(resolved_at=None).exists()
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
    daily_services = [{"kind": item.kind, "quantity": str(item.quantity), "price": str(item.price)}
                      for item in bulletin.daily_services.all()]
    sources = [{"id": str(item.id), "source_key": item.source_key, "category": item.category,
                "movement": item.movement, "quantity": str(item.quantity), "price": str(item.price)}
               for item in bulletin.production_records.all()]
    calculation = bulletin.calculation if bulletin.status == "CLOSED" else (
        calculate_v2(lines, people, bulletin.floor_per_day, daily_services, sources)
        if bulletin.financial_version == "boletim-v2" else calculate(lines, people, bulletin.floor_per_day)
    )
    if bulletin.financial_version == "boletim-v2":
        calculation = {**calculation, "resumo": snapshot_summary(calculation)}
    allocations = [dict(worker=str(item.worker_id), fraction=str(item.fraction), exact=item.exact,
                        display=item.display, policy_version=item.policy_version)
                   for item in bulletin.allocations.filter(active=True)] if bulletin.status == "CLOSED" else (
        allocate_individuals(calculation, people) if bulletin.financial_version == "boletim-v2" else []
    )
    if pending_rule:
        allocations = []
        calculation = {**calculation, "status": "pending_rule", "provisional": True}
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
        "calculation": calculation,
        "financial_version": bulletin.financial_version,
        "daily_services": daily_services,
        "production_records": sources,
        "individual_allocations": allocations,
        "allocation_status": "pending_rule" if pending_rule else "closed" if allocations and bulletin.status == "CLOSED" else (
            "preview" if allocations else "legacy_unallocated" if bulletin.status == "CLOSED" else "no_team"
        ),
        "unresolved_occurrences": [dict(id=str(issue.pk), worker=str(issue.worker_id) if issue.worker_id else None,
                                        code=issue.code, description=issue.description,
                                        proposed_fraction=str(issue.proposed_fraction) if issue.proposed_fraction is not None else None,
                                        started_at=issue.started_at.isoformat() if issue.started_at else None,
                                        finished_at=issue.finished_at.isoformat() if issue.finished_at else None,
                                        activity=str(issue.activity_id) if issue.activity_id else None,
                                        created_by=issue.created_by_id)
                                   for issue in bulletin.rule_occurrences.filter(resolved_at=None)],
        "closed_at": bulletin.closed_at.isoformat() if bulletin.closed_at else None,
    }


def preview(data):
    rates = service_rates()
    return calculate(
        [{**line, "price": rates[line["category"]]} for line in data["lines"]],
        data["participants"],
        FLOOR,
    )


@transaction.atomic
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
        people = data["participants"]
        worker_ids = [p["worker"].pk for p in people] + list(bulletin.participants.values_list("worker_id", flat=True))
        list(Worker.objects.select_for_update().filter(pk__in=worker_ids).order_by("pk"))
        existing_ids = set(bulletin.participants.values_list("worker_id", flat=True))
        if any(not p["worker"].is_active and p["worker"].pk not in existing_ids for p in people):
            raise ValidationError({"participants": "Pessoa inativa não pode receber nova alocação."})
        prepared = []
        for person in people:
            if bulletin.financial_version == "boletim-v2":
                conflict = BulletinParticipant.objects.filter(
                    worker=person["worker"], bulletin__reference_date=bulletin.reference_date,
                    bulletin__origin=bulletin.origin,
                ).exclude(bulletin=bulletin).first()
                if conflict:
                    raise ValidationError({"participants": "Pessoa já pertence a outro boletim nesta data. Use transferência auditada.",
                                           "conflicting_bulletin": str(conflict.bulletin_id)})
                day, _ = WorkerDay.objects.get_or_create(
                    worker=person["worker"], reference_date=bulletin.reference_date, origin=bulletin.origin
                )
                prepared.append({**person, "worker_day": day})
            else:
                prepared.append(person)
        bulletin.participants.all().delete()
        BulletinParticipant.objects.bulk_create(
            [BulletinParticipant(bulletin=bulletin, **person) for person in prepared]
        )
    if "daily_services" in data:
        bulletin.daily_services.all().delete()
        BulletinDailyService.objects.bulk_create([
            BulletinDailyService(bulletin=bulletin, price=DAILY_SERVICE_PRICES[item["kind"]], **item)
            for item in data["daily_services"]
        ])


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
    if bulletin.rule_occurrences.filter(resolved_at=None).exists():
        raise ValidationError({"rule_occurrences": "Há regra pendente neste boletim. Os demais boletins podem fechar."})
    people = list(bulletin.participants.select_related("worker"))
    if not people:
        raise ValidationError("Informe a equipe antes de fechar. Sem atividade permanece rascunho.")
    if bulletin.financial_version == "boletim-v2":
        replace_contents(bulletin, {"participants": [{"worker": p.worker, "fraction": p.fraction} for p in people]})
        people = list(bulletin.participants.select_related("worker"))
    worker_ids = [person.worker_id for person in people]
    list(
        Worker.objects.select_for_update().filter(pk__in=worker_ids).order_by("registration", "pk")
    )
    existing = dict(
        BulletinParticipant.objects.filter(
            worker_id__in=worker_ids,
            bulletin__reference_date=bulletin.reference_date,
            bulletin__status="CLOSED",
            bulletin__origin=bulletin.origin,
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
    if bulletin.financial_version == "boletim-v2":
        by_worker = {str(p.worker_id): p for p in people}
        IndividualAllocation.objects.bulk_create([
            IndividualAllocation(
                bulletin=bulletin, worker_id=item["worker"], worker_day=by_worker[item["worker"]].worker_day,
                bulletin_revision=bulletin.revision, fraction=item["fraction"], exact=item["exact"],
                display=item["display"], total_payable=item["display"]["total_payable"],
                policy_version=item["policy_version"],
            ) for item in payload["individual_allocations"]
        ])
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
    bulletin.allocations.filter(active=True).update(active=False)
    bulletin.closed_at = None
    bulletin.revision += 1
    bulletin.save(update_fields=["status", "closed_at", "revision"])
    return bulletin
