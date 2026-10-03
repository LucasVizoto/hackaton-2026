from decimal import Decimal, ROUND_HALF_UP, localcontext

from labor.constants import FLOOR


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
        collective_floor = equivalents * Decimal(str(floor))
        total = max(production, collective_floor)
        supplement = total - production
        per_day = production / equivalents if equivalents else None
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
