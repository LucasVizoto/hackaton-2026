from collections import defaultdict
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from catalog.models import Equipment
from labor.allocation import (
    DEFAULT_GAS_FORKLIFTS, GAS_FORKLIFT, NORMS, SLOT_TIMES, WORKDAY_END,
    observed_unload_minutes, plan_slot, requirement, season_target,
)
from receiving.models import Appointment, Holiday

INACTIVE_OPERATION = ("cancelled", "not_received")


def _decimal(value):
    try:
        return Decimal(str(value)) if value not in (None, "") else None
    except InvalidOperation:
        return None


def load_estimate(appointment):
    """Peso e volumes declarados na NF-e (transp/vol). Ausência fica ``None``, nunca zero."""
    volumes = (appointment.invoice.extracted or {}).get("volumes") or []
    weights = [_decimal(v.get("gross_weight")) or _decimal(v.get("net_weight")) for v in volumes]
    units = [_decimal(v.get("quantity")) for v in volumes]
    weight = sum(weights, Decimal(0)) if weights and all(w is not None for w in weights) else None
    count = int(sum(units, Decimal(0))) if units and all(u is not None for u in units) else None
    return weight, count


def gas_inventory():
    rows = Equipment.objects.filter(kind=GAS_FORKLIFT, is_active=True).select_related("warehouse")
    inventory = defaultdict(lambda: {"quantity": 0, "mobile": False})
    for item in rows:
        if not item.warehouse_id:
            continue
        entry = inventory[item.warehouse.code]
        entry["quantity"] += item.quantity
        entry["mobile"] = entry["mobile"] or bool(item.mobile)
    if inventory:
        return dict(inventory), "cadastro"
    return {code: dict(value) for code, value in DEFAULT_GAS_FORKLIFTS.items()}, "padrao_prd"


def observed_times(origin, until, days=120):
    durations = defaultdict(list)
    rows = Appointment.objects.filter(
        origin=origin, operation_status="completed", started_at__isnull=False, finished_at__isnull=False,
        slot__date__range=(until - timedelta(days=days), until),
    ).values_list("packaging", "started_at", "finished_at")
    for packaging, started, finished in rows:
        durations[packaging].append((finished - started).total_seconds() / 60)
    return observed_unload_minutes(durations), {key: len(value) for key, value in durations.items()}


def _serialize(req):
    return {
        "chapas": req.chapas, "operators": req.operators, "gas_forklifts": req.gas_forklifts,
        "unload_minutes": format(req.unload_minutes, ".0f"), "cycle_minutes": format(req.cycle_minutes, ".0f"),
        "units": req.units, "weight_kg": format(req.weight_kg, "f") if req.weight_kg is not None else None,
        "estimated": req.estimated, "light_load": req.light_load, "time_source": req.time_source,
        "notes": list(req.notes),
    }


def day_plan(day, origin="operacional_registrado"):
    inventory, inventory_source = gas_inventory()
    observed, samples = observed_times(origin, day)
    appointments = (
        Appointment.objects.filter(slot__date=day, origin=origin)
        .exclude(operation_status__in=INACTIVE_OPERATION).exclude(purchase_status="rejected")
        .select_related("slot", "supplier", "invoice").prefetch_related("visits__warehouse")
    )
    by_slot = defaultdict(list)
    loads = []
    for appointment in appointments:
        weight, units = load_estimate(appointment)
        req = requirement(appointment.packaging, weight, units, observed.get(appointment.packaging))
        visits = list(appointment.visits.all())
        entry = {
            "appointment": str(appointment.pk), "supplier": appointment.supplier.name,
            "packaging": appointment.packaging, "packaging_label": NORMS[appointment.packaging]["label"],
            "slot": appointment.slot.time, "status": appointment.operation_status,
            "warehouses": [v.warehouse.code for v in visits],
            "warehouse": visits[0].warehouse.code if visits else None,
            "requirement": req,
        }
        if len(visits) > 1:
            entry["multi_destination"] = (
                "Descarga em mais de um armazém: alocação por destino; paleteiras que circulam fazem a ligação.")
        by_slot[appointment.slot.time].append(entry)
        loads.append(entry)
    slots = []
    for slot_time in SLOT_TIMES:
        planned = plan_slot(day, slot_time, by_slot.get(slot_time, []), inventory)
        planned["loads"] = [{**{k: v for k, v in item.items() if k != "requirement"},
                             "requirement": _serialize(item["requirement"])} for item in by_slot.get(slot_time, [])]
        slots.append(planned)
    person_minutes = sum((item["requirement"].chapas + item["requirement"].operators) * item["requirement"].cycle_minutes
                         for item in loads)
    weekday = day.weekday()
    holiday = Holiday.objects.filter(date=day).first()
    warnings = []
    if weekday >= 5 or holiday:
        warnings.append("Sábado, domingo e feriado não têm recebimento; no sábado a equipe faz organização interna.")
    if not loads:
        warnings.append("Sem descargas agendadas: a necessidade da agenda é zero, mas o carregamento ao cooperado continua.")
    return {
        "date": day.isoformat(), "origin": origin,
        "day_type": "holiday" if holiday else "saturday" if weekday == 5 else "sunday" if weekday == 6 else "workday",
        "holiday": holiday.description if holiday else None,
        "peak_chapas": max((slot["chapas"] for slot in slots), default=0),
        "peak_gas_forklifts": max((slot["gas_forklifts"] for slot in slots), default=0),
        "loads": len(loads),
        "person_hours": format(person_minutes / 60, ".1f"),
        "after_hours_loads": sum(1 for slot in slots if slot["after_hours"]),
        "forklift_conflicts": sum(len(slot["forklift_conflicts"]) for slot in slots),
        "slots": slots,
        "inventory": {"gas_forklifts": inventory, "source": inventory_source},
        "observed_times": {"minutes": {k: str(v) for k, v in observed.items()}, "samples": samples},
        "season_target": season_target(day),
        "workday_end": WORKDAY_END.strftime("%H:%M"),
        "warnings": warnings,
        "limits": "A agenda mostra só caminhões de fornecedor; o carregamento ao cooperado (remoção) disputa a mesma equipe.",
    }


def norms_payload():
    inventory, source = gas_inventory()
    return {"norms": [{"packaging": key, **{k: (str(v) if isinstance(v, Decimal) else v) for k, v in value.items()}}
                      for key, value in NORMS.items()],
            "light_load_kg": "500", "slots": list(SLOT_TIMES), "workday_end": WORKDAY_END.strftime("%H:%M"),
            "inventory": {"gas_forklifts": inventory, "source": source},
            "rules": [
                "A quantidade de chapas depende só do peso e do acondicionamento.",
                "Palete ou big bag precisa de 1 empilhadeira a gás do próprio armazém; as 2 do Adubo podem apoiar o Insumos.",
                "A empilhadeira do Pátio de Máquinas é dedicada a máquinas e implementos.",
                "Descarga iniciada não para: termina no mesmo dia, mesmo após o expediente.",
                "Equipamento não entra no custo da mão de obra.",
            ]}
