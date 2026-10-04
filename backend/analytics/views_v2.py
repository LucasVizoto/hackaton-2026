"""Extended indicators: financial ownership and physical activity are different axes."""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal, localcontext

from rest_framework import serializers
from rest_framework.response import Response

from analytics.views import (
    LaborCostsView, OperationsView, StaffingScenarioView, bounds, cost_shares, financial_summary, mean, read_filters,
)
from labor.calculation import money_display
from receiving.models import Appointment, WarehouseVisit


class OperationsV2View(OperationsView):
    def get(self, request):
        response = super().get(request)
        data = response.data
        filters = read_filters(request)
        data.update({
            "average_gate_wait_minutes": None,
            "average_total_stay_minutes": None,
            "departed_loads": None,
            "warehouse_stays": [],
            "gate_wait_by_warehouse": None,
        })
        if filters["origin"] == "historico_importado":
            return response
        start, end = bounds(filters)
        base = Appointment.objects.filter(origin=filters["origin"])
        if filters.get("warehouse"):
            base = base.filter(visits__warehouse_id=filters["warehouse"]).distinct()
        departures = list(base.filter(
            gate_checked_out_at__gte=start, gate_checked_out_at__lt=end,
        ).prefetch_related("visits__warehouse"))
        waits, stays = [], []
        gate_waits = defaultdict(list)
        gate_exclusions = defaultdict(int)
        gate_names = {}
        unattributed = 0
        for appointment in departures:
            entered, left = appointment.gate_checked_in_at, appointment.gate_checked_out_at
            if entered and left >= entered:
                stays.append((left - entered).total_seconds() / 60)
            first_visit = next(iter(appointment.visits.all()), None)
            if first_visit:
                wid = str(first_visit.warehouse_id)
                gate_names[wid] = first_visit.warehouse.name
                first_entry = first_visit.checked_in_at
                valid = entered and first_entry and entered <= first_entry <= left
                if valid:
                    wait = (first_entry - entered).total_seconds() / 60
                    waits.append(wait)
                    # The selected destination never inherits another warehouse's wait.
                    if not filters.get("warehouse") or str(filters["warehouse"]) == wid:
                        gate_waits[wid].append(wait)
                elif not filters.get("warehouse") or str(filters["warehouse"]) == wid:
                    gate_exclusions[wid] += 1
            else:
                unattributed += 1
        visits = WarehouseVisit.objects.filter(
            appointment__in=base, checked_out_at__gte=start, checked_out_at__lt=end,
        ).select_related("warehouse").order_by("warehouse__name", "id")
        if filters.get("warehouse"):
            visits = visits.filter(warehouse_id=filters["warehouse"])
        local = defaultdict(list)
        names = {}
        missing = 0
        for visit in visits:
            wid = str(visit.warehouse_id)
            names[wid] = visit.warehouse.name
            if visit.checked_in_at and visit.checked_out_at >= visit.checked_in_at:
                local[wid].append((visit.checked_out_at - visit.checked_in_at).total_seconds() / 60)
            else:
                missing += 1
        data.update({
            "average_gate_wait_minutes": mean(waits),
            "average_total_stay_minutes": mean(stays),
            "departed_loads": len(departures),
            "gate_wait_by_warehouse": [
                {"warehouse": wid, "warehouse_name": gate_names[wid],
                 "average_minutes": mean(gate_waits[wid]),
                 "valid_records": len(gate_waits[wid]), "excluded_records": gate_exclusions[wid]}
                for wid in sorted(set(gate_waits) | set(gate_exclusions), key=lambda wid: (gate_names[wid], wid))
            ],
            "warehouse_stays": [
                {"warehouse": wid, "warehouse_name": names[wid], "visits": len(values),
                 "average_minutes": mean(values)}
                for wid, values in local.items()
            ],
        })
        data["coverage"].update({
            "departures": len(departures), "valid_total_stay_records": len(stays),
            "valid_gate_wait_records": len(waits), "excluded_warehouse_stays": missing,
            "excluded_gate_wait_records": len(departures) - len(waits),
            "unattributed_gate_wait_records": unattributed,
            "gate_wait_definition": "Portaria até entrada no primeiro armazém; cargas com saída da unidade no período. Atribuição apenas ao primeiro destino.",
            "event_time_basis": "Saída da portaria e saída de cada visita no período selecionado",
        })
        data["warnings"].append(
            "Permanência total usa saída da portaria; conclusão da descarga não é saída do veículo. "
            "Registros legados sem esses marcos não entram nas novas médias."
        )
        return response


class LaborCostsV2View(LaborCostsView):
    def cost_details(self, request, bulletins, filters):
        # Reuse the same snapshots as summary/evidence, even during a concurrent reopening.
        return {**_individual_costs_for_bulletins(bulletins, filters), **financial_dashboard(bulletins, filters)}


def financial_dashboard(bulletins, filters):
    """Full closed snapshots, independent of the bounded evidence/individual lists."""
    by_date, weekly = defaultdict(list), defaultdict(list)
    week_start = filters["date_to"] - timedelta(days=min(6, (filters["date_to"] - filters["date_from"]).days))
    shares = cost_shares(bulletins)
    if filters.get("warehouse"):
        shares = [share for share in shares if share.warehouse_id == str(filters["warehouse"])]
    # A filtered chart must reconcile with the cost owner's share, not the full day.
    for bulletin in shares if filters.get("warehouse") else bulletins:
        by_date[bulletin.reference_date].append(bulletin)
    for share in shares:
        if share.reference_date >= week_start:
            weekly[(share.warehouse_id, share.warehouse_name)].append(share)
    series = []
    for offset in range((filters["date_to"] - filters["date_from"]).days + 1):
        day = filters["date_from"] + timedelta(days=offset)
        summary = financial_summary(by_date[day])
        series.append({"date": day.isoformat(), **{
            key: summary[key] for key in ("production", "total_payable", "supplement", "bulletin_count")
        }})
    groups = []
    for (wid, name), local in weekly.items():
        summary = financial_summary(local)
        groups.append({"warehouse": wid, "warehouse_name": name,
                       "supplement": summary["supplement"], "bulletin_count": len(local),
                       "covered_dates": sorted({b.reference_date.isoformat() for b in local})})
    groups.sort(key=lambda row: (row["warehouse_name"], row["warehouse"]))
    groups.sort(key=lambda row: Decimal(row["supplement"]), reverse=True)
    maximum = Decimal(groups[0]["supplement"]) if groups else Decimal(0)
    return {"daily_series": series, "weekly_supplement": {
        "period": {"date_from": week_start.isoformat(), "date_to": filters["date_to"].isoformat()},
        "groups": groups, "closed_bulletins": len({share.bulletin.pk for local in weekly.values() for share in local}),
        "leaders": [row["warehouse"] for row in groups if maximum > 0 and Decimal(row["supplement"]) == maximum],
        "note": "Complemento do piso não comprova ociosidade; lacunas de boletins não viram zero.",
    }}


def bulletin_cost_owners(bulletin):
    if bulletin.warehouse_id:
        return [(str(bulletin.warehouse_id), bulletin.warehouse.name)]
    return [(share.warehouse_id, share.warehouse_name) for share in cost_shares([bulletin])]


def _individual_costs_for_bulletins(bulletins, filters):
    from labor.models import IndividualAllocation, LaborActivity

    groups = {}
    allocations = list(IndividualAllocation.objects.filter(
        bulletin__in=bulletins, active=True,
    ).select_related("worker", "bulletin__warehouse", "worker_day").order_by("worker__registration", "worker_id"))
    activity_query = LaborActivity.objects.filter(
        worker_day__origin=filters["origin"],
        worker_day__reference_date__range=(filters["date_from"], filters["date_to"]),
    ).select_related("warehouse")
    activity_locations = defaultdict(dict)
    for activity in activity_query:
        activity_locations[activity.worker_day_id][str(activity.warehouse_id)] = activity.warehouse.name
    covered = set()
    with localcontext() as context:
        context.prec = 50
        collective = sum((Decimal(b.calculation["display"]["total_payable"]) for b in bulletins), Decimal(0))
        for allocation in allocations:
            covered.add(allocation.bulletin_id)
            wid = str(allocation.worker_id)
            if wid not in groups:
                groups[wid] = {
                    "worker": wid, "registration": allocation.worker.registration,
                    "name": allocation.worker.name, "equivalent_days": Decimal(0),
                    "production_attributed": Decimal(0), "supplement": Decimal(0),
                    "total_payable": Decimal(0),
                    "display": {key: Decimal(0) for key in ("production_attributed", "supplement", "total_payable")},
                    "cost_warehouses": {}, "activity_warehouses": {},
                }
            group = groups[wid]
            group["equivalent_days"] += allocation.fraction
            for key, source in (("production_attributed", "production"), ("supplement", "supplement"), ("total_payable", "total_payable")):
                group[key] += Decimal(allocation.exact[source])
                group["display"][key] += Decimal(allocation.display[source])
            for wid, name in bulletin_cost_owners(allocation.bulletin):
                group["cost_warehouses"][wid] = name
            group["activity_warehouses"].update(activity_locations[allocation.worker_day_id])
        nominal = sum((allocation.total_payable for allocation in allocations), Decimal(0))
    rows = []
    for group in groups.values():
        rows.append({
            **{key: format(value, "f") if isinstance(value, Decimal) else value for key, value in group.items()},
            "display": {key: money_display(value) for key, value in group["display"].items()},
            **{key: [{"id": wid, "name": name} for wid, name in sorted(group[key].items())]
               for key in ("cost_warehouses", "activity_warehouses")},
        })
    if filters.get("warehouse"):
        # A location filter for attendance is explicit; financial totals still belong to the cost owner.
        activity_query = activity_query.filter(warehouse_id=filters["warehouse"])
    uncovered = len(bulletins) - len(covered)
    return {
        "individuals": {"records": rows[:100], "count": len(rows), "returned_count": min(len(rows), 100), "truncated": len(rows) > 100},
        "presence": {
            "planned": activity_query.filter(attendance_state="PLANNED").values("worker_day_id").distinct().count(),
            "present": activity_query.filter(attendance_state="PRESENT").values("worker_day_id").distinct().count(),
            "used": activity_query.filter(used=True).values("worker_day_id").distinct().count(),
            "coverage": activity_query.values("worker_day_id").distinct().count(),
            "unit": "pessoa/dia distinta com atividade registrada",
            "note": "Prevista é a atividade ainda prevista; presença sem registro continua desconhecida. Filtro de presença usa local da atividade; financeiro usa armazém responsável pelo custo.",
        },
        "reconciliation": {
            "individual_display_total": money_display(nominal) if allocations else None,
            "collective_display_total": money_display(collective) if bulletins else None,
            "difference": money_display(collective - nominal) if bulletins and not uncovered else None,
            "legacy_bulletins_without_allocations": uncovered,
            "note": "Soma dos totais em centavos gravados em cada boletim. Parcelas antigas não são reconstruídas.",
        },
    }


class ScenarioConstraints(serializers.Serializer):
    minimum_equivalent_days = serializers.DecimalField(max_digits=4, decimal_places=1, min_value=Decimal("0"), required=False)
    required_equipment = serializers.IntegerField(min_value=0, max_value=1000, required=False)
    available_equipment = serializers.IntegerField(min_value=0, max_value=1000, required=False)


class StaffingScenarioV2View(StaffingScenarioView):
    def post(self, request):
        constraints = ScenarioConstraints(data=request.data)
        constraints.is_valid(raise_exception=True)
        result = super().post(request)
        values = constraints.validated_data
        failures = []
        minimum = values.get("minimum_equivalent_days")
        if minimum is not None and Decimal(result.data["scenario"]["equivalent_days"]) < minimum:
            failures.append("Equipe proposta abaixo do mínimo de diárias equivalentes informado.")
        required, available = values.get("required_equipment"), values.get("available_equipment")
        if required is not None and available is not None and available < required:
            failures.append("Equipamentos informados insuficientes para a demanda proposta.")
        result.data.update({
            "feasibility": "infeasible" if failures else "unverified",
            "constraints": {key: str(value) for key, value in values.items()},
            "constraint_failures": failures,
            "coverage": {"minimum_staff_provided": minimum is not None,
                         "equipment_provided": required is not None and available is not None,
                         "measured_service_demand": False, "verified_overlapping_activities": False},
        })
        result.data["assumptions"].append(
            "Restrições informadas são hipóteses; a cobertura de atendimento e sobreposição ainda precisa ser demonstrada."
        )
        return Response(result.data)
