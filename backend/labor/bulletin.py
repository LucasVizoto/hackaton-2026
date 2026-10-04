"""Typed, HTTP-independent contracts for the daily piecework calculation.

Money is Decimal throughout. Display rounding never feeds back into the floor
comparison or the individual allocation policy.
"""
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, localcontext
from enum import StrEnum

from labor.constants import FLOOR, PRICES


class Categoria(StrEnum):
    SACARIA_25 = "SACARIA_25"
    SACARIA_40 = "SACARIA_40"
    SACARIA_50 = "SACARIA_50"
    FARDO_250 = "FARDO_250"
    FARDO_500 = "FARDO_500"
    PECAS = "PECAS"
    MAQUINAS = "MAQUINAS"
    AGROQUIMICO = "AGROQUIMICO"
    FERTILIZANTES = "FERTILIZANTES"
    SEMENTES = "SEMENTES"
    MEDICAMENTOS = "MEDICAMENTOS"
    ALIMENTACAO_ANIMAL = "ALIMENTACAO_ANIMAL"
    ACESSORIOS = "ACESSORIOS"
    SERVICOS_DIVERSOS = "SERVICOS_DIVERSOS"


class Modalidade(StrEnum):
    DESCARGA = "unloading"
    REMOCAO = "removal"
    TRANSFERENCIA = "transfer"


def decimal_nonnegative(value: Decimal, field: str) -> Decimal:
    if not isinstance(value, Decimal):
        raise TypeError(f"{field}: informe Decimal, nunca float.")
    if not value.is_finite() or value < 0:
        raise ValueError(f"{field}: informe um decimal finito não negativo.")
    return value


def reais(value: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 40
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Movimentacao:
    categoria: Categoria
    modalidade: Modalidade
    quantidade: Decimal

    def __post_init__(self) -> None:
        object.__setattr__(self, "categoria", Categoria(self.categoria))
        object.__setattr__(self, "modalidade", Modalidade(self.modalidade))
        decimal_nonnegative(self.quantidade, "quantidade")


@dataclass(frozen=True)
class MembroEquipe:
    identificador: str
    matricula: str
    nome: str
    peso: Decimal

    def __post_init__(self) -> None:
        if any(not isinstance(value, str) or not value.strip()
               for value in (self.identificador, self.matricula, self.nome)):
            raise ValueError("Informe identificador, matrícula e nome.")
        for name in ("identificador", "matricula", "nome"):
            object.__setattr__(self, name, getattr(self, name).strip())
        decimal_nonnegative(self.peso, "peso")
        if self.peso not in (Decimal("1"), Decimal("0.5")):
            raise ValueError("Use diária completa (1) ou meia diária (0,5).")


@dataclass(frozen=True)
class BoletimDiario:
    armazem: str
    data: date
    movimentacoes: tuple[Movimentacao, ...]
    equipe: tuple[MembroEquipe, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "movimentacoes", tuple(self.movimentacoes))
        object.__setattr__(self, "equipe", tuple(self.equipe))
        if any(not isinstance(m, Movimentacao) for m in self.movimentacoes):
            raise TypeError("Movimentação deve usar o contrato Movimentacao.")
        if any(not isinstance(p, MembroEquipe) for p in self.equipe):
            raise TypeError("Equipe deve usar o contrato MembroEquipe.")
        if not isinstance(self.armazem, str) or not self.armazem.strip() or type(self.data) is not date:
            raise ValueError("Informe armazém e data do boletim.")
        if len(self.equipe) > 20:
            raise ValueError("O boletim aceita até 20 pessoas.")
        if (len({p.identificador for p in self.equipe}) != len(self.equipe)
                or len({p.matricula for p in self.equipe}) != len(self.equipe)):
            raise ValueError("Pessoa ou matrícula duplicada no boletim.")


@dataclass(frozen=True)
class MemoriaCalculo:
    producaoTotal: Decimal
    diariasEquivalentes: Decimal
    valorPorDiariaApurado: Decimal | None
    totalAPagar: Decimal
    complemento: Decimal
    valorFinalPorDiariaCompleta: Decimal | None
    pisoColetivo: Decimal


@dataclass(frozen=True)
class ResultadoBoletim:
    producaoTotal: Decimal
    diariasEquivalentes: Decimal
    valorPorDiariaApurado: Decimal | None
    totalAPagar: Decimal
    complemento: Decimal
    valorFinalPorDiariaCompleta: Decimal | None
    exatos: MemoriaCalculo

    @classmethod
    def from_exact(cls, exact: MemoriaCalculo) -> "ResultadoBoletim":
        return cls(
            reais(exact.producaoTotal), exact.diariasEquivalentes,
            reais(exact.valorPorDiariaApurado) if exact.valorPorDiariaApurado is not None else None,
            reais(exact.totalAPagar), reais(exact.complemento),
            reais(exact.valorFinalPorDiariaCompleta) if exact.valorFinalPorDiariaCompleta is not None else None,
            exact,
        )

    def resumo(self) -> dict[str, str | None]:
        return {name: format(value, "f") if value is not None else None for name, value in (
            ("producaoTotal", self.producaoTotal), ("diariasEquivalentes", self.diariasEquivalentes),
            ("valorPorDiariaApurado", self.valorPorDiariaApurado), ("totalAPagar", self.totalAPagar),
            ("complemento", self.complemento), ("valorFinalPorDiariaCompleta", self.valorFinalPorDiariaCompleta),
        )}


def calculate_totals(production: Decimal, equivalents: Decimal, floor: Decimal) -> MemoriaCalculo:
    """Shared kernel: compare exact collective values, without intermediate rounding."""
    for name, value in (("production", production), ("equivalents", equivalents), ("floor", floor)):
        decimal_nonnegative(value, name)
    with localcontext() as context:
        context.prec = 40
        collective_floor = equivalents * floor
        total = max(production, collective_floor)
        return MemoriaCalculo(production, equivalents, production / equivalents if equivalents else None,
                              total, total - production, total / equivalents if equivalents else None,
                              collective_floor)


def snapshot_summary(snapshot: Mapping[str, object]) -> dict[str, str | None]:
    """Project preserved amounts; never reprice lines or reapply today's floor."""
    with localcontext() as context:
        context.prec = 40
        production = Decimal(str(snapshot["production"]))
        equivalents = Decimal(str(snapshot["equivalent_days"]))
        total = Decimal(str(snapshot["total_payable"]))
        exact = MemoriaCalculo(production, equivalents, production / equivalents if equivalents else None,
                               total, Decimal(str(snapshot["supplement"])),
                               total / equivalents if equivalents else None,
                               Decimal(str(snapshot["collective_floor"])))
        return ResultadoBoletim.from_exact(exact).resumo()


class BoletimCalculator:
    def __init__(self, tarifas: Mapping[str, Decimal] | None = None, piso: Decimal = FLOOR) -> None:
        self.tarifas = dict(PRICES if tarifas is None else tarifas)
        self.piso = decimal_nonnegative(piso, "piso")
        if set(self.tarifas) != set(PRICES):
            raise ValueError("Informe as 14 tarifas do boletim.")
        for value in self.tarifas.values():
            decimal_nonnegative(value, "tarifa")

    def calcularBoletim(self, boletim: BoletimDiario) -> ResultadoBoletim:
        with localcontext() as context:
            context.prec = 40
            production = sum((m.quantidade * self.tarifas[m.categoria] for m in boletim.movimentacoes), Decimal(0))
            equivalents = sum((p.peso for p in boletim.equipe), Decimal(0))
            return ResultadoBoletim.from_exact(calculate_totals(production, equivalents, self.piso))
