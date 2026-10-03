"""Atomic baseline installation. No operational records or passwords are overwritten."""

import copy
import hashlib
import logging
from collections import Counter, defaultdict

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import connection, transaction
from django.utils import timezone

from catalog.models import Depot, Equipment, Product, Supplier, Warehouse, Worker
from labor.calculation import calculate
from labor.models import BulletinLine, BulletinParticipant, BulletinRevision, DailyBulletin, ServiceRate
from receiving.models import Invoice, InvoiceItem

from .models import HistoricalStock, HistoricalWorkerDay, ImportBatch, SeedRun, SourceFile, SourceRow
from .seed_readers import BULLETIN_FILE, SEED_VERSION, SOURCE_FILES, file_digest
from .services import IMPORTER_VERSION, PrivateDataError, check_catalog_conflicts, import_source, record_outcomes

logger = logging.getLogger(__name__)
SEED_LOCK = 2026100301
BOOTSTRAP_LOCK = 2026100302
SYSTEM_USERNAME = "_seed_hackathon"
ORIGIN = "historico_importado"
WAREHOUSES = {"ADUBO": "Adubo", "INSUMOS": "Insumos", "LOJA": "Loja", "MAQUINAS": "Máquinas"}
DEPOT_WAREHOUSES = {
    "MATFerti": "ADUBO", "MATDefe": "INSUMOS", "MATGeral": "INSUMOS",
    "MATLoja": "LOJA", "MATMaq": "MAQUINAS",
}


def assert_equivalent(instance, attrs, label):
    if instance is not None and any(getattr(instance, field) != value for field, value in attrs.items()):
        raise PrivateDataError(f"Conflito em {label}; nenhum registro existente foi sobrescrito.")


def ensure(model, lookup, attrs, label):
    instance = model.objects.filter(**lookup).first()
    assert_equivalent(instance, attrs, label)
    return instance or model.objects.create(**lookup, **attrs)


def bulletin_calculation(data):
    return calculate(data["lines"], data["participants"], data["floor"])


def check_existing(data):
    """Run every conflict check before copying files or creating any records."""
    for kind in ("products", "suppliers", "workers"):
        check_catalog_conflicts(kind, data["legacy"][kind]["records"])
    for kind, prepared in data["legacy"].items():
        batch = ImportBatch.objects.filter(kind=kind, source_key="", active=True).first()
        if batch and (batch.file_hash != prepared["digest"] or batch.importer_version != IMPORTER_VERSION):
            raise PrivateDataError(f"Baseline existente diferente no conjunto {kind}.")
    for code, name in WAREHOUSES.items():
        assert_equivalent(Warehouse.objects.filter(code=code).first(), {"name": name}, "armazéns")
    for code in data["depots"]:
        existing = Depot.objects.select_related("warehouse").filter(code=code).first()
        if existing and (existing.warehouse.code if existing.warehouse else None) != DEPOT_WAREHOUSES.get(code):
            raise PrivateDataError("Conflito no vínculo depósito/armazém.")
    for record in data["equipment"]:
        attrs = {key: value for key, value in record.items() if key not in {"code", "source_row"}}
        assert_equivalent(Equipment.objects.filter(code=record["code"]).first(), attrs, "equipamentos")
    for line in data["bulletin"]["lines"]:
        assert_equivalent(ServiceRate.objects.filter(code=line["category"]).first(),
                          {"label": line["label"], "price": line["price"]}, "tarifas")
    actor = get_user_model().objects.filter(username=SYSTEM_USERNAME).first()
    if actor and (actor.is_active or actor.is_staff or actor.is_superuser
                  or actor.has_usable_password() or hasattr(actor, "profile")):
        raise PrivateDataError("Nome da conta técnica já utilizado por outra conta.")
    if actor:
        from rest_framework.authtoken.models import Token

        if Token.objects.filter(user=actor).exists():
            raise PrivateDataError("Conta técnica já possui token; nenhuma credencial foi alterada.")
    keys = [record["key"] for record in data["invoices"]]
    existing_invoices = {}
    for invoice in Invoice.objects.filter(access_key__in=keys).select_related("supplier"):
        if invoice.access_key in existing_invoices:
            raise PrivateDataError("Mais de uma nota existente para a mesma chave fiscal.")
        existing_invoices[invoice.access_key] = invoice
    manifests = {m["path"]: m for m in data["manifest"]}
    for record in data["invoices"]:
        invoice = existing_invoices.get(record["key"])
        if invoice is None:
            continue
        if record["problems"] or invoice.supplier.code != record["supplier_code"]:
            raise PrivateDataError("Conflito com nota fiscal existente.")
        assert_equivalent(invoice, {"origin": ORIGIN, "extracted": record["extracted"],
                                     "number": record["extracted"].get("number", "")}, "notas fiscais")
        if invoice.sha256 not in {manifests[p]["sha256"] for p in record["paths"]}:
            raise PrivateDataError("Arquivo da nota existente difere das fontes validadas.")
        expected = record["extracted"].get("items", [])
        actual = list(invoice.items.values("position", "supplier_code", "description", "unit", "quantity", "unit_value"))
        comparable = [{**item, "quantity": str(item["quantity"]) if item["quantity"] is not None else None,
                       "unit_value": str(item["unit_value"]) if item["unit_value"] is not None else None} for item in actual]
        # Compare numeric values without depending on their stored decimal scale.
        from decimal import Decimal

        def numeric_items(items):
            return [{**item, **{key: Decimal(str(item[key])) if item[key] is not None else None
                               for key in ("quantity", "unit_value")}} for item in items]

        if numeric_items(comparable) != numeric_items(expected):
            raise PrivateDataError("Itens da nota existente diferem da fonte.")
    spec = data["bulletin"]
    existing = DailyBulletin.objects.filter(warehouse__code=spec["warehouse_code"], reference_date=spec["day"]).first()
    if existing:
        assert_equivalent(existing, {"origin": ORIGIN, "status": "CLOSED", "floor_per_day": spec["floor"],
                                     "calculation": bulletin_calculation(spec)}, "boletim histórico")
        fields = ("category", "unloading", "removal", "transfer", "price")
        if list(existing.lines.order_by("category").values(*fields)) != sorted(
            [{k: line[k] for k in fields} for line in spec["lines"]], key=lambda r: r["category"]
        ):
            raise PrivateDataError("Linhas do boletim existente diferem da fonte.")
        participants = sorted(existing.participants.values_list("worker__registration", "fraction"))
        if participants != sorted((p["registration"], p["fraction"]) for p in spec["participants"]):
            raise PrivateDataError("Equipe do boletim existente difere da fonte.")
    return existing_invoices


def preserve_files(run, data, created_names):
    storage = SourceFile._meta.get_field("file").storage
    files, blobs = {}, {}
    for item in data["manifest"]:
        path = data["directory"] / item["path"]
        content = path.read_bytes()
        if hashlib.sha256(content).hexdigest() != item["sha256"]:
            raise PrivateDataError("Fonte alterada depois da validação; seed revertido.")
        suffix = path.suffix.lower()
        name = f"seed/{item['sha256'][:2]}/{item['sha256']}{suffix}"
        if name not in blobs:
            if storage.exists(name):
                with storage.open(name, "rb") as stream:
                    if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                        raise PrivateDataError("Arquivo privado existente não corresponde ao hash esperado.")
            else:
                created_names.append(name)  # Also clean a partially written file if save() fails.
                saved = storage.save(name, ContentFile(content))
                if saved != name:
                    created_names.append(saved)
                name = saved
            blobs[f"seed/{item['sha256'][:2]}/{item['sha256']}{suffix}"] = name
        name = blobs[f"seed/{item['sha256'][:2]}/{item['sha256']}{suffix}"]
        files[item["path"]] = SourceFile(
            seed_run=run, relative_path=item["path"], file=name, sha256=item["sha256"],
            size=item["size"], kind=item["kind"], problems=data["file_problems"].get(item["path"], []),
        )
    SourceFile.objects.bulk_create(list(files.values()), batch_size=1000)
    return files


def new_batch(kind, path, records, files, data, extra_summary=None):
    summary = {**record_outcomes(records), **(extra_summary or {})}
    issues = dict(Counter(problem for record in records for problem in record.get("problems", [])))
    batch = ImportBatch.objects.create(
        kind=kind, source_key=path, source_file=files[path], file_hash=files[path].sha256,
        importer_version="seed-v1", source_name=path.rsplit("/", 1)[-1],
        row_count=len(records), summary=summary, issues=issues,
    )
    SourceRow.objects.bulk_create([
        SourceRow(batch=batch, source_sheet=row["sheet"], source_row=row["row"], original=row["original"])
        for row in data["raw_rows"].get(path, [])
    ], batch_size=1000)
    return batch


def install_bulletin(data, files, actor, warehouses, workers):
    spec = data["bulletin"]
    bulletin = DailyBulletin.objects.filter(warehouse=warehouses[spec["warehouse_code"]], reference_date=spec["day"]).first()
    if bulletin:
        if bulletin.source_file_id is None:
            bulletin.source_file = files[BULLETIN_FILE]
            bulletin.save(update_fields=["source_file"])
        return bulletin
    bulletin = DailyBulletin.objects.create(
        warehouse=warehouses[spec["warehouse_code"]], reference_date=spec["day"],
        origin=ORIGIN, status="CLOSED", floor_per_day=spec["floor"],
        calculation=bulletin_calculation(spec), created_by=actor, source_file=files[BULLETIN_FILE],
        # Closure time was never supplied. The import audit records the current timestamp.
        closed_at=None,
    )
    BulletinLine.objects.bulk_create([
        BulletinLine(bulletin=bulletin, **{k: v for k, v in line.items() if k != "label"})
        for line in spec["lines"]
    ])
    BulletinParticipant.objects.bulk_create([
        BulletinParticipant(bulletin=bulletin, worker=workers[p["registration"]], fraction=p["fraction"])
        for p in spec["participants"]
    ])
    BulletinRevision.objects.create(
        bulletin=bulletin, revision=1, actor=actor, reason="Importação do exemplo preenchido; fechamento histórico não informado.",
        snapshot={"source_file_id": str(files[BULLETIN_FILE].pk), "calculation": bulletin.calculation,
                  "declared_half_floor": spec["declared_half_floor"], "historical_closure_known": False},
        recorded_at=timezone.now(),
    )
    return bulletin


def install_invoices(data, files, actor, suppliers, existing):
    new, items = [], []
    for record in data["invoices"]:
        if record["problems"]:
            continue
        invoice = existing.get(record["key"])
        if invoice is None:
            source = files[record["primary"]]
            invoice = Invoice(
                supplier=suppliers[record["supplier_code"]], file=source.file.name,
                original_name=record["primary"].rsplit("/", 1)[-1],
                media_type="application/xml" if record["extracted"] else "application/pdf",
                sha256=source.sha256, access_key=record["key"],
                number=record["extracted"].get("number", ""), extracted=record["extracted"],
                extraction_status="extracted_unverified" if record["extracted"] else "manual",
                origin=ORIGIN, created_by=actor,
            )
            new.append(invoice)
            items.extend(InvoiceItem(invoice=invoice, **item) for item in record["extracted"].get("items", []))
        for path in record["paths"]:
            files[path].invoice = invoice
    Invoice.objects.bulk_create(new, batch_size=1000)
    InvoiceItem.objects.bulk_create(items, batch_size=1000)
    SourceFile.objects.bulk_update([file for file in files.values() if file.invoice_id], ["invoice"], batch_size=1000)


def apply_seed(data):
    created_names = []
    storage = SourceFile._meta.get_field("file").storage
    try:
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", [SEED_LOCK])
            # Coordinate with legacy imports in the same order, before checking their catalogs.
            for kind in SOURCE_FILES:
                lock = int.from_bytes(hashlib.sha256(kind.encode()).digest()[:4], "big", signed=True)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock])
            previous = SeedRun.objects.filter(version=SEED_VERSION).first()
            if previous:
                if previous.manifest_hash != data["manifest_hash"]:
                    raise PrivateDataError("Este banco já recebeu outro baseline; nenhuma fonte foi substituída.")
                return {**previous.summary, "status": "unchanged", "seed_run_id": str(previous.pk)}
            existing = check_existing(data)
            run = SeedRun.objects.create(version=SEED_VERSION, manifest_hash=data["manifest_hash"], manifest=data["manifest"])
            files = preserve_files(run, data, created_names)
            user_model = get_user_model()
            actor = user_model.objects.filter(username=SYSTEM_USERNAME).first()
            if actor is None:
                actor = user_model(username=SYSTEM_USERNAME, is_active=False)
                actor.set_unusable_password()
                actor.save()
            warehouses = {code: ensure(Warehouse, {"code": code}, {"name": name}, "armazéns") for code, name in WAREHOUSES.items()}
            depots = {code: ensure(Depot, {"code": code}, {"warehouse_id": warehouses[DEPOT_WAREHOUSES[code]].pk
                                                         if code in DEPOT_WAREHOUSES else None}, "depósitos")
                      for code in sorted(data["depots"])}
            imported = []

            def apply_legacy(kind):
                relative = SOURCE_FILES[kind]
                imported.append(import_source(
                    kind, data["directory"] / relative, source_file=files[relative],
                    preserve_existing=True, prepared=copy.deepcopy(data["legacy"][kind]),
                ))

            for kind in ("products", "suppliers", "workers"):
                apply_legacy(kind)
            products = {p.code: p for p in Product.objects.filter(code__in=[r["attrs"]["code"] for r in data["legacy"]["products"]["records"]])}
            suppliers = {s.code: s for s in Supplier.objects.filter(code__in=[r["key"] for r in data["legacy"]["suppliers"]["records"]])}
            workers = {w.registration: w for w in Worker.objects.filter(registration__in=[r["key"] for r in data["legacy"]["workers"]["records"]])}
            aliases = defaultdict(list)
            for worker in workers.values():
                aliases[worker.name].append(worker)
            for record in data["equipment"]:
                ensure(Equipment, {"code": record["code"]},
                       {k: v for k, v in record.items() if k not in {"code", "source_row"}}, "equipamentos")
            for line in data["bulletin"]["lines"]:
                ensure(ServiceRate, {"code": line["category"]}, {"label": line["label"], "price": line["price"]}, "tarifas")
            apply_legacy("movements")
            for path, records in data["stocks"].items():
                batch = new_batch("stock", path, records, files, data, {"snapshot_date_available": False})
                HistoricalStock.objects.bulk_create([
                    HistoricalStock(batch=batch, depot=depots[r["depot_code"]], product=products.get(r["product_code"]),
                                    **{k: v for k, v in r.items() if k != "depot_code"}) for r in records
                ], batch_size=1000)
            apply_legacy("labor_days")
            for path, records in data["payroll"].items():
                batch = new_batch("worker_days", path, records, files, data,
                                  {"usable_cells": sum(r["usable"] for r in records), "bulletin_cost_available": False})
                HistoricalWorkerDay.objects.bulk_create([
                    HistoricalWorkerDay(batch=batch, worker=aliases[r["source_identifier"]][0]
                                        if len(aliases[r["source_identifier"]]) == 1 else None, **r)
                    for r in records
                ], batch_size=1000)
            new_batch("equipment", "05_operacao/equipamentos_descarga.xlsx", data["equipment"], files, data)
            new_batch("bulletin", BULLETIN_FILE, [{"problems": []}], files, data,
                      {"bulletins_imported": 1, "historical_closure_known": False})
            install_invoices(data, files, actor, suppliers, existing)
            install_bulletin(data, files, actor, warehouses, workers)
            from django.apps import apps

            coverage = {}
            sources = {
                "catalog.Warehouse": "configuration", "catalog.Depot": "catalogs_and_movements",
                "catalog.Product": "products", "catalog.ProductDeposit": "products",
                "catalog.Supplier": "suppliers", "catalog.Worker": "bulletin_worker_catalog",
                "catalog.Equipment": "equipment", "receiving.Invoice": "invoices",
                "receiving.InvoiceItem": "invoice_xml", "labor.ServiceRate": "bulletin_rates",
                "labor.DailyBulletin": "filled_bulletin", "labor.BulletinLine": "filled_bulletin",
                "labor.BulletinParticipant": "filled_bulletin", "labor.BulletinRevision": "import_audit",
                "imports.HistoricalMovement": "movements", "imports.HistoricalLaborDay": "labor_days",
                "imports.HistoricalStock": "stock", "imports.HistoricalWorkerDay": "worker_days",
                "imports.SourceRow": "original_rows", "imports.SourceFile": "original_files",
                "imports.SeedRun": "import_audit", "imports.ImportBatch": "import_audit",
                "auth.User": "inactive_import_account", "auth.Permission": "django_migrations",
                "contenttypes.ContentType": "django_migrations",
            }
            for model in apps.get_models(include_auto_created=True):
                if model._meta.proxy:
                    continue
                label = model._meta.label
                source = sources.get(label, "no_source")
                coverage[label] = {"count": model.objects.count(), "source": source,
                                   "seeded": source not in {"no_source", "django_migrations"}}
            datasets = {r["kind"]: {"row_count": r["row_count"], "summary": r["summary"], "issues": r["issues"]}
                        for r in imported}
            for kind in ("stock", "worker_days", "equipment", "bulletin"):
                batches = list(ImportBatch.objects.filter(kind=kind, source_file__seed_run=run))
                totals = Counter()
                issues = Counter()
                for batch in batches:
                    totals.update({key: value for key, value in batch.summary.items()
                                   if isinstance(value, int) and not isinstance(value, bool)})
                    issues.update(batch.issues)
                datasets[kind] = {"row_count": sum(b.row_count for b in batches), "sources": len(batches),
                                  "summary": dict(totals), "issues": dict(issues)}
            report = {**data["report"], "status": "completed", "seed_run_id": str(run.pk),
                      "datasets": datasets, "entity_coverage": coverage}
            run.summary = report
            run.completed_at = timezone.now()
            run.save(update_fields=["summary", "completed_at"])
            # Catch a source edited during import; the transaction and new blobs still roll back.
            for item in data["manifest"]:
                if file_digest(data["directory"] / item["path"]) != item["sha256"]:
                    raise PrivateDataError("Fonte alterada durante a importação; seed revertido.")
        return report
    except BaseException:
        for name in reversed(created_names):
            try:
                storage.delete(name)
            except OSError:
                logger.exception("Falha ao remover um arquivo novo de uma tentativa revertida.")
        raise
