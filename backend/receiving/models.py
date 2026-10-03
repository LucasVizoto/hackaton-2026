import uuid
from pathlib import Path

from django.conf import settings
from django.db import models

from core.models import ORIGIN_CHOICES, UUIDModel

PACKAGING = [("batida", "Batida"), ("paletizada", "Paletizada"), ("big_bag", "Big bag")]
OPERATION = [
    ("waiting", "Aguardando"),
    ("arrived", "Chegou"),
    ("in_progress", "Em descarga"),
    ("completed", "Concluída"),
    ("cancelled", "Cancelada"),
    ("not_received", "Não recebida"),
]
PURCHASE = [("pending", "Pendente"), ("approved", "Aprovada"), ("rejected", "Rejeitada")]
TIMES = [("08:00", "08h"), ("10:00", "10h"), ("13:00", "13h"), ("15:00", "15h")]
NON_RECEIPT_REASONS = [
    ("invoice_mismatch", "Divergência nota/pedido"),
    ("unscheduled_no_capacity", "Sem agendamento e sem vaga"),
    ("nature", "Caso fortuito de natureza"),
    ("other", "Outro"),
]


def private_upload(instance, filename):
    return f"invoices/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


class Holiday(UUIDModel):
    date = models.DateField(unique=True)
    description = models.CharField(max_length=200)


class GlobalSlot(UUIDModel):
    date = models.DateField()
    time = models.CharField(max_length=5, choices=TIMES)

    class Meta:
        ordering = ["date", "time"]
        constraints = [models.UniqueConstraint(fields=["date", "time"], name="unique_global_slot")]


class Invoice(UUIDModel):
    supplier = models.ForeignKey(
        "catalog.Supplier", on_delete=models.PROTECT, related_name="invoices"
    )
    file = models.FileField(upload_to=private_upload)
    original_name = models.CharField(max_length=200)
    media_type = models.CharField(max_length=50)
    sha256 = models.CharField(max_length=64)
    number = models.CharField(max_length=50, blank=True)
    access_key = models.CharField(max_length=44, blank=True)
    extracted = models.JSONField(default=dict)
    extraction_status = models.CharField(max_length=30, default="manual")
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    origin = models.CharField(
        max_length=30, choices=ORIGIN_CHOICES, default="operacional_registrado"
    )


class InvoiceItem(UUIDModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="items")
    position = models.PositiveIntegerField()
    supplier_code = models.CharField(max_length=100, blank=True)
    description = models.CharField(max_length=400)
    unit = models.CharField(max_length=30, blank=True)
    quantity = models.DecimalField(max_digits=22, decimal_places=6, null=True)
    unit_value = models.DecimalField(max_digits=26, decimal_places=10, null=True)

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["invoice", "position"], name="unique_invoice_item_position"
            )
        ]


class Appointment(UUIDModel):
    supplier = models.ForeignKey(
        "catalog.Supplier", on_delete=models.PROTECT, related_name="appointments"
    )
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="appointments")
    slot = models.ForeignKey(GlobalSlot, on_delete=models.PROTECT, related_name="appointments")
    packaging = models.CharField(max_length=20, choices=PACKAGING)
    vehicle_plate = models.CharField(max_length=30, blank=True)
    notes = models.TextField(blank=True)
    origin = models.CharField(
        max_length=30, choices=ORIGIN_CHOICES, default="operacional_registrado"
    )
    purchase_status = models.CharField(max_length=20, choices=PURCHASE, default="pending")
    order_reference = models.CharField(max_length=100, blank=True)
    comparison_notes = models.TextField(blank=True)
    purchase_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.PROTECT,
        related_name="purchase_reviews",
    )
    purchase_reviewed_at = models.DateTimeField(null=True)
    warehouse_status = models.CharField(
        max_length=20,
        choices=[("pending", "Pendente"), ("approved", "Aprovada")],
        default="pending",
    )
    warehouse_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.PROTECT,
        related_name="warehouse_reviews",
    )
    warehouse_reviewed_at = models.DateTimeField(null=True)
    operation_status = models.CharField(max_length=20, choices=OPERATION, default="waiting")
    arrived_at = models.DateTimeField(null=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    worker_count = models.PositiveSmallIntegerField(null=True)
    equipment = models.ManyToManyField("catalog.Equipment", blank=True, related_name="appointments")
    resources_confirmed = models.BooleanField(default=False)
    capacity_reserved = models.BooleanField(default=True)
    nature_exception = models.BooleanField(default=False)
    priority = models.CharField(max_length=20, default="scheduled")
    revision = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="appointments_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["slot__date", "slot__time", "created_at"]

    @property
    def units(self):
        return 2 if self.packaging == "batida" else 1


class WarehouseVisit(UUIDModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="visits")
    warehouse = models.ForeignKey(
        "catalog.Warehouse", on_delete=models.PROTECT, related_name="visits"
    )
    sequence = models.PositiveSmallIntegerField()
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    worker_count = models.PositiveSmallIntegerField(null=True)
    equipment = models.ManyToManyField("catalog.Equipment", blank=True, related_name="visits")
    resources_confirmed = models.BooleanField(default=False)

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(
                fields=["appointment", "warehouse"], name="unique_appointment_destination"
            ),
            models.UniqueConstraint(
                fields=["appointment", "sequence"], name="unique_appointment_visit_sequence"
            ),
        ]


class CapacityHold(UUIDModel):
    slot = models.ForeignKey(GlobalSlot, on_delete=models.PROTECT, related_name="holds")
    source_appointment = models.ForeignKey(
        Appointment, on_delete=models.PROTECT, related_name="capacity_holds"
    )
    units = models.PositiveSmallIntegerField()
    exclusive = models.BooleanField(default=False)
    active = models.BooleanField(default=True)
    reason = models.TextField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    assigned_to = models.ForeignKey(
        Appointment, null=True, on_delete=models.PROTECT, related_name="assigned_holds"
    )


class ReceivingEvent(UUIDModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="events")
    kind = models.CharField(max_length=50)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    occurred_at = models.DateTimeField()
    recorded_at = models.DateTimeField(auto_now_add=True)
    data = models.JSONField(default=dict)

    class Meta:
        ordering = ["recorded_at"]


class NonReceipt(UUIDModel):
    appointment = models.OneToOneField(
        Appointment, null=True, blank=True, on_delete=models.PROTECT, related_name="non_receipt"
    )
    supplier = models.ForeignKey(
        "catalog.Supplier", null=True, blank=True, on_delete=models.PROTECT
    )
    reason = models.CharField(max_length=40, choices=NON_RECEIPT_REASONS)
    description = models.TextField(blank=True)
    vehicle_plate = models.CharField(max_length=30, blank=True)
    occurred_at = models.DateTimeField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    origin = models.CharField(
        max_length=30, choices=ORIGIN_CHOICES, default="operacional_registrado"
    )

    class Meta:
        ordering = ["-occurred_at"]
