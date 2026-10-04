"""Alocação de chapas e empilhadeiras por descarga (PRD "Pagamento e alocação dos chapas").

As normas são estimativas do responsável pela operação, não medições. Quando há tempos reais
suficientes na entrada e saída de cada caminhão, eles substituem a norma de retirada.
O registro da descarga mede intensidade; nunca é somado como efetivo do dia (isso é o boletim).
"""
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from decimal import Decimal
from statistics import median

LIGHT_LOAD_KG = Decimal("500")
GAS_FORKLIFT = "EMPILHADEIRA_GAS"
MACHINE_YARD = "MAQUINAS"
SLOT_TIMES = ("08:00", "10:00", "13:00", "15:00")
# Hipótese até a Cocapec informar a jornada de referência do chapa (decisões pendentes do PRD).
WORKDAY_END = time(17, 0)
OBSERVED_MIN_SAMPLES = 5

NORMS = {
    "batida": {
        "label": "Batido (solto)", "chapas": 5, "gas_forklifts": 0, "operators": 0,
        "equipment": "Nenhum: manual, saco a saco",
        "unload": "200 sacas de 50 kg: 40 min · 28 t a granel: 50 min",
        "cycle": "Igual à retirada",
    },
    "paletizada": {
        "label": "Paletizado", "chapas": 2, "gas_forklifts": 1, "operators": 0,
        "equipment": "1 empilhadeira a gás", "default_units": 10, "unit_label": "paletes",
        "unload_per_unit": Decimal("1.5"), "cycle_per_unit": Decimal("5"),
        "unload": "10 paletes: 15 min", "cycle": "5 min por palete",
    },
    "big_bag": {
        "label": "Big bag", "chapas": 2, "gas_forklifts": 1, "operators": 0,
        "equipment": "1 empilhadeira a gás", "default_units": 20, "unit_label": "big bags",
        "unload_per_unit": Decimal("1.5"), "cycle_per_unit": Decimal("5"),
        "unload": "20 big bags: 30 min", "cycle": "5 min por big bag",
    },
    "machine_implement": {
        "label": "Máquina ou implemento", "chapas": 1, "gas_forklifts": 0, "operators": 1,
        "equipment": "Empilhadeira ou trator do Pátio de Máquinas",
        "unload": "15 a 20 min", "cycle": "Não informado (usa a retirada)",
    },
}

# Inventário do PRD, usado apenas quando o cadastro não classifica empilhadeiras a gás.
DEFAULT_GAS_FORKLIFTS = {
    "INSUMOS": {"quantity": 1, "mobile": False},
    "ADUBO": {"quantity": 2, "mobile": True},
    MACHINE_YARD: {"quantity": 1, "mobile": False},
}


def _batida_minutes(weight_kg):
    """Interpola os dois pontos informados: 10 t em 40 min e 28 t em 50 min."""
    if weight_kg is None:
        return Decimal(40)
    tons = Decimal(weight_kg) / 1000
    if tons <= 10:
        return max(Decimal(10), Decimal(40) * tons / 10)
    return Decimal(40) + (tons - 10) * Decimal(10) / 18


@dataclass(frozen=True)
class LoadRequirement:
    packaging: str
    chapas: int
    gas_forklifts: int
    operators: int
    unload_minutes: Decimal
    cycle_minutes: Decimal
    units: int | None
    weight_kg: Decimal | None
    estimated: bool
    light_load: bool
    time_source: str = "norma"
    notes: tuple = field(default_factory=tuple)


def requirement(packaging, weight_kg=None, units=None, observed_unload=None):
    """Pessoas, equipamento e tempos exigidos por uma descarga. Cada caminhão tem um acondicionamento."""
    norm = NORMS.get(packaging)
    if norm is None:
        raise ValueError(f"Acondicionamento desconhecido: {packaging}")
    notes = []
    if weight_kg is not None and Decimal(weight_kg) < LIGHT_LOAD_KG:
        return LoadRequirement(packaging, 0, 0, 0, Decimal(0), Decimal(0), units, Decimal(weight_kg),
                               False, True, notes=("Carga abaixo de 500 kg não exige chapas.",))
    estimated = weight_kg is None
    if packaging == "batida":
        unload = cycle = _batida_minutes(weight_kg)
    elif packaging == "machine_implement":
        unload = cycle = Decimal(20)
    else:
        if units is None:
            units, estimated = norm["default_units"], True
            notes.append(f"Quantidade de {norm['unit_label']} não informada; norma usa {units}.")
        unload = norm["unload_per_unit"] * units
        cycle = norm["cycle_per_unit"] * units
    source = "norma"
    if observed_unload is not None:
        cycle = observed_unload * cycle / unload if unload else observed_unload
        unload, source = observed_unload, "tempo_real"
        notes.append("Retirada substituída pela mediana dos tempos reais registrados.")
    return LoadRequirement(packaging, norm["chapas"], norm["gas_forklifts"], norm["operators"],
                           unload, cycle, units, Decimal(weight_kg) if weight_kg is not None else None,
                           estimated, False, source, tuple(notes))


def observed_unload_minutes(durations_by_packaging):
    """Mediana em minutos por acondicionamento, só com amostra mínima; abaixo disso vale a norma."""
    result = {}
    for packaging, durations in durations_by_packaging.items():
        valid = [d for d in durations if d and d > 0]
        if len(valid) >= OBSERVED_MIN_SAMPLES:
            result[packaging] = Decimal(str(round(median(valid), 1)))
    return result


def assign_forklifts(demand, inventory):
    """Distribui empilhadeiras a gás num horário. ``demand``/``inventory`` são indexados por código do armazém.

    Cada armazém usa as próprias; o déficit é coberto por empilhadeiras móveis de outro armazém
    (as do Adubo podem subir para o Insumos). A do Pátio de Máquinas nunca sai de lá.
    """
    free = {code: item["quantity"] for code, item in inventory.items()}
    assignments, conflicts = [], []
    for code in sorted(demand):
        need = demand[code]
        own = min(need, free.get(code, 0))
        free[code] = free.get(code, 0) - own
        if own:
            assignments.append({"warehouse": code, "from": code, "quantity": own, "borrowed": False})
        missing = need - own
        for lender in sorted(free, key=lambda c: (-free[c], c)):
            if not missing:
                break
            item = inventory.get(lender, {})
            if lender == code or lender == MACHINE_YARD or not item.get("mobile") or free[lender] <= 0:
                continue
            take = min(missing, free[lender])
            free[lender] -= take
            missing -= take
            assignments.append({"warehouse": code, "from": lender, "quantity": take, "borrowed": True})
        if missing:
            conflicts.append({"warehouse": code, "missing": missing})
    return assignments, conflicts


def slot_end(day, slot_time, minutes):
    start = datetime.combine(day, time.fromisoformat(slot_time))
    return start + timedelta(minutes=float(minutes))


def plan_slot(day, slot_time, loads, inventory):
    """Ocupação de um horário: soma pessoas e empilhadeiras exigidas ao mesmo tempo (limite global)."""
    chapas = sum(item["requirement"].chapas + item["requirement"].operators for item in loads)
    demand = {}
    for item in loads:
        req = item["requirement"]
        if req.gas_forklifts and item["warehouse"]:
            demand[item["warehouse"]] = demand.get(item["warehouse"], 0) + req.gas_forklifts
    assignments, conflicts = assign_forklifts(demand, inventory)
    warnings = []
    ends = [slot_end(day, slot_time, item["requirement"].cycle_minutes) for item in loads]
    workday_end = datetime.combine(day, WORKDAY_END)
    after_hours = [item for item, end in zip(loads, ends) if end > workday_end]
    if after_hours:
        warnings.append("Descarga iniciada não para: a equipe e a empilhadeira seguem alocadas após o expediente.")
    if any(item["requirement"].packaging == "batida" for item in loads) and len(loads) > 1:
        warnings.append("Carga batida exige o horário só para ela.")
    for conflict in conflicts:
        warnings.append(f"Falta {conflict['missing']} empilhadeira(s) a gás para {conflict['warehouse']} neste horário.")
    for item in assignments:
        if item["borrowed"]:
            warnings.append(f"Sugestão: {item['quantity']} empilhadeira(s) do {item['from']} apoiam o {item['warehouse']}.")
    return {
        "time": slot_time,
        "chapas": chapas,
        "gas_forklifts": sum(demand.values()),
        "forklift_assignments": assignments,
        "forklift_conflicts": conflicts,
        "ends_at": max(ends).strftime("%H:%M") if ends else None,
        "after_hours": bool(after_hours),
        "warnings": warnings,
    }


def season_target(day):
    """Quadro de referência: ~8 chapas; de outubro a março, 14 a 15 com reforço terceirizado."""
    return {"min": 14, "max": 15, "season": "safra"} if day.month >= 10 or day.month <= 3 else {
        "min": 8, "max": 8, "season": "normal"}
