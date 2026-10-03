from collections import Counter, defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal, localcontext

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import ORIGIN_CHOICES
from core.permissions import IsInternal, user_role
from imports.models import HistoricalMovement
from labor.calculation import money_display
from labor.models import DailyBulletin
from receiving.models import Appointment, NonReceipt


class Filters(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    warehouse = serializers.UUIDField(required=False)
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")

    def validate(self, data):
        today = timezone.localdate()
        data.setdefault("date_from", today.replace(day=1))
        data.setdefault("date_to", today)
        if data["date_from"] > data["date_to"]:
            raise serializers.ValidationError("A data inicial deve preceder a final.")
        if (data["date_to"] - data["date_from"]).days > 366 * 6:
            raise serializers.ValidationError("Selecione um período de até seis anos.")
        return data


def read_filters(request):
    serializer = Filters(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def bounds(filters):
    return (
        timezone.make_aware(datetime.combine(filters["date_from"], time.min)),
        timezone.make_aware(datetime.combine(filters["date_to"] + timedelta(days=1), time.min)),
    )


def metadata(filters):
    return {
        "origin": filters["origin"],
        "period": {
            "date_from": filters["date_from"].isoformat(),
            "date_to": filters["date_to"].isoformat(),
        },
        "nature": "demonstracao_sintetica" if filters["origin"] == "demo_sintetico" else "apurado",
        "synthetic": filters["origin"] == "demo_sintetico",
    }


def source_records(request, records, serialize):
    """Expose a bounded audit trail only to management, without private document fields."""
    if user_role(request.user) not in {"management", "admin"}:
        return None
    limit = 100
    return {
        "records": [serialize(record) for record in records[:limit]],
        "count": len(records),
        "returned_count": min(len(records), limit),
        "truncated": len(records) > limit,
    }


def financial_summary(bulletins):
    if not bulletins:
        return {
            "production": None,
            "equivalent_days": None,
            "total_payable": None,
            "supplement": None,
            "supplement_share": None,
            "production_per_equivalent_day": None,
            "people_count": 0,
            "bulletin_count": 0,
            "days_below_floor": 0,
            "display": {"production": None, "total_payable": None, "supplement": None},
        }
    with localcontext() as ctx:
        ctx.prec = 40
        totals = {
            key: sum((Decimal(b.calculation[key]) for b in bulletins), Decimal(0))
            for key in ("production", "equivalent_days", "total_payable", "supplement")
        }
    people = {participant.worker_id for b in bulletins for participant in b.participants.all()}
    total = totals["total_payable"]
    equivalents = totals["equivalent_days"]
    with localcontext() as ctx:
        ctx.prec = 40
        share = totals["supplement"] / total if total else None
        per_day = totals["production"] / equivalents if equivalents else None
    return {
        **{key: format(value, "f") for key, value in totals.items()},
        "supplement_share": format(share, "f") if share is not None else None,
        "production_per_equivalent_day": format(per_day, "f") if per_day is not None else None,
        "people_count": len(people),
        "bulletin_count": len(bulletins),
        "days_below_floor": sum(Decimal(b.calculation["supplement"]) > 0 for b in bulletins),
        "display": {
            key: money_display(totals[key]) for key in ("production", "total_payable", "supplement")
        },
    }


class LaborCostsView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        filters = read_filters(request)
        query = (
            DailyBulletin.objects.filter(
                status="CLOSED",
                origin=filters["origin"],
                reference_date__range=(filters["date_from"], filters["date_to"]),
            )
            .order_by("reference_date", "id")
            .select_related("warehouse")
            .prefetch_related("participants")
        )
        if filters.get("warehouse"):
            query = query.filter(warehouse_id=filters["warehouse"])
        bulletins = list(query)
        grouped = defaultdict(list)
        for bulletin in bulletins:
            grouped[bulletin.warehouse_id].append(bulletin)
        groups = []
        for warehouse_id, local in grouped.items():
            result = financial_summary(local)
            groups.append(
                {
                    "warehouse": str(warehouse_id),
                    "warehouse_name": local[0].warehouse.name,
                    "period": metadata(filters)["period"],
                    **result,
                    "diagnosis": "Produção abaixo do piso a investigar"
                    if Decimal(result["supplement"]) > 0
                    else "Complemento zero; dimensionamento ainda exige evidência operacional",
                    "evidence": "Boletins fechados; complemento não comprova ociosidade. Atendimento ao cooperado compartilha a equipe.",
                }
            )
        warnings = [
            "O custo abrange toda a movimentação da equipe: descarga, remoção e transferência, sem encargos ou equipamentos.",
            "Nenhuma lacuna de boletim foi convertida em custo zero.",
            "Ausência de tempos e demanda dos cooperados limita a conclusão sobre sobra ou falta de pessoas.",
        ]
        if filters["origin"] == "demo_sintetico":
            warnings.insert(
                0,
                "Dados sintéticos: estes valores não representam custos ou medições reais da Cocapec.",
            )
        if not bulletins:
            warnings.insert(
                0,
                "Sem boletins fechados para esta origem e período. Valores financeiros indisponíveis.",
            )
        return Response(
            {
                **metadata(filters),
                "summary": financial_summary(bulletins),
                "source_records": None if filters["origin"] == "historico_importado" else source_records(
                    request,
                    bulletins,
                    lambda bulletin: {
                        "id": str(bulletin.pk),
                        "reference_date": bulletin.reference_date.isoformat(),
                        "warehouse_id": str(bulletin.warehouse_id),
                        "warehouse_name": bulletin.warehouse.name,
                        **{
                            key: bulletin.calculation[key]
                            for key in (
                                "production", "equivalent_days", "total_payable", "supplement"
                            )
                        },
                    },
                ),
                "groups": groups,
                "coverage": {
                    "closed_bulletins": len(bulletins),
                    "covered_dates": sorted({b.reference_date.isoformat() for b in bulletins}),
                    "covered_warehouses": len(grouped),
                    "expected_bulletins": None,
                    "coverage_ratio": None,
                    "note": "Calendário de boletins esperados não configurado; dias ausentes continuam ausentes.",
                },
                "warnings": warnings,
            }
        )


def mean(values):
    return sum(values) / len(values) if values else None


def occupied_minutes(intervals):
    ordered = sorted(intervals)
    merged = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return sum((end - start).total_seconds() / 60 for start, end in merged)


class OperationsView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        filters = read_filters(request)
        if filters["origin"] == "historico_importado":
            query = HistoricalMovement.objects.filter(
                batch__active=True, received_on__range=(filters["date_from"], filters["date_to"])
            )
            if filters.get("warehouse"):
                raise ValidationError(
                    "Histórico documental não possui mapeamento físico confirmado; consulte por depósito na qualidade dos dados."
                )
            return Response(
                {
                    **metadata(filters),
                    "received_loads": None,
                    "average_wait_minutes": None,
                    "average_unloading_minutes": None,
                    "source_records": None,
                    "historical_documentary": {
                        "rows": query.count(),
                        "purchase_orders": query.exclude(purchase_order="")
                        .values("purchase_order")
                        .distinct()
                        .count(),
                        "receipt_numbers": query.exclude(receipt_number="")
                        .values("receipt_number")
                        .distinct()
                        .count(),
                        "by_depot": [
                            {"depot": depot, "rows": count}
                            for depot, count in Counter(
                                query.values_list("depot", flat=True)
                            ).items()
                        ],
                    },
                    "warnings": [
                        "Linhas, pedidos e recebimentos documentais não identificam caminhões.",
                        "Tempos de chegada, espera e descarga não existem neste histórico.",
                        "Peso e quantidades documentais não foram somados como demanda física.",
                    ],
                }
            )
        start, end = bounds(filters)
        base = Appointment.objects.filter(origin=filters["origin"])
        if filters.get("warehouse"):
            base = base.filter(visits__warehouse_id=filters["warehouse"]).distinct()
        completed = list(
            base.filter(operation_status="completed", finished_at__gte=start, finished_at__lt=end)
            .order_by("finished_at", "id")
            .select_related("supplier", "slot")
            .prefetch_related("visits__warehouse", "visits__equipment", "equipment")
        )
        waits, durations, workers = [], [], []
        invalid_wait = invalid_duration = 0
        loads_by_date, suppliers, arrivals_by_hour, bookings_by_hour = (
            Counter(),
            Counter(),
            Counter(),
            Counter(),
        )
        supplier_names = {}
        local_loads, local_intervals, equipment_loads = (
            defaultdict(set),
            defaultdict(list),
            defaultdict(set),
        )
        local_names, equipment_names = {}, {}
        for ap in completed:
            loads_by_date[timezone.localdate(ap.finished_at).isoformat()] += 1
            suppliers[str(ap.supplier_id)] += 1
            supplier_names[str(ap.supplier_id)] = ap.supplier.name
            if ap.arrived_at and ap.started_at and ap.started_at >= ap.arrived_at:
                waits.append((ap.started_at - ap.arrived_at).total_seconds() / 60)
            else:
                invalid_wait += 1
            if ap.started_at and ap.finished_at and ap.finished_at >= ap.started_at:
                durations.append((ap.finished_at - ap.started_at).total_seconds() / 60)
            else:
                invalid_duration += 1
            if ap.resources_confirmed and ap.worker_count is not None:
                workers.append(ap.worker_count)
            for visit in ap.visits.all():
                wid = str(visit.warehouse_id)
                if filters.get("warehouse") and str(filters["warehouse"]) != wid:
                    continue
                local_loads[wid].add(ap.pk)
                local_names[wid] = visit.warehouse.name
                if visit.started_at and visit.finished_at and visit.finished_at >= visit.started_at:
                    local_intervals[wid].append((visit.started_at, visit.finished_at))
                for item in visit.equipment.all():
                    equipment_loads[str(item.pk)].add(ap.pk)
                    equipment_names[str(item.pk)] = item.name
            if not filters.get("warehouse"):
                for item in ap.equipment.all():
                    equipment_loads[str(item.pk)].add(ap.pk)
                    equipment_names[str(item.pk)] = item.name
        arrivals = list(base.filter(arrived_at__gte=start, arrived_at__lt=end)
            .order_by("arrived_at", "id").values("id", "arrived_at"))
        for record in arrivals:
            arrivals_by_hour[timezone.localtime(record["arrived_at"]).strftime("%H:00")] += 1
        bookings = list(base.filter(
            slot__date__range=(filters["date_from"], filters["date_to"])
        ).order_by("slot__date", "slot__time", "id").values("id", "slot__date", "slot__time"))
        for record in bookings:
            bookings_by_hour[record["slot__time"]] += 1
        non_receipts = NonReceipt.objects.filter(
            origin=filters["origin"], occurred_at__gte=start, occurred_at__lt=end
        )
        if filters.get("warehouse"):
            non_receipts = non_receipts.filter(
                appointment__visits__warehouse_id=filters["warehouse"]
            ).distinct()
        non_receipts = list(non_receipts.order_by("occurred_at", "id").values(
            "id", "appointment_id", "occurred_at", "reason"
        ))
        evidence = source_records(
            request, completed,
            lambda appointment: {
                "id": str(appointment.pk),
                "finished_at": appointment.finished_at.isoformat(),
                "slot_date": appointment.slot.date.isoformat(),
                "arrived_at": appointment.arrived_at.isoformat() if appointment.arrived_at else None,
                "started_at": appointment.started_at.isoformat() if appointment.started_at else None,
                "warehouse_ids": sorted({
                    str(visit.warehouse_id) for visit in appointment.visits.all()
                }),
            },
        )
        if evidence is not None:
            evidence["arrivals"] = source_records(request, arrivals, lambda record: {
                "id": str(record["id"]), "arrived_at": record["arrived_at"].isoformat()
            })
            evidence["bookings"] = source_records(request, bookings, lambda record: {
                "id": str(record["id"]), "slot_date": record["slot__date"].isoformat(),
                "slot_time": record["slot__time"],
            })
            evidence["non_receipts"] = source_records(request, non_receipts, lambda record: {
                "id": str(record["id"]),
                "appointment_id": str(record["appointment_id"]) if record["appointment_id"] else None,
                "occurred_at": record["occurred_at"].isoformat(), "reason": record["reason"],
            })
        return Response(
            {
                **metadata(filters),
                "received_loads": len(completed),
                "average_wait_minutes": mean(waits),
                "average_unloading_minutes": mean(durations),
                "average_workers_per_receipt": mean(workers),
                "source_records": evidence,
                "loads_by_date": [
                    {"date": date, "count": count} for date, count in sorted(loads_by_date.items())
                ],
                "loads_by_warehouse": [
                    {
                        "warehouse": wid,
                        "warehouse_name": local_names[wid],
                        "count": len(ids),
                        "occupied_minutes": occupied_minutes(local_intervals[wid])
                        if local_intervals[wid]
                        else None,
                        "utilization_percent": None,
                    }
                    for wid, ids in local_loads.items()
                ],
                "suppliers": [
                    {
                        "supplier": sid,
                        "name": supplier_names[sid],
                        "received_loads": count,
                        "weight_kg": None,
                    }
                    for sid, count in suppliers.most_common()
                ],
                "equipment": [
                    {
                        "equipment": eid,
                        "name": equipment_names[eid],
                        "received_loads": len(ids),
                        "occupied_minutes": None,
                    }
                    for eid, ids in equipment_loads.items()
                ],
                "arrivals_by_hour": [
                    {"hour": hour, "count": count}
                    for hour, count in sorted(arrivals_by_hour.items())
                ],
                "bookings_by_hour": [
                    {"hour": hour, "count": count}
                    for hour, count in sorted(bookings_by_hour.items())
                ],
                "non_receipts_by_reason": [
                    {"reason": reason, "count": count}
                    for reason, count in Counter(
                        record["reason"] for record in non_receipts
                    ).items()
                ],
                "coverage": {
                    "completed_records": len(completed),
                    "valid_wait_records": len(waits),
                    "excluded_wait_records": invalid_wait,
                    "valid_unloading_records": len(durations),
                    "excluded_unloading_records": invalid_duration,
                },
                "warnings": [
                    "Chapas por descarga não são somados como efetivo do dia.",
                    "Tempos globais não são repetidos em cada armazém; totais por local podem não ser aditivos.",
                    "Uso de equipamento é associação registrada; sem apontamento próprio não há duração medida.",
                    "Percentual de utilização exige janela e capacidade configuradas.",
                ]
                + (
                    [
                        "Demonstração sintética; tempos e recursos não foram medidos na operação real."
                    ]
                    if filters["origin"] == "demo_sintetico"
                    else []
                ),
            }
        )


class ScenarioInput(serializers.Serializer):
    bulletin = serializers.UUIDField()
    equivalent_days = serializers.DecimalField(
        max_digits=3, decimal_places=1, min_value=Decimal("0.5"), max_value=Decimal("20")
    )

    def validate_equivalent_days(self, value):
        if value % Decimal("0.5"):
            raise serializers.ValidationError("Use múltiplos de meia diária.")
        return value


class StaffingScenarioView(APIView):
    permission_classes = [IsInternal]

    def post(self, request):
        serializer = ScenarioInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        bulletin = get_object_or_404(DailyBulletin, pk=data["bulletin"], status="CLOSED")
        production = Decimal(bulletin.calculation["production"])
        current = Decimal(bulletin.calculation["total_payable"])
        scenario_floor = bulletin.floor_per_day * data["equivalent_days"]
        scenario_total = max(production, scenario_floor)
        difference = current - scenario_total
        return Response(
            {
                "bulletin": str(bulletin.pk),
                "warehouse": str(bulletin.warehouse_id),
                "warehouse_name": bulletin.warehouse.name,
                "reference_date": bulletin.reference_date.isoformat(),
                "origin": bulletin.origin,
                "conditional": True,
                "nature": "cenario",
                "current": bulletin.calculation,
                "scenario": {
                    "production": str(production),
                    "equivalent_days": str(data["equivalent_days"]),
                    "total_payable": str(scenario_total),
                    "supplement": str(scenario_total - production),
                },
                "difference": str(difference),
                "display_difference": money_display(difference),
                "assumptions": [
                    "A produção permanece constante por hipótese.",
                    "A variação financeira não representa economia garantida nem recomendação automática de reduzir pessoas.",
                    "Viabilidade exige equipe mínima, sobreposição, equipamentos e atendimento aos cooperados.",
                    "A simulação não altera o boletim ou a agenda.",
                ],
            }
        )
