"""Sobra ou falta de chapas: cruza o que a agenda exigia, o que foi escalado e o que o boletim pagou.

Leitura combinada do PRD: sobra é a equipe paga pelo piso sem produção que justifique, enquanto a agenda
exigia menos pessoas; falta é produção alta por pessoa, caminhões esperando e descargas atrasando.
O complemento é o sinal mais confiável de sobra; a agenda aponta quando e onde, sem fechar a conta sozinha.
"""
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal, localcontext

from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from analytics.views import cost_shares, financial_summary
from core.models import ORIGIN_CHOICES
from core.permissions import IsInternal
from labor.allocation import WORKDAY_END
from labor.allocation_service import day_plan
from labor.calculation import money_display
from labor.constants import FLOOR
from labor.models import DailyBulletin, RosterShift
from receiving.models import Appointment

HIGH_PRODUCTIVITY = Decimal("1.2")
LONG_WAIT_MINUTES = 60


class BalanceFilters(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")

    def validate(self, data):
        today = timezone.localdate()
        data.setdefault("date_to", today)
        data.setdefault("date_from", data["date_to"] - timedelta(days=29))
        if data["date_from"] > data["date_to"] or (data["date_to"] - data["date_from"]).days > 92:
            raise serializers.ValidationError("Informe um período de até 93 dias, com início antes do fim.")
        return data


def _minutes(delta):
    return delta.total_seconds() / 60


def signal(days_with_bulletin, below_floor_days, avg_paid, avg_required, high_productivity_days, avg_wait, after_hours):
    if not days_with_bulletin:
        return {"status": "sem_dado", "message": "Sem boletins fechados no período: não há base para concluir."}
    below_share = below_floor_days / days_with_bulletin
    if below_share >= Decimal("0.5") and avg_required is not None and avg_paid > avg_required:
        return {"status": "sobra", "message": f"Complemento em {below_share:.0%} dos dias e equipe paga ({avg_paid:.1f}) "
                                              f"acima do pico exigido pela agenda ({avg_required:.1f})."}
    pressure = high_productivity_days / days_with_bulletin >= Decimal("0.5")
    if pressure and ((avg_wait is not None and avg_wait >= LONG_WAIT_MINUTES) or after_hours):
        return {"status": "falta", "message": "Produção por diária muito acima do piso, com espera longa ou descargas "
                                              "após o expediente."}
    if pressure:
        return {"status": "atencao", "message": "Produção por diária alta; acompanhe a espera dos caminhões."}
    return {"status": "equilibrio", "message": "Sem sinal recorrente de sobra ou falta no período."}


class StaffingBalanceView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        filters = BalanceFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        start, end, origin = data["date_from"], data["date_to"], data["origin"]
        bulletins = list(DailyBulletin.objects.filter(status="CLOSED", origin=origin, reference_date__range=(start, end))
                         .select_related("warehouse").prefetch_related("participants"))
        drafts = set(DailyBulletin.objects.filter(status="DRAFT", origin=origin, reference_date__range=(start, end))
                     .values_list("reference_date", flat=True))
        by_day = defaultdict(list)
        for bulletin in bulletins:
            by_day[bulletin.reference_date].append(bulletin)
        roster = defaultdict(Decimal)
        for shift in RosterShift.objects.filter(origin=origin, date__range=(start, end)).exclude(attendance="ABSENT"):
            roster[shift.date] += shift.fraction
        waits, after_hours_by_day = defaultdict(list), defaultdict(int)
        for appointment in Appointment.objects.filter(origin=origin, slot__date__range=(start, end)).only(
                "arrived_at", "started_at", "finished_at", "slot__date").select_related("slot"):
            day = appointment.slot.date
            if appointment.arrived_at and appointment.started_at and appointment.started_at >= appointment.arrived_at:
                waits[day].append(_minutes(appointment.started_at - appointment.arrived_at))
            if appointment.finished_at:
                local = timezone.localtime(appointment.finished_at)
                if local.time() > WORKDAY_END or local.date() > day:
                    after_hours_by_day[day] += 1
        rows = []
        current = start
        while current <= end:
            plan = day_plan(current, origin)
            local = by_day.get(current, [])
            summary = financial_summary(local) if local else None
            with localcontext() as ctx:
                ctx.prec = 40
                per_day = Decimal(summary["production_per_equivalent_day"]) if summary and summary[
                    "production_per_equivalent_day"] else None
            day_waits = waits.get(current, [])
            rows.append({
                "date": current.isoformat(), "day_type": plan["day_type"],
                "status": "fechado" if local else "rascunho" if current in drafts else "sem_dado",
                "required_peak": plan["peak_chapas"], "loads": plan["loads"], "person_hours": plan["person_hours"],
                "scheduled": format(roster[current], "f") if current in roster else None,
                "paid_equivalents": summary["equivalent_days"] if summary else None,
                "production": summary["display"]["production"] if summary else None,
                "total_payable": summary["display"]["total_payable"] if summary else None,
                "supplement": summary["display"]["supplement"] if summary else None,
                "below_floor": bool(summary and Decimal(summary["supplement"]) > 0),
                "production_per_equivalent_day": money_display(per_day) if per_day is not None else None,
                "avg_wait_minutes": round(sum(day_waits) / len(day_waits)) if day_waits else None,
                "after_hours_unloads": after_hours_by_day.get(current, 0),
                "planned_after_hours": plan["after_hours_loads"],
            })
            current += timedelta(days=1)
        closed = [r for r in rows if r["status"] == "fechado"]
        below = sum(1 for r in closed if r["below_floor"])
        high = sum(1 for r in closed if r["production_per_equivalent_day"]
                   and Decimal(r["production_per_equivalent_day"]) > FLOOR * HIGH_PRODUCTIVITY)
        paid = [Decimal(r["paid_equivalents"]) for r in closed]
        required = [Decimal(r["required_peak"]) for r in closed if r["day_type"] == "workday"]
        all_waits = [w for values in waits.values() for w in values]
        avg_wait = Decimal(str(round(sum(all_waits) / len(all_waits)))) if all_waits else None
        after_hours = sum(after_hours_by_day.values())
        avg_paid = sum(paid, Decimal(0)) / len(paid) if paid else None
        avg_required = sum(required, Decimal(0)) / len(required) if required else None
        groups = defaultdict(list)
        for share in cost_shares(bulletins):
            groups[(share.warehouse_id, share.warehouse_name)].append(share)
        warehouses = []
        for (wid, name), shares in sorted(groups.items(), key=lambda item: item[0][1]):
            result = financial_summary(shares)
            warehouses.append({"warehouse": wid, "warehouse_name": name,
                               "total_payable": result["display"]["total_payable"],
                               "supplement": result["display"]["supplement"],
                               "production": result["display"]["production"]})
        totals = financial_summary(bulletins)
        return Response({
            "period": {"date_from": start.isoformat(), "date_to": end.isoformat()}, "origin": origin,
            "synthetic": origin == "demo_sintetico",
            "indicators": {
                "supplement_total": totals["display"]["supplement"],
                "total_payable": totals["display"]["total_payable"],
                "days_with_bulletin": len(closed),
                "days_without_data": sum(1 for r in rows if r["status"] == "sem_dado" and r["day_type"] == "workday"),
                "days_below_floor": below,
                "days_below_floor_share": format(Decimal(below) / len(closed), ".4f") if closed else None,
                "production_per_equivalent_day": money_display(Decimal(totals["production_per_equivalent_day"]))
                if totals["production_per_equivalent_day"] else None,
                "floor_per_day": money_display(FLOOR),
                "avg_paid_equivalents": format(avg_paid, ".1f") if avg_paid is not None else None,
                "avg_required_peak": format(avg_required, ".1f") if avg_required is not None else None,
                "avg_wait_minutes": int(avg_wait) if avg_wait is not None else None,
                "after_hours_unloads": after_hours,
            },
            "signal": signal(len(closed), below, avg_paid, avg_required, high, avg_wait, after_hours),
            "warehouse_costs": warehouses, "days": rows,
            "limits": [
                "A agenda mostra só caminhões de fornecedor; o boletim inclui o carregamento ao cooperado (remoção).",
                "Pico exigido compara pessoas simultâneas; a jornada de referência do chapa ainda não foi informada.",
                f"Expediente de referência até {WORKDAY_END.strftime('%H:%M')} (hipótese).",
                "Custo considera só a mão de obra apurada no boletim, sem encargos e sem equipamentos.",
                "Dia sem boletim aparece como sem dado, nunca como R$ 0.",
            ],
        })

