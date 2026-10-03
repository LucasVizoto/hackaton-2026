from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.test import TestCase
from openpyxl import Workbook
from rest_framework.test import APIRequestFactory, force_authenticate

from catalog.models import Product, ProductDeposit

from .models import HistoricalLaborDay, HistoricalMovement, ImportBatch, SourceRow
from .services import PrivateDataError, import_directory, import_source
from .views import QualityView

PRODUCT_HEADERS = ["Nº do item", "Descrição do item", "Unidade de medida", "Peso", "Nome do grupo", "Grupo ", "Descrição", "depósito"]
MOVEMENT_HEADERS = ["Pedido Compra", "Data Lançamento", "Data do Documento", "Cod PN", "Nome", "Cod Item", "Desc Item", "Qtd", "Peso", "Deposito", "Nº Recebimento", "Data Recebimento", "Nota Fiscal de Entrada", "Chave de Acesso"]


def write_book(path, headers, rows):
    book = Workbook()
    book.active.append(headers)
    for row in rows:
        book.active.append(row)
    book.save(path)
    book.close()


class PrivateImportTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)

    def movement(self, product="P1", depot="MAT1", receipt=100):
        day = datetime(2025, 1, 2)
        return [1, day, day, "S1", "Fornecedor privado", product, "Descrição privada", 10, 100, depot, receipt, day, 1, "1" * 44]

    def test_reimport_hash_is_idempotent_and_versions_are_not_summed(self):
        path = self.path / "movement.xlsx"
        write_book(path, MOVEMENT_HEADERS, [self.movement()])
        self.assertEqual(import_source("movements", path)["status"], "imported")
        self.assertEqual(import_source("movements", path)["status"], "unchanged")
        self.assertEqual(HistoricalMovement.objects.count(), 1)
        write_book(path, MOVEMENT_HEADERS, [self.movement(), self.movement(receipt=101)])
        import_source("movements", path)
        self.assertEqual(HistoricalMovement.objects.count(), 3)
        self.assertEqual(HistoricalMovement.objects.filter(batch__active=True).count(), 2)
        self.assertEqual(ImportBatch.objects.filter(kind="movements", active=True).count(), 1)

    def test_product_in_multiple_depots_does_not_multiply_or_drop_history(self):
        products, movements = self.path / "products.xlsx", self.path / "movements.xlsx"
        write_book(products, PRODUCT_HEADERS, [["P1", "Produto", "UN", 1, "Grupo", "AGR", "Descrição", "MAT1"], ["P1", "Produto", "UN", 1, "Grupo", "AGR", "Descrição", "MAT2"]])
        import_source("products", products)
        write_book(movements, MOVEMENT_HEADERS, [self.movement(), self.movement(product="OLD", receipt=102), self.movement(depot="OLD_DEPOT", receipt=103)])
        result = import_source("movements", movements)
        self.assertEqual(Product.objects.count(), 1)
        self.assertEqual(ProductDeposit.objects.count(), 2)
        self.assertEqual(HistoricalMovement.objects.count(), 3)
        self.assertEqual(HistoricalMovement.objects.filter(product__isnull=True).count(), 1)
        self.assertEqual(result["issues"]["product_missing_from_current_catalog"], 1)
        self.assertEqual(result["issues"]["product_depot_pair_missing_from_current_catalog"], 1)
        self.assertEqual(HistoricalMovement.objects.values_list("reported_order_weight", flat=True).count(), 3)
        self.assertFalse(result["summary"]["trucks_identified"])
        self.assertFalse(result["summary"]["weight_semantics_confirmed"])

    def test_catalog_removed_product_is_not_a_current_match(self):
        path = self.path / "products.xlsx"
        write_book(path, PRODUCT_HEADERS, [["P1", "Produto", "UN", 1, "Grupo", "AGR", "Descrição", "MAT1"]])
        import_source("products", path)
        write_book(path, PRODUCT_HEADERS, [["P2", "Outro", "UN", 1, "Grupo", "AGR", "Descrição", "MAT1"]])
        import_source("products", path)
        movements = self.path / "movements.xlsx"
        write_book(movements, MOVEMENT_HEADERS, [self.movement()])
        import_source("movements", movements)
        self.assertIsNone(HistoricalMovement.objects.get().product_id)

    def test_dry_run_and_missing_sources_have_no_database_effect(self):
        path = self.path / "movements.xlsx"
        write_book(path, MOVEMENT_HEADERS, [self.movement()])
        result = import_source("movements", path, dry_run=True)
        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(ImportBatch.objects.count(), 0)
        self.assertEqual(HistoricalMovement.objects.count(), 0)
        with self.assertRaises(PrivateDataError):
            import_directory(self.path / "does_not_exist")
        with self.assertRaises(PrivateDataError):
            import_directory(self.path)

    def test_csv_preserves_rh_as_rh_and_does_not_create_bulletins(self):
        path = self.path / "labor.csv"
        path.write_text("data,dia_semana,chapas_presentes,chapas_operacao_cafe,valor_pago_dia\n2025-01-02,quinta,11,0,1100.00\n", encoding="utf-8")
        result = import_source("labor_days", path)
        self.assertEqual(HistoricalLaborDay.objects.count(), 1)
        self.assertEqual(str(HistoricalLaborDay.objects.get().payroll_paid), "1100.000000")
        self.assertFalse(result["summary"]["bulletin_cost_available"])
        self.assertFalse(result["summary"]["warehouse_allocation_available"])
        self.assertTrue(all(row.origin == "historico_importado" for row in HistoricalLaborDay.objects.all()))

    def test_quality_endpoint_exposes_no_private_rows_or_identifiers(self):
        path = self.path / "movements.xlsx"
        write_book(path, MOVEMENT_HEADERS, [self.movement()])
        import_source("movements", path)
        request = APIRequestFactory().get("/api/v1/data/quality/")
        user = get_user_model().objects.create_superuser(username="reviewer", password="private-local-test")
        force_authenticate(request, user=user)
        response = QualityView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        value = str(response.data)
        for private in ("Fornecedor privado", "Descrição privada", "S1", "P1", "1" * 44, "file_hash", "source_name", "original"):
            self.assertNotIn(private, value)
        self.assertEqual(response.data["origin"], "historico_importado")

    def test_quality_requires_authenticated_internal_user(self):
        factory = APIRequestFactory()
        self.assertEqual(QualityView.as_view()(factory.get("/quality/" )).status_code, 401)
        user = get_user_model().objects.create_user(username="external", password="private-local-test")
        request = factory.get("/quality/")
        force_authenticate(request, user=user)
        self.assertEqual(QualityView.as_view()(request).status_code, 403)

    def test_row_outcomes_count_multiple_problems_once_and_reconcile_preserved_rows(self):
        suppliers = self.path / "suppliers.xlsx"
        write_book(suppliers, ["COD", "FORNECEDOR", "CNPJ"], [["S1", "Fornecedor sintético", "DOC-SYN"]])
        import_source("suppliers", suppliers)
        products = self.path / "products.xlsx"
        write_book(products, PRODUCT_HEADERS, [["P1", "Produto", "UN", 1, "Grupo", "AGR", "Descrição", "MAT1"]])
        import_source("products", products)
        movements = self.path / "movements.xlsx"
        pending = self.movement(product="OLD", receipt=102)
        pending[13] = "invalid-key-synthetic"
        write_book(movements, MOVEMENT_HEADERS, [self.movement(), pending])
        result = import_source("movements", movements)
        self.assertEqual(result["summary"]["accepted_rows"], 1)
        self.assertEqual(result["summary"]["pending_rows"], 1)
        self.assertEqual(result["summary"]["rejected_rows"], 0)
        self.assertEqual(result["summary"]["preserved_rows"], 2)
        self.assertEqual(sum(result["summary"][field] for field in [
            "accepted_rows", "pending_rows", "rejected_rows"
        ]), result["row_count"])
        self.assertEqual(HistoricalMovement.objects.count(), 2)
        row = HistoricalMovement.objects.get(source_row=3)
        self.assertIn("invalid_invoice_key", row.problems)
        self.assertIn("product_missing_from_current_catalog", row.problems)
        self.assertIsNone(row.product_id)
        second = import_source("movements", movements)
        self.assertEqual(second["status"], "unchanged")
        self.assertEqual(second["summary"], result["summary"])
        self.assertEqual(HistoricalMovement.objects.count(), 2)

    def test_catalog_pending_repetitions_keep_original_rows_and_reasons(self):
        products = self.path / "products.xlsx"
        accepted = ["P1", "Produto sintético", "UN", 1, "Grupo", "AGR", "Descrição", "MAT1"]
        missing_weight = ["P2", "Outro sintético", "UN", None, "Grupo", "AGR", "Descrição", "MAT2"]
        write_book(products, PRODUCT_HEADERS, [accepted, missing_weight, accepted])
        result = import_source("products", products)
        self.assertEqual(result["summary"]["accepted_rows"], 1)
        self.assertEqual(result["summary"]["pending_rows"], 2)
        self.assertEqual(result["summary"]["preserved_rows"], 3)
        self.assertEqual(SourceRow.objects.count(), 3)
        self.assertEqual(ProductDeposit.objects.count(), 2)
        self.assertEqual(SourceRow.objects.get(source_row=3).problems, ["missing_weight"])
        self.assertEqual(SourceRow.objects.get(source_row=4).problems, ["duplicate_product_depot_row_preserved"])
        self.assertEqual(SourceRow.objects.get(source_row=2).original, SourceRow.objects.get(source_row=4).original)
