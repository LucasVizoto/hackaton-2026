from decimal import Decimal, ROUND_HALF_UP, localcontext
from fractions import Fraction

from labor.constants import FLOOR
from labor.bulletin import calculate_totals, snapshot_summary


def money_display(value):
    with localcontext() as context:
        context.prec = 40
        return format(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP), ".2f")


def calculate(lines, participants, floor=FLOOR):
    """Calculate one local/day. Round only human-readable values, never the floor comparison."""
    with localcontext() as context:
        context.prec = 40
        production = sum(
            (
                (
                    Decimal(str(line.get("unloading", 0)))
                    + Decimal(str(line.get("removal", 0)))
                    + Decimal(str(line.get("transfer", 0)))
                )
                * Decimal(str(line["price"]))
                for line in lines
            ),
            Decimal(0),
        )
        equivalents = sum((Decimal(str(person["fraction"])) for person in participants), Decimal(0))
        exact = calculate_totals(production, equivalents, Decimal(str(floor)))
        collective_floor = exact.pisoColetivo
        total = exact.totalAPagar
        supplement = exact.complemento
        per_day = exact.valorPorDiariaApurado
        return {
            "people_count": len(participants),
            "equivalent_days": format(equivalents, "f"),
            "production": format(production, "f"),
            "floor_per_day": format(floor, "f"),
            "collective_floor": format(collective_floor, "f"),
            "total_payable": format(total, "f"),
            "supplement": format(supplement, "f"),
            "production_per_equivalent_day": format(per_day, "f") if per_day is not None else None,
            "display": {
                "production": money_display(production),
                "total_payable": money_display(total),
                "supplement": money_display(supplement),
            },
            "calculation_version": "boletim-v1",
        }


DAILY_SERVICE_PRICES = {"FULL": Decimal("90.1731"), "HALF": Decimal("45.0786")}
ALLOCATION_VERSION = "proportional-largest-remainder-v1"


def calculate_v2(lines, participants, floor=FLOOR, daily_services=(), production_records=()):
    additional = [
        {"unloading": item["quantity"], "price": item["price"]}
        for item in [*daily_services, *production_records]
    ]
    result = calculate([*lines, *additional], participants, floor)
    result["calculation_version"] = "boletim-v2"
    result["allocation_policy"] = ALLOCATION_VERSION
    result["daily_services"] = list(daily_services)
    result["production_records"] = list(production_records)
    result["resumo"] = snapshot_summary(result)
    return result


def _apportion_cents(total, people):
    """Largest remainder on rational weights, stable by worker UUID, never input order."""
    amount = Decimal(str(total))
    with localcontext() as context:
        context.prec = 40
        target = int(amount.quantize(Decimal(".01"), rounding=ROUND_HALF_UP) * 100)
    weights = {str(p["worker"]): Fraction(Decimal(str(p["fraction"]))) for p in people}
    denominator = sum(weights.values(), Fraction(0))
    if not denominator:
        return {}
    raw = {key: Fraction(amount) * weight / denominator * 100 for key, weight in weights.items()}
    cents = {key: value.numerator // value.denominator for key, value in raw.items()}
    remaining = target - sum(cents.values())
    order = sorted(raw, key=lambda key: (-(raw[key] - cents[key]), key))
    for key in order[:remaining]:
        cents[key] += 1
    return cents


def allocate_individuals(calculation, people):
    if not people:
        return []
    equivalents = Fraction(Decimal(calculation["equivalent_days"]))
    fields = ("production", "supplement", "collective_floor", "total_payable")
    cents = {field: _apportion_cents(calculation[field], people) for field in fields}
    result = []
    for person in sorted(people, key=lambda p: str(p["worker"])):
        key = str(person["worker"])
        weight = Fraction(Decimal(str(person["fraction"]))) / equivalents
        exact, rationals, display = {}, {}, {}
        for field in fields:
            value = Fraction(Decimal(calculation[field])) * weight
            rationals[field] = {"numerator": str(value.numerator), "denominator": str(value.denominator)}
            with localcontext() as context:
                context.prec = 40
                exact[field] = format(Decimal(value.numerator) / Decimal(value.denominator), "f")
            display[field] = format(Decimal(cents[field][key]) / 100, ".2f")
        adjustment = cents["total_payable"][key] - cents["production"][key] - cents["supplement"][key]
        display["rounding_adjustment"] = format(Decimal(adjustment) / 100, ".2f")
        exact["rationals"] = rationals
        result.append({"worker": key, "fraction": str(person["fraction"]), "exact": exact,
                       "display": display, "policy_version": ALLOCATION_VERSION})
    return result


UNATTRIBUTED = "NAO_ATRIBUIDO"
COST_SPLIT_VERSION = "production-share-largest-remainder-v1"


def split_cost_by_warehouse(calculation, production_by_warehouse):
    """Divide o total do dia pela participação de cada armazém na produção (regra proposta no PRD).

    ``production_by_warehouse`` mapeia código do armazém (ou ``UNATTRIBUTED``) para a produção em R$.
    Sem produção, o custo inteiro fica "não atribuído", nunca num armazém escolhido.
    Os centavos usam maiores restos, então a soma reconcilia com o total exibido do dia.
    """
    with localcontext() as context:
        context.prec = 40
        production = {key: Decimal(str(value)) for key, value in production_by_warehouse.items() if Decimal(str(value))}
        total_production = sum(production.values(), Decimal(0))
        fields = ("total_payable", "supplement", "equivalent_days")
        if not total_production:
            return {"policy": COST_SPLIT_VERSION, "unattributed": True, "warehouses": [{
                "warehouse": UNATTRIBUTED, "share": "1", "production": "0",
                **{field: calculation[field] for field in fields},
                "display": {"total_payable": calculation["display"]["total_payable"],
                            "supplement": calculation["display"]["supplement"], "production": "0.00"},
            }]}
        weights = [{"worker": key, "fraction": value} for key, value in production.items()]
        cents = {field: _apportion_cents(calculation["display"][field] if field in calculation["display"] else calculation[field], weights)
                 for field in ("total_payable", "supplement")}
        rows = []
        for key in sorted(production):
            share = production[key] / total_production
            rows.append({
                "warehouse": key, "share": format(share, "f"), "production": format(production[key], "f"),
                **{field: format(Decimal(calculation[field]) * share, "f") for field in fields},
                "display": {"total_payable": format(Decimal(cents["total_payable"][key]) / 100, ".2f"),
                            "supplement": format(Decimal(cents["supplement"][key]) / 100, ".2f"),
                            "production": money_display(production[key])},
            })
        return {"policy": COST_SPLIT_VERSION, "unattributed": False, "warehouses": rows}
