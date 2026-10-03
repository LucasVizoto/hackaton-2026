"""Check stored source hashes, private attachments and baseline idempotence."""
# ruff: noqa: E402
import hashlib
import io
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_production")
import django

django.setup()
from django.core.management import call_command
from imports.models import SeedRun, SourceFile
from receiving.models import Invoice

sources = list(SourceFile.objects.all())
assert len(sources) == 938
for source in sources:
    path = Path(source.file.path)
    assert path.stat().st_size == source.size
    with path.open("rb") as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest() == source.sha256
invoices = list(Invoice.objects.all())
for invoice in invoices:
    with Path(invoice.file.path).open("rb") as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest() == invoice.sha256
seed_ids = list(SeedRun.objects.values_list("id", flat=True))
source_ids = list(SourceFile.objects.order_by("id").values_list("id", flat=True))
invoice_ids = list(Invoice.objects.order_by("id").values_list("id", flat=True))
call_command(
    "bootstrap_database",
    report="/srv/cocapec/shared/reports/bootstrap-repeat.json",
    stdout=io.StringIO(),
)
assert list(SeedRun.objects.values_list("id", flat=True)) == seed_ids
assert list(SourceFile.objects.order_by("id").values_list("id", flat=True)) == source_ids
assert list(Invoice.objects.order_by("id").values_list("id", flat=True)) == invoice_ids
assert json.loads(Path("/srv/cocapec/shared/reports/bootstrap-repeat.json").read_text())["status"] == "unchanged"
print(f"Data acceptance PASS: {len(sources)} source hashes, {len(invoices)} private attachments, unchanged baseline.")
