"""Private source records, deliberately distinct from trucks and daily bulletins."""

from django.db import models

from core.models import UUIDModel


class ImportBatch(UUIDModel):
    kind = models.CharField(max_length=40, db_index=True)
    file_hash = models.CharField(max_length=64)
    importer_version = models.CharField(max_length=20)
    source_name = models.CharField(max_length=255)
    origin = models.CharField(max_length=30, default="historico_importado", editable=False)
    active = models.BooleanField(default=True)
    imported_at = models.DateTimeField(auto_now_add=True)
    row_count = models.PositiveIntegerField(default=0)
    summary = models.JSONField(default=dict)
    issues = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["kind", "file_hash", "importer_version"], name="unique_import_version"),
            models.UniqueConstraint(fields=["kind"], condition=models.Q(active=True), name="one_active_import_kind"),
        ]


class SourceRow(UUIDModel):
    """Original catalog values are private; no API exposes this table."""

    batch = models.ForeignKey(ImportBatch, on_delete=models.PROTECT, related_name="source_rows")
    source_sheet = models.CharField(max_length=100, blank=True)
    source_row = models.PositiveIntegerField()
    natural_key = models.CharField(max_length=200, blank=True)
    original = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["batch", "source_sheet", "source_row"], name="unique_source_row")]


class HistoricalMovement(UUIDModel):
    batch = models.ForeignKey(ImportBatch, on_delete=models.PROTECT, related_name="movements")
    source_sheet = models.CharField(max_length=100)
    source_row = models.PositiveIntegerField()
    origin = models.CharField(max_length=30, default="historico_importado", editable=False)
    purchase_order = models.CharField(max_length=80, blank=True, db_index=True)
    order_date = models.DateField(null=True, blank=True)
    document_date = models.DateField(null=True, blank=True)
    supplier = models.ForeignKey("catalog.Supplier", on_delete=models.PROTECT, null=True, blank=True)
    supplier_code = models.CharField(max_length=80, blank=True)
    product = models.ForeignKey("catalog.Product", on_delete=models.PROTECT, null=True, blank=True)
    product_code = models.CharField(max_length=80, blank=True)
    quantity = models.DecimalField(max_digits=24, decimal_places=6, null=True, blank=True)
    reported_order_weight = models.DecimalField(max_digits=24, decimal_places=6, null=True, blank=True)
    depot = models.CharField(max_length=80, blank=True, db_index=True)
    receipt_number = models.CharField(max_length=80, blank=True, db_index=True)
    received_on = models.DateField(null=True, blank=True, db_index=True)
    invoice_number = models.CharField(max_length=80, blank=True)
    invoice_key = models.CharField(max_length=100, blank=True)
    original = models.JSONField(default=dict)
    problems = models.JSONField(default=list)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["batch", "source_row"], name="unique_history_source_row")]


class HistoricalLaborDay(UUIDModel):
    batch = models.ForeignKey(ImportBatch, on_delete=models.PROTECT, related_name="labor_days")
    source_row = models.PositiveIntegerField()
    origin = models.CharField(max_length=30, default="historico_importado", editable=False)
    day = models.DateField(db_index=True)
    weekday = models.CharField(max_length=20, blank=True)
    worker_count = models.PositiveIntegerField()
    coffee_worker_count = models.PositiveIntegerField()
    # RH payment is preserved for provenance, never used as the bulletin's cost.
    payroll_paid = models.DecimalField(max_digits=20, decimal_places=6)
    original = models.JSONField(default=dict)
    problems = models.JSONField(default=list)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["batch", "source_row"], name="unique_labor_source_row")]
