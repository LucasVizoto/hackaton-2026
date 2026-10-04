"""Tabela de tarifas com vigência, ajustes individuais e acerto da quinzena.

"Apurado" não é "pago": estes valores justificam a produção; o pagamento oficial continua com o RH.
"""
import calendar
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Worker
from core.models import ORIGIN_CHOICES
from core.permissions import IsInternal, require_role
from labor.constants import FLOOR, LABELS, RATE_TABLE
from labor.models import DailyBulletin, IndividualAllocation, TariffRate, TariffTable, WorkerAdjustment
from labor.services import adjustment_values, tariffs_on
from receiving.models import Holiday


def tariff_values(table):
    rates = {rate.code: rate.price for rate in table.rates.all()}
    return {"id": str(table.pk), "valid_from": table.valid_from.isoformat(), "floor_per_day": str(table.floor_per_day),
            "notes": table.notes, "approved_by": table.approved_by.get_username(),
            "created_at": table.created_at.isoformat(),
            "rates": [{"code": code, "label": label, "price": str(rates[code])} for code, label, _ in RATE_TABLE
                      if code in rates]}


class TariffInput(serializers.Serializer):
    valid_from = serializers.DateField()
    floor_per_day = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal(0))
    notes = serializers.CharField(max_length=2000, allow_blank=True, required=False)
    rates = serializers.DictField(child=serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal(0)))

    def validate_rates(self, value):
        expected = {code for code, _, _ in RATE_TABLE}
        if set(value) != expected:
            raise serializers.ValidationError("Informe a tarifa das 14 categorias, sem categorias extras.")
        return value


class TariffTableView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        on = request.query_params.get("date")
        day = serializers.DateField().run_validation(on) if on else timezone.localdate()
        current = tariffs_on(day)
        return Response({
            "date": day.isoformat(),
            "current": {"table": current["table"], "valid_from": current["valid_from"],
                        "floor_per_day": str(current["floor"]),
                        "rates": [{"code": code, "label": LABELS[code], "price": str(current["rates"][code])}
                                  for code, _, _ in RATE_TABLE]},
            "default_floor": str(FLOOR),
            "tables": [tariff_values(table) for table in
                       TariffTable.objects.select_related("approved_by").prefetch_related("rates")],
        })

    @transaction.atomic
    def post(self, request):
        # Reajuste é decisão aprovada; vale a partir da data e nunca muda um dia já fechado (snapshot).
        require_role(request.user, "management")
        serializer = TariffInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            with transaction.atomic():
                table = TariffTable.objects.create(valid_from=data["valid_from"], floor_per_day=data["floor_per_day"],
                                                   notes=data.get("notes", ""), approved_by=request.user)
        except IntegrityError:
            raise ValidationError({"valid_from": "Já existe tabela com esta vigência."}) from None
        TariffRate.objects.bulk_create([TariffRate(table=table, code=code, price=price)
                                        for code, price in data["rates"].items()])
        return Response(tariff_values(table), status=201)


class AdjustmentInput(serializers.Serializer):
    worker = serializers.PrimaryKeyRelatedField(queryset=Worker.objects.all())
    reference_date = serializers.DateField()
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")
    kind = serializers.ChoiceField(choices=WorkerAdjustment.KINDS)
    amount = serializers.DecimalField(max_digits=18, decimal_places=2)
    reason = serializers.CharField(max_length=2000)

    def validate_amount(self, value):
        if value == 0:
            raise serializers.ValidationError("Informe um valor diferente de zero (negativo para desconto).")
        return value

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("Descreva o motivo do ajuste.")
        return value.strip()


class AdjustmentListView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        query = WorkerAdjustment.objects.select_related("worker", "created_by")
        params = request.query_params
        if params.get("worker"):
            query = query.filter(worker_id=serializers.UUIDField().run_validation(params["worker"]))
        if params.get("date_from"):
            query = query.filter(reference_date__gte=serializers.DateField().run_validation(params["date_from"]))
        if params.get("date_to"):
            query = query.filter(reference_date__lte=serializers.DateField().run_validation(params["date_to"]))
        if params.get("include_cancelled") != "true":
            query = query.filter(cancelled_at=None)
        return Response({"results": [adjustment_values(item) for item in query[:500]]})

    @transaction.atomic
    def post(self, request):
        require_role(request.user, "warehouse")
        serializer = AdjustmentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        bulletin = DailyBulletin.objects.filter(
            reference_date=data["reference_date"], origin=data["origin"], participants__worker=data["worker"],
        ).first()
        if bulletin is None:
            raise ValidationError({"worker": "A pessoa não está em nenhum boletim desta data. Ajuste exige participação."})
        item = WorkerAdjustment.objects.create(**data, bulletin=bulletin, created_by=request.user)
        return Response(adjustment_values(item), status=201)


class AdjustmentCancelView(APIView):
    permission_classes = [IsInternal]

    @transaction.atomic
    def post(self, request, pk):
        require_role(request.user, "warehouse")
        item = get_object_or_404(WorkerAdjustment.objects.select_for_update(), pk=pk)
        reason = serializers.CharField(max_length=2000).run_validation(request.data.get("reason"))
        if item.cancelled_at:
            raise ValidationError("Ajuste já cancelado.")
        item.cancelled_at, item.cancelled_by, item.cancel_reason = timezone.now(), request.user, reason
        item.save(update_fields=["cancelled_at", "cancelled_by", "cancel_reason"])
        return Response(adjustment_values(item))


def fortnight_bounds(day):
    """Folha da Cocapec: 1 a 15 e 16 ao fim do mês."""
    if day.day <= 15:
        return date(day.year, day.month, 1), date(day.year, day.month, 15), 1
    last = calendar.monthrange(day.year, day.month)[1]
    return date(day.year, day.month, 16), date(day.year, day.month, last), 2


class FortnightSettlementView(APIView):
    """Soma os valores diários de cada chapa na quinzena, mais os ajustes. Dia sem boletim = "sem dado"."""
    permission_classes = [IsInternal]

    def get(self, request):
        params = request.query_params
        day = serializers.DateField().run_validation(params["date"]) if params.get("date") else timezone.localdate()
        origin = serializers.ChoiceField(choices=ORIGIN_CHOICES).run_validation(
            params.get("origin", "operacional_registrado"))
        start, end, half = fortnight_bounds(day)
        dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]
        holidays = set(Holiday.objects.filter(date__range=(start, end)).values_list("date", flat=True))
        bulletins = defaultdict(list)
        for bulletin in DailyBulletin.objects.filter(reference_date__range=(start, end), origin=origin):
            bulletins[bulletin.reference_date].append(bulletin)
        day_rows = []
        for current in dates:
            items = bulletins.get(current, [])
            if items and all(b.status == "CLOSED" for b in items):
                status = "fechado"
            elif items:
                status = "rascunho"
            elif current.weekday() == 6 or current in holidays:
                status = "sem_expediente"
            else:
                status = "sem_dado"
            day_rows.append({"date": current.isoformat(), "weekday": current.weekday(), "status": status,
                             "holiday": current in holidays,
                             "bulletins": [str(b.pk) for b in items]})
        allocations = IndividualAllocation.objects.filter(
            active=True, bulletin__status="CLOSED", bulletin__origin=origin,
            bulletin__reference_date__range=(start, end),
        ).select_related("worker", "bulletin")
        adjustments = WorkerAdjustment.objects.filter(
            cancelled_at=None, origin=origin, reference_date__range=(start, end)).select_related("worker", "created_by")
        workers = {}

        def row(worker):
            return workers.setdefault(str(worker.pk), {
                "worker": str(worker.pk), "registration": worker.registration, "name": worker.name,
                "contract_type": worker.contract_type, "days": {}, "equivalent_days": Decimal(0),
                "base_total": Decimal(0), "adjustments": [], "adjustments_total": Decimal(0)})

        for allocation in allocations:
            entry = row(allocation.worker)
            key = allocation.bulletin.reference_date.isoformat()
            value = Decimal(allocation.display["total_payable"])
            previous = entry["days"].get(key)
            entry["days"][key] = {"value": format(value + (Decimal(previous["value"]) if previous else 0), ".2f"),
                                  "fraction": str(allocation.fraction)}
            entry["equivalent_days"] += allocation.fraction
            entry["base_total"] += value
        for adjustment in adjustments:
            entry = row(adjustment.worker)
            entry["adjustments"].append(adjustment_values(adjustment))
            entry["adjustments_total"] += adjustment.amount
        rows = []
        for entry in sorted(workers.values(), key=lambda item: item["registration"]):
            total = entry["base_total"] + entry["adjustments_total"]
            rows.append({**entry, "equivalent_days": format(entry["equivalent_days"], "f"),
                         "base_total": format(entry["base_total"], ".2f"),
                         "adjustments_total": format(entry["adjustments_total"], ".2f"),
                         "total": format(total, ".2f")})
        base = sum((Decimal(r["base_total"]) for r in rows), Decimal(0))
        extra = sum((Decimal(r["adjustments_total"]) for r in rows), Decimal(0))
        return Response({
            "period": {"date_from": start.isoformat(), "date_to": end.isoformat(), "half": half,
                       "label": f"{half}ª quinzena de {start.month:02}/{start.year}"},
            "origin": origin, "days": day_rows, "workers": rows,
            "totals": {"base": format(base, ".2f"), "adjustments": format(extra, ".2f"),
                       "total": format(base + extra, ".2f"),
                       "days_without_data": sum(1 for d in day_rows if d["status"] == "sem_dado"),
                       "draft_days": sum(1 for d in day_rows if d["status"] == "rascunho")},
            "notes": ["Apurado não é pago: o pagamento oficial continua com o RH.",
                      "Dia sem boletim aparece como \"sem dado\", nunca como R$ 0.",
                      "Ajustes não alteram produção, piso nem complemento do boletim."],
        })
