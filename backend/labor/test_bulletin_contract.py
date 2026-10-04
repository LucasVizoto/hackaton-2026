from dataclasses import replace
from datetime import date
from decimal import Decimal as D

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from labor.bulletin import (BoletimCalculator, BoletimDiario, Categoria, MembroEquipe,
                            Modalidade, Movimentacao, snapshot_summary)
from labor.calculation import calculate_v2, allocate_individuals
from labor.constants import PRICES
from labor.models import DailyBulletin, ServiceRate
from labor.tests import labor_fixtures, official_payload


def official_bulletin():
    return BoletimDiario("adubo", date(2026, 10, 5), (
        Movimentacao(Categoria.FERTILIZANTES, Modalidade.DESCARGA, D("2778")),
        Movimentacao(Categoria.AGROQUIMICO, Modalidade.DESCARGA, D("30")),
        Movimentacao(Categoria.SERVICOS_DIVERSOS, Modalidade.DESCARGA, D("40")),
    ), tuple(MembroEquipe(str(i), f"M{i}", f"Pessoa {i}", D("1")) for i in range(11)))


class TypedBulletinTests(SimpleTestCase):
    def test_required_official_scenario(self):
        result = BoletimCalculator().calcularBoletim(official_bulletin())
        self.assertEqual(result.resumo(), {
            "producaoTotal": "918.20", "diariasEquivalentes": "11",
            "valorPorDiariaApurado": "83.47", "totalAPagar": "991.90",
            "complemento": "73.71", "valorFinalPorDiariaCompleta": "90.17",
        })
        self.assertEqual(result.exatos.producaoTotal, D("918.1952"))
        self.assertEqual(result.exatos.totalAPagar, D("991.9041"))
        self.assertEqual(result.exatos.complemento, D("73.7089"))
        self.assertEqual(result.exatos.valorFinalPorDiariaCompleta, D("90.1731"))

    def test_half_day_retains_guard_digits_and_empty_draft_has_no_division(self):
        bulletin = official_bulletin()
        half = replace(bulletin, equipe=bulletin.equipe[:-1] + (replace(bulletin.equipe[-1], peso=D("0.5")),))
        result = BoletimCalculator().calcularBoletim(half)
        self.assertEqual(result.diariasEquivalentes, D("10.5"))
        self.assertEqual(result.exatos.totalAPagar, D("946.81755"))
        self.assertEqual(result.totalAPagar, D("946.82"))
        empty = BoletimCalculator().calcularBoletim(replace(bulletin, equipe=()))
        self.assertIsNone(empty.valorPorDiariaApurado)
        self.assertIsNone(empty.valorFinalPorDiariaCompleta)

    def test_all_categories_and_modalities_and_no_production_ceiling(self):
        movements = tuple(Movimentacao(category, mode, D("1000")) for category in Categoria for mode in Modalidade)
        result = BoletimCalculator().calcularBoletim(replace(official_bulletin(), movimentacoes=movements))
        self.assertEqual(result.exatos.producaoTotal, sum(PRICES.values()) * 3000)
        self.assertEqual(result.totalAPagar, result.producaoTotal)
        self.assertEqual(result.complemento, 0)
        zero = BoletimCalculator().calcularBoletim(replace(official_bulletin(), movimentacoes=()))
        self.assertEqual(zero.totalAPagar, D("991.90"))
        self.assertEqual(zero.complemento, zero.totalAPagar)

    def test_invalid_inputs_do_not_reach_arithmetic(self):
        for value in (0.5, True, "1", D("NaN"), D("Infinity"), D("-1")):
            with self.subTest(value=value), self.assertRaises((TypeError, ValueError)):
                Movimentacao(Categoria.PECAS, Modalidade.DESCARGA, value)
        for weight in (D("0"), D("0.75"), D("2"), 0.5):
            with self.assertRaises((ValueError, TypeError)):
                MembroEquipe("a", "A", "Pessoa", weight)
        for category, mode in (("unknown", "unloading"), ("PECAS", "unknown")):
            with self.assertRaises(ValueError):
                Movimentacao(category, mode, D("1"))
        b = official_bulletin()
        with self.assertRaises(ValueError):
            replace(b, equipe=b.equipe + (b.equipe[0],))
        with self.assertRaises(ValueError):
            replace(b, equipe=tuple(MembroEquipe(str(i), str(i), "Pessoa", D("1")) for i in range(21)))
        self.assertEqual(len(replace(b, equipe=tuple(MembroEquipe(str(i), str(i), "Pessoa", D("1")) for i in range(20))).equipe), 20)
        with self.assertRaises(TypeError):
            BoletimCalculator(piso=90.1731)

    def test_legacy_adapter_and_typed_contract_share_exact_totals(self):
        b = official_bulletin()
        lines = [{m.modalidade: str(m.quantidade), "price": PRICES[m.categoria]} for m in b.movimentacoes]
        people = [{"worker": p.identificador, "fraction": str(p.peso)} for p in b.equipe]
        calculation = calculate_v2(lines, people)
        self.assertEqual(calculation["resumo"], BoletimCalculator().calcularBoletim(b).resumo())
        allocations = allocate_individuals(calculation, people)
        self.assertEqual(allocations, allocate_individuals(calculation, list(reversed(people))))
        self.assertEqual(sum(D(a["display"]["total_payable"]) for a in allocations), D("991.90"))

    def test_snapshot_projection_does_not_reapply_current_floor(self):
        snapshot = {"production": "1", "equivalent_days": "1", "total_payable": "12.3456",
                    "supplement": "11.3456", "collective_floor": "12.3456"}
        self.assertEqual(snapshot_summary(snapshot)["valorFinalPorDiariaCompleta"], "12.35")
        self.assertEqual(snapshot["total_payable"], "12.3456")


class BulletinSummaryAPITests(TestCase):
    def setUp(self):
        labor_fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.operator)

    def test_preview_close_and_read_agree_and_read_never_rewrites_snapshot(self):
        payload = official_payload(self.warehouse, self.workers)
        preview = self.client.post("/api/v2/bulletins/preview/", payload, format="json")
        self.assertEqual(preview.status_code, 200, preview.data)
        created = self.client.post("/api/v2/bulletins/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        pk = created.data["id"]
        closed = self.client.post(f"/api/v2/bulletins/{pk}/close/", {"revision": created.data["revision"]})
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(preview.data["resumo"], closed.data["calculation"]["resumo"])
        stored = DailyBulletin.objects.get(pk=pk)
        # Simulate an already closed snapshot published before the new summary.
        snapshot = {k: v for k, v in stored.calculation.items() if k != "resumo"}
        DailyBulletin.objects.filter(pk=pk).update(calculation=snapshot)
        ServiceRate.objects.create(code="FERTILIZANTES", label="Tarifa posterior", price=D("99"))
        self.client.force_authenticate(self.manager)
        detail = self.client.get(f"/api/v2/bulletins/{pk}/")
        self.assertEqual(detail.data["calculation"]["resumo"], preview.data["resumo"])
        self.assertEqual(self.client.get("/api/v2/bulletins/").data["results"][0]["calculation"]["resumo"], preview.data["resumo"])
        stored.refresh_from_db()
        self.assertEqual(stored.calculation, snapshot)
        self.assertEqual(stored.allocations.filter(active=True).count(), 11)
