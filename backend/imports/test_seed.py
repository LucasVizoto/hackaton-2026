import io
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from openpyxl import Workbook, load_workbook
from rest_framework.test import APIRequestFactory, force_authenticate

from catalog.models import Depot, Equipment, Product, ProductDeposit, Supplier
from core.models import UserProfile
from labor.constants import RATE_TABLE
from labor.models import BulletinRevision, DailyBulletin
from receiving.models import Appointment, CapacityHold, GlobalSlot, Invoice, InvoiceItem, ReceivingEvent, WarehouseVisit
from receiving.views import AttachmentDownload

from .models import HistoricalLaborDay, HistoricalMovement, HistoricalStock, HistoricalWorkerDay, ImportBatch, SeedRun, SourceFile
from .seed import SYSTEM_USERNAME, apply_seed
from .seed_readers import BULLETIN_FILE, EQUIPMENT_FILE, PAYROLL_FILES, REFERENCE_FILES, SOURCE_FILES, STOCK_FILES, prepare_seed
from .services import PrivateDataError, import_source
from .tests import MOVEMENT_HEADERS, PRODUCT_HEADERS, write_book
from .views import QualityView

KEY = "1" * 44
PDF_KEY = "2" * 44
REGISTRATIONS = list(range(1001, 1016))
WORKER_ALIAS = "CHAPA_9001"


def package(root):
    for relative in {*SOURCE_FILES.values(), *STOCK_FILES, *PAYROLL_FILES, EQUIPMENT_FILE, *REFERENCE_FILES}:
        (root / relative).parent.mkdir(parents=True, exist_ok=True)
    for relative in REFERENCE_FILES:
        (root / relative).write_bytes(b"%PDF-1.4\nfixture" if relative.endswith(".pdf") else b"synthetic reference")
    write_book(root / SOURCE_FILES["products"], PRODUCT_HEADERS, [
        ["P1", "Produto sintético", "UN", 1, "Grupo", "AGR", "Descrição", "MATLoja"],
        ["P1", "Produto sintético", "UN", 1, "Grupo", "AGR", "Descrição", "MATMaq"],
    ])
    write_book(root / SOURCE_FILES["suppliers"], ["COD", "FORNECEDOR", "CNPJ"],
               [["S1", "Fornecedor sintético", "00000000000001"]])
    day = datetime(2025, 1, 2)
    write_book(root / SOURCE_FILES["movements"], MOVEMENT_HEADERS, [
        [1, day, day, "S1", "Fornecedor", "P1", "Produto", 2, 10, "MATLoja", 100, day, 1, KEY],
        [1, day, day, "S1", "Fornecedor", "OLD", "Produto antigo", 3, 10, "MATMaq", 101, day, 2, PDF_KEY],
    ])
    (root / SOURCE_FILES["labor_days"]).write_text(
        "data,dia_semana,chapas_presentes,chapas_operacao_cafe,valor_pago_dia\n2025-01-02,quinta,1,0,10.00\n",
        encoding="utf-8",
    )
    for relative in STOCK_FILES:
        write_book(root / relative, ["ESTOQUE", None, None], [
            ["N.ITEM", "DESCRIÇÃO", "QTD.SAP"], ["P1", "Produto", Decimal("2.5")],
            [None, "GRUPO", None], ["OLD", "Fora do catálogo", 3],
        ])
    for relative in PAYROLL_FILES:
        b = Workbook()
        s = b.active
        s.title = "JANEIRO 2025" if "2025" in relative else "JULHO 2027"
        s.cell(1, 1, "LOCAL")
        s.cell(1, 2, "NOME")
        s.cell(1, 13, datetime(2025, 1, 2) if "2025" in relative else datetime(2026, 7, 1))
        s.cell(1, 14, datetime(1900, 1, 3) if "2025" in relative else datetime(2026, 7, 2))
        s.cell(2, 1, "LOCAL_SINTETICO")
        s.cell(2, 2, WORKER_ALIAS)
        s.cell(2, 3, "=SUM(M2:N2)")
        s.cell(2, 13, 10)
        s.cell(2, 14, 5)
        b.save(root / relative)
        b.close()
    b = Workbook()
    s = b.active
    s.title = "Plan1"
    s.cell(3, 2, "ADUBO COCAPEC MATRIZ")
    s.cell(5, 9, datetime(2025, 11, 17))
    for index, registration in enumerate(REGISTRATIONS, 3):
        s.cell(index, 14, registration)
        s.cell(index, 15, WORKER_ALIAS if registration == REGISTRATIONS[0] else f"CHAPA_{index + 9000}")
    for index, (_, label, price) in enumerate(RATE_TABLE):
        row = 10 + index * 2
        s.cell(row, 1, label)
        s.cell(row, 8, Decimal(price))
    s.cell(24, 3, 30)
    s.cell(26, 3, 2378)
    s.cell(26, 4, 400)
    s.cell(36, 4, 40)
    s.cell(38, 8, Decimal("90.1731"))
    s.cell(40, 8, Decimal("45.0786"))
    for index, registration in enumerate(REGISTRATIONS[:10], 47):
        s.cell(index, 3, registration)
    s.cell(47, 8, REGISTRATIONS[10])
    b.save(root / BULLETIN_FILE)
    b.close()
    write_book(root / EQUIPMENT_FILE, ["EQUIPAMENTOS", None], [
        [None, None], ["Equipamento", "Utilização"], [None, None],
        ["Paleteira Manual", "Mover cargas"], ["Empilhadeira a Gás", "Descarga"],
        ["Carrinho manual", "Movimentação"], ["Transpaleteira Elétrica", "Descarga e movimentação"],
    ])
    xml_dir = root / "01_notas_fiscais/xml"
    pdf_dir = root / "01_notas_fiscais/danfe_pdf"
    xml_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir.mkdir(parents=True, exist_ok=True)
    content = f'''<?xml version="1.0"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe{KEY}">
    <ide><nNF>1</nNF><dhEmi>2025-01-02T08:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>00000000000001</CNPJ><xNome>Fornecedor sintético</xNome></emit>
    <det nItem="1"><prod><cProd>SUPPLIER-P1</cProd><xProd>Item do fornecedor</xProd><uCom>UN</uCom>
    <qCom>2.000000</qCom><vUnCom>0.1234567890</vUnCom></prod></det></infNFe></NFe>'''.encode()
    (xml_dir / f"{KEY}.xml").write_bytes(content)
    (xml_dir / f"{KEY} (1).xml").write_bytes(content)
    for key in (KEY, PDF_KEY):
        (pdf_dir / f"{key}.pdf").write_bytes(b"%PDF-1.4\nsynthetic DANFE")


class SeedTestSetup:
    def setUp(self):
        super().setUp()
        self.sources = TemporaryDirectory()
        self.media = TemporaryDirectory()
        self.addCleanup(self.sources.cleanup)
        self.addCleanup(self.media.cleanup)
        self.root = Path(self.sources.name)
        self.media_root = Path(self.media.name)
        setting = override_settings(MEDIA_ROOT=self.media.name)
        setting.enable()
        self.addCleanup(setting.disable)
        package(self.root)

    def install(self):
        return apply_seed(prepare_seed(self.root))


class CompleteSeedTests(SeedTestSetup, TestCase):
    def test_complete_package_and_accurate_bulletin(self):
        data = prepare_seed(self.root)
        report = apply_seed(data)
        self.assertEqual(report["status"], "completed")
        self.assertEqual(SourceFile.objects.count(), len(data["manifest"]))
        self.assertEqual(Product.objects.count(), 1)
        self.assertEqual(ProductDeposit.objects.count(), 2)
        self.assertEqual(HistoricalMovement.objects.count(), 2)
        self.assertEqual(HistoricalStock.objects.count(), 8)
        self.assertEqual(HistoricalStock.objects.filter(product=None).count(), 4)
        self.assertFalse(HistoricalStock.objects.exclude(snapshot_on=None).exists())
        self.assertEqual(HistoricalLaborDay.objects.get().payroll_paid, Decimal("10"))
        self.assertEqual(Equipment.objects.count(), 4)
        self.assertFalse(Equipment.objects.exclude(warehouse=None, mobile=None).exists())
        self.assertEqual(Depot.objects.get(code="MATLoja").warehouse.code, "LOJA")
        self.assertEqual(Invoice.objects.count(), 2)
        self.assertEqual(InvoiceItem.objects.count(), 1)
        self.assertEqual(InvoiceItem.objects.get().supplier_code, "SUPPLIER-P1")
        self.assertEqual(InvoiceItem.objects.get().unit_value, Decimal("0.1234567890"))
        self.assertEqual(Invoice.objects.get(access_key=PDF_KEY).extraction_status, "manual")
        self.assertEqual(Invoice.objects.get(access_key=KEY).source_files.count(), 3)
        bulletin = DailyBulletin.objects.get()
        self.assertEqual(bulletin.participants.count(), 11)
        self.assertEqual(bulletin.calculation["production"], "918.1952")
        self.assertEqual(bulletin.calculation["total_payable"], "991.9041")
        self.assertEqual(bulletin.calculation["supplement"], "73.7089")
        self.assertIsNone(bulletin.closed_at)
        self.assertIsNotNone(BulletinRevision.objects.get().recorded_at)
        for model in (Appointment, GlobalSlot, WarehouseVisit, ReceivingEvent, CapacityHold):
            self.assertEqual(model.objects.count(), 0)
        account = get_user_model().objects.get(username=SYSTEM_USERNAME)
        self.assertFalse(account.is_active)
        self.assertFalse(account.has_usable_password())
        self.assertFalse(UserProfile.objects.filter(user=account).exists())

    def test_repeat_preserves_ids_and_source_bytes_and_rejects_changed_baseline(self):
        self.install()
        files = list(SourceFile.objects.order_by("pk").values())
        invoices = list(Invoice.objects.order_by("pk").values())
        paths = sorted(str(p) for p in self.media_root.rglob("*") if p.is_file())
        self.assertEqual(self.install()["status"], "unchanged")
        self.assertEqual(list(SourceFile.objects.order_by("pk").values()), files)
        self.assertEqual(list(Invoice.objects.order_by("pk").values()), invoices)
        self.assertEqual(sorted(str(p) for p in self.media_root.rglob("*") if p.is_file()), paths)
        (self.root / "LEIA-ME.md").write_text("changed", encoding="utf-8")
        with self.assertRaisesMessage(PrivateDataError, "outro baseline"):
            self.install()
        self.assertEqual(SeedRun.objects.count(), 1)

    def test_missing_or_invalid_source_does_not_apply_migrations_or_seed(self):
        (self.root / SOURCE_FILES["products"]).unlink()
        with patch("imports.management.commands.bootstrap_database.call_command") as migrate:
            with self.assertRaises(CommandError):
                call_command("bootstrap_database", path=str(self.root), stdout=io.StringIO())
        migrate.assert_not_called()
        self.assertEqual(SeedRun.objects.count(), 0)
        self.assertFalse(any(self.media_root.rglob("*")))

    def test_dry_run_has_no_database_migration_or_media_effect(self):
        output = io.StringIO()
        with patch("imports.management.commands.bootstrap_database.call_command") as migrate:
            call_command("bootstrap_database", path=str(self.root), dry_run=True, stdout=output)
        migrate.assert_not_called()
        self.assertIn('"status": "dry_run"', output.getvalue())
        self.assertEqual(SeedRun.objects.count(), 0)
        self.assertEqual(Product.objects.count(), 0)
        self.assertFalse(any(self.media_root.rglob("*")))

    def test_catalog_conflict_preserves_existing_account_and_records(self):
        supplier = Supplier.objects.create(code="S1", name="Existing", document="00000000000001")
        user = get_user_model().objects.create_user("existing", password="unchanged-password")
        password = user.password
        with self.assertRaisesMessage(PrivateDataError, "Conflito"):
            self.install()
        supplier.refresh_from_db()
        user.refresh_from_db()
        self.assertEqual(supplier.name, "Existing")
        self.assertEqual(user.password, password)
        self.assertEqual(SeedRun.objects.count(), 0)
        self.assertFalse(any(self.media_root.rglob("*")))

    def test_equivalent_legacy_import_reuses_catalog_and_history(self):
        for kind in SOURCE_FILES:
            import_source(kind, self.root / SOURCE_FILES[kind])
        ids = list(HistoricalMovement.objects.order_by("pk").values_list("pk", flat=True))
        self.install()
        self.assertEqual(list(HistoricalMovement.objects.order_by("pk").values_list("pk", flat=True)), ids)
        self.assertEqual(ImportBatch.objects.filter(kind="products", active=True).count(), 1)
        self.assertIsNotNone(ImportBatch.objects.get(kind="products").source_file_id)

    def test_file_copy_failure_rolls_back_and_removes_only_new_blobs(self):
        data = prepare_seed(self.root)
        storage = SourceFile._meta.get_field("file").storage
        preserved = self.media_root / "existing-private.txt"
        preserved.write_text("preserve", encoding="utf-8")
        original = storage.save
        calls = 0

        def fail_after_copy(name, content, *args, **kwargs):
            nonlocal calls
            calls += 1
            saved = original(name, content, *args, **kwargs)
            if calls == 2:
                raise OSError("simulated partial copy")
            return saved

        with patch.object(storage, "save", side_effect=fail_after_copy):
            with self.assertRaises(OSError):
                apply_seed(data)
        self.assertEqual(SeedRun.objects.count(), 0)
        self.assertEqual(SourceFile.objects.count(), 0)
        self.assertEqual(list(p for p in self.media_root.rglob("*") if p.is_file()), [preserved])
        self.assertEqual(self.install()["status"], "completed")

    def test_late_failure_rolls_back_every_dataset_and_can_resume(self):
        with patch("imports.seed.install_bulletin", side_effect=PrivateDataError("late failure")):
            with self.assertRaises(PrivateDataError):
                self.install()
        for model in (SeedRun, SourceFile, Product, Supplier, Invoice, HistoricalMovement, HistoricalWorkerDay):
            self.assertEqual(model.objects.count(), 0)
        self.assertFalse(any(p.is_file() for p in self.media_root.rglob("*")))
        self.install()
        self.assertEqual(DailyBulletin.objects.count(), 1)

    def test_sources_changed_after_validation_abort_and_clean_up(self):
        data = prepare_seed(self.root)
        (self.root / "LEIA-ME.md").write_text("changed after validation", encoding="utf-8")
        with self.assertRaisesMessage(PrivateDataError, "alterada"):
            apply_seed(data)
        self.assertEqual(SeedRun.objects.count(), 0)
        self.assertFalse(any(p.is_file() for p in self.media_root.rglob("*")))

    def test_payroll_dates_and_original_formulas_are_preserved(self):
        self.install()
        invalid = HistoricalWorkerDay.objects.get(day=None)
        self.assertFalse(invalid.usable)
        self.assertIn("1900", invalid.declared_date)
        self.assertIn("invalid_declared_date", invalid.problems)
        valid = HistoricalWorkerDay.objects.get(day=date(2026, 7, 1))
        self.assertTrue(valid.usable)
        self.assertIn("sheet_title_date_mismatch", valid.problems)
        self.assertEqual(valid.worker.registration, str(REGISTRATIONS[0]))
        batch = ImportBatch.objects.get(kind="worker_days", source_key=PAYROLL_FILES[0])
        self.assertEqual(batch.source_rows.get(source_row=2).original["C"]["value"], "=SUM(M2:N2)")
        self.assertEqual(HistoricalLaborDay.objects.get().worker_count, 1)

    def test_payroll_identical_cells_deduplicate_and_conflicts_are_unusable(self):
        path = self.root / PAYROLL_FILES[0]
        b = load_workbook(path)
        s = b.active
        s.cell(1, 15, datetime(2025, 1, 2))
        s.cell(2, 15, 20)
        duplicate = b.copy_worksheet(s)
        duplicate.title = "DUPLICATE"
        b.save(path)
        b.close()
        self.install()
        conflicts = HistoricalWorkerDay.objects.filter(day=date(2025, 1, 2))
        self.assertEqual(conflicts.count(), 4)
        self.assertFalse(conflicts.filter(usable=True).exists())
        self.assertTrue(all("conflicting_worker_day" in r.problems for r in conflicts))
        # Add an identical observation in a valid month without inventing its date.
        rows = prepare_seed(self.root)["payroll"][PAYROLL_FILES[1]]
        self.assertTrue(all(r["usable"] for r in rows))

    def test_invoice_supplier_conflicts_preserve_files_without_fake_supplier(self):
        path = self.root / SOURCE_FILES["suppliers"]
        write_book(path, ["COD", "FORNECEDOR", "CNPJ"], [["S1", "Fornecedor", "99999999999999"]])
        report = self.install()
        self.assertEqual(report["invoices_pending"], 1)
        self.assertFalse(Invoice.objects.filter(access_key=KEY).exists())
        xml = SourceFile.objects.get(relative_path=f"01_notas_fiscais/xml/{KEY}.xml")
        self.assertIsNone(xml.invoice_id)
        self.assertIn("supplier_document_movement_conflict", xml.problems)
        self.assertTrue(xml.file.storage.exists(xml.file.name))

    def test_quality_redaction_and_download_supplier_isolation(self):
        self.install()
        factory = APIRequestFactory()
        admin = get_user_model().objects.create_superuser("reviewer", password="synthetic-test-only")
        request = factory.get("/api/v1/data/quality/")
        force_authenticate(request, admin)
        response = QualityView.as_view()(request)
        value = str(response.data)
        for private in (KEY, "relative_path", "sha256", "source_key", "original", WORKER_ALIAS):
            self.assertNotIn(private, value)
        self.assertEqual(response.data["baseline"]["stock_rows"], 8)
        invoice = Invoice.objects.get(access_key=KEY)
        owner = get_user_model().objects.create_user("owner")
        UserProfile.objects.create(user=owner, role="supplier", supplier=invoice.supplier)
        request = factory.get("/download/")
        force_authenticate(request, owner)
        response = AttachmentDownload.as_view()(request, pk=invoice.pk)
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"SUPPLIER-P1", b"".join(response.streaming_content))
        response.file_to_stream.close()
        outsider = get_user_model().objects.create_user("outsider")
        other = Supplier.objects.create(code="S2", name="Other")
        UserProfile.objects.create(user=outsider, role="supplier", supplier=other)
        request = factory.get("/download/")
        force_authenticate(request, outsider)
        self.assertEqual(AttachmentDownload.as_view()(request, pk=invoice.pk).status_code, 404)

    def test_demo_skips_only_the_occupied_historical_example(self):
        self.install()
        historical = DailyBulletin.objects.get()
        original = historical.calculation.copy()
        with patch.dict(os.environ, {"DEMO_PASSWORD": "synthetic-test-password"}):
            call_command("seed_demo", stdout=io.StringIO())
        historical.refresh_from_db()
        self.assertEqual(historical.origin, "historico_importado")
        self.assertEqual(historical.calculation, original)
        self.assertEqual(DailyBulletin.objects.filter(origin="demo_sintetico").count(), 9)

    def test_identical_payroll_observations_have_one_usable_record(self):
        path = self.root / PAYROLL_FILES[1]
        book = load_workbook(path)
        duplicate = book.copy_worksheet(book.active)
        duplicate.title = "JULHO 2026"
        book.save(path)
        book.close()
        self.install()
        observations = HistoricalWorkerDay.objects.filter(day=date(2026, 7, 1))
        self.assertEqual(observations.count(), 2)
        self.assertEqual(observations.filter(usable=True).count(), 1)
        self.assertEqual(observations.get(usable=True).source_sheet, "JULHO 2026")

    def test_malformed_workbook_and_xml_abort_before_writing(self):
        path = self.root / EQUIPMENT_FILE
        path.write_bytes(b"not an Excel workbook")
        with self.assertRaises(CommandError):
            call_command("seed_hackathon", path=str(self.root), stdout=io.StringIO())
        self.assertEqual(SeedRun.objects.count(), 0)
        self.assertFalse(any(self.media_root.rglob("*")))

    def test_unknown_depot_is_preserved_without_an_invented_warehouse(self):
        path = self.root / SOURCE_FILES["products"]
        book = load_workbook(path)
        book.active.cell(2, 8, "UNKNOWN")
        book.save(path)
        book.close()
        self.install()
        self.assertIsNone(Depot.objects.get(code="UNKNOWN").warehouse_id)

    def test_invalid_structure_and_schema_values_abort_before_migrations(self):
        for case in ("empty_catalog", "short_stock", "short_equipment", "overflow_price", "long_code", "changed_category"):
            with self.subTest(case=case):
                package(self.root)
                if case == "empty_catalog":
                    write_book(self.root / SOURCE_FILES["products"], PRODUCT_HEADERS, [])
                elif case == "short_stock":
                    write_book(self.root / next(iter(STOCK_FILES)), ["title"], [["N.ITEM"]])
                elif case == "short_equipment":
                    write_book(self.root / EQUIPMENT_FILE, ["title"], [])
                else:
                    path = self.root / (SOURCE_FILES["movements"] if case == "long_code" else BULLETIN_FILE)
                    book = load_workbook(path)
                    if case == "overflow_price":
                        book.active.cell(10, 8, Decimal("1e14"))
                    elif case == "changed_category":
                        book.active.cell(10, 1, "Unexpected category")
                    else:
                        book.active.cell(2, 6, "X" * 81)
                    book.save(path)
                    book.close()
                with patch("imports.management.commands.bootstrap_database.call_command") as migrate:
                    with self.assertRaises(CommandError):
                        call_command("bootstrap_database", path=str(self.root), stdout=io.StringIO())
                migrate.assert_not_called()
                self.assertEqual(SeedRun.objects.count(), 0)
                self.assertFalse(any(self.media_root.rglob("*")))

    def test_pdf_with_absent_supplier_remains_a_pending_source(self):
        path = self.root / SOURCE_FILES["movements"]
        book = load_workbook(path)
        book.active.cell(3, 4, "ABSENT")
        book.save(path)
        book.close()
        self.install()
        self.assertEqual(Invoice.objects.count(), 1)
        source = SourceFile.objects.get(relative_path=f"01_notas_fiscais/danfe_pdf/{PDF_KEY}.pdf")
        self.assertIsNone(source.invoice_id)
        self.assertIn("pdf_supplier_unresolved", source.problems)
        self.assertTrue(source.file.storage.exists(source.file.name))

    def test_dry_run_matches_repeat_semantics_and_rejects_another_manifest(self):
        self.install()
        Product.objects.filter(code="P1").update(name="Operator edit")
        call_command("seed_hackathon", path=str(self.root), dry_run=True, stdout=io.StringIO())
        self.assertEqual(self.install()["status"], "unchanged")
        self.assertEqual(Product.objects.get().name, "Operator edit")
        (self.root / "LEIA-ME.md").write_text("Changed baseline", encoding="utf-8")
        with self.assertRaisesMessage(CommandError, "outro baseline"):
            call_command("seed_hackathon", path=str(self.root), dry_run=True, stdout=io.StringIO())

    def test_detailed_report_is_private_and_cannot_overwrite_sources(self):
        with TemporaryDirectory() as destination:
            path = Path(destination) / "report.json"
            output = io.StringIO()
            call_command("seed_hackathon", path=str(self.root), report=str(path), stdout=output)
            report = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(len(report["manifest"]), SourceFile.objects.count())
            self.assertEqual(report["manifest_hash"], SeedRun.objects.get().manifest_hash)
            self.assertIn("file_problems", report)
            self.assertNotIn("manifest_hash", output.getvalue())
        with patch("imports.management.commands.bootstrap_database.call_command") as migrate:
            with self.assertRaisesMessage(CommandError, "fora da pasta"):
                call_command("bootstrap_database", path=str(self.root), report=str(self.root / "LEIA-ME.md"), stdout=io.StringIO())
        migrate.assert_not_called()

    def test_conflicting_xml_versions_preserve_every_source_without_a_note(self):
        path = self.root / f"01_notas_fiscais/xml/{KEY} (1).xml"
        path.write_bytes(path.read_bytes().replace(b"2.000000", b"3.000000"))
        report = self.install()
        self.assertEqual(report["invoices_pending"], 1)
        self.assertFalse(Invoice.objects.filter(access_key=KEY).exists())
        sources = SourceFile.objects.filter(relative_path__contains=KEY)
        self.assertEqual(sources.count(), 3)
        self.assertTrue(all("conflicting_invoice_versions" in s.problems and s.invoice_id is None for s in sources))

    def test_payroll_values_outside_precision_are_preserved_without_rounding(self):
        path = self.root / PAYROLL_FILES[0]
        book = load_workbook(path)
        book.active.cell(2, 13, 10.1234567)
        book.save(path)
        book.close()
        self.install()
        observation = HistoricalWorkerDay.objects.get(day=date(2025, 1, 2))
        self.assertIsNone(observation.payroll_paid)
        self.assertFalse(observation.usable)
        self.assertEqual(observation.original["value"], 10.1234567)
        self.assertIn("payroll_outside_precision", observation.problems)


class ConcurrentSeedTests(SeedTestSetup, TransactionTestCase):
    def test_two_initializations_install_one_baseline(self):
        data = prepare_seed(self.root)

        def run():
            close_old_connections()
            try:
                return apply_seed(data)["status"]
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(run) for _ in range(2)]
            statuses = sorted(f.result(timeout=30) for f in futures)
        self.assertEqual(statuses, ["completed", "unchanged"])
        self.assertEqual(SeedRun.objects.count(), 1)
        self.assertEqual(Invoice.objects.count(), 2)
        self.assertEqual(HistoricalMovement.objects.count(), 2)
