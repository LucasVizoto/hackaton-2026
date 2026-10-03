import uuid
from pathlib import Path

from django.conf import settings
from django.db import models

from core.models import ORIGIN_CHOICES, UUIDModel

PACKAGING = [("batida", "Batida"), ("paletizada", "Paletizada"), ("big_bag", "Big bag"),
             ("machine_implement", "Máquina / implemento (exclusivo)")]
EXCLUSIVE_PACKAGING = {"batida", "machine_implement"}
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
    workflow_version = models.PositiveSmallIntegerField(default=1)
    creation_key = models.UUIDField(null=True, blank=True, unique=True)
    creation_fingerprint = models.CharField(max_length=64, blank=True)
    previous_appointment = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="resubmissions")
    resubmission_reason = models.TextField(blank=True)
    supplier = models.ForeignKey(
        "catalog.Supplier", on_delete=models.PROTECT, related_name="appointments"
    )
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="appointments")
    slot = models.ForeignKey(GlobalSlot, on_delete=models.PROTECT, related_name="appointments")
    packaging = models.CharField(max_length=20, choices=PACKAGING)
    vehicle_plate = models.CharField(max_length=30, blank=True)
    tractor_plate = models.CharField(max_length=30, blank=True)
    carrier_name = models.CharField(max_length=200, blank=True)
    driver_name = models.CharField(max_length=160, blank=True)
    articulated = models.BooleanField(null=True, blank=True)
    assisted = models.BooleanField(null=True, blank=True)
    booking_kind = models.CharField(max_length=20, default="legacy", choices=[("legacy", "Legado"), ("scheduled", "Agendado"), ("spontaneous", "Agendamento no ato")])
    gate_checked_in_at = models.DateTimeField(null=True, blank=True)
    gate_checked_out_at = models.DateTimeField(null=True, blank=True)
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
        return 2 if self.packaging in EXCLUSIVE_PACKAGING else 1


class WarehouseVisit(UUIDModel):
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
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


class AppointmentInvoice(UUIDModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="invoice_links")
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="load_links")
    position = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["appointment", "invoice"], name="one_invoice_per_load"),
            models.UniqueConstraint(fields=["appointment", "position"], name="unique_load_invoice_position"),
        ]


class ReceiptLine(UUIDModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="receipt_lines")
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT)
    invoice_item = models.ForeignKey(InvoiceItem, null=True, blank=True, on_delete=models.PROTECT)
    purchase_order_line = models.ForeignKey("PurchaseOrderLine", null=True, blank=True, on_delete=models.PROTECT, related_name="receipts")
    previous_receipt_line = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="complements")
    description = models.CharField(max_length=400)
    unit = models.CharField(max_length=30)
    declared_quantity = models.DecimalField(max_digits=22, decimal_places=6)
    observed_quantity = models.DecimalField(max_digits=22, decimal_places=6)
    accepted_quantity = models.DecimalField(max_digits=22, decimal_places=6)
    rejected_quantity = models.DecimalField(max_digits=22, decimal_places=6)
    decision = models.CharField(max_length=20, default="pending", choices=PURCHASE)
    discrepancy_reason = models.TextField(blank=True)
    decision_notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    reviewed_at = models.DateTimeField(null=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="receipt_lines")
    recorded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["recorded_at", "id"]
        constraints = [
            models.UniqueConstraint(fields=["appointment", "invoice_item"], condition=models.Q(invoice_item__isnull=False), name="one_receipt_line_per_item_load"),
            models.CheckConstraint(condition=models.Q(declared_quantity__gte=0, observed_quantity__gte=0, accepted_quantity__gte=0, rejected_quantity__gte=0), name="receipt_quantities_nonnegative"),
            models.CheckConstraint(condition=models.Q(observed_quantity=models.F("accepted_quantity") + models.F("rejected_quantity")), name="receipt_quantities_reconcile"),
        ]


class InternalNotification(UUIDModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="notifications")
    recipient_role = models.CharField(max_length=20)
    kind = models.CharField(max_length=40)
    message = models.CharField(max_length=300)
    dedupe_key = models.CharField(max_length=120, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    acknowledged_at = models.DateTimeField(null=True)
    acknowledged_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)

    class Meta:
        ordering = ["-created_at", "id"]


class ReceivingCommand(UUIDModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="commands")
    key = models.UUIDField()
    action = models.CharField(max_length=80)
    fingerprint = models.CharField(max_length=64)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["appointment", "key"], name="unique_receiving_command")]


class ReceivingException(UUIDModel):
    appointment = models.ForeignKey(Appointment, on_delete=models.PROTECT, related_name="exceptions")
    kind = models.CharField(max_length=30, choices=[("late", "Atraso"), ("no_show", "Não comparecimento"), ("nature", "Natureza"), ("invoice_mismatch", "Divergência documental"), ("other", "Outro")])
    description = models.TextField()
    occurred_at = models.DateTimeField()
    recorded_at = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        ordering = ["recorded_at", "id"]


class PurchaseOrder(UUIDModel):
    supplier = models.ForeignKey("catalog.Supplier", on_delete=models.PROTECT)
    reference = models.CharField(max_length=100)
    confirmation_notes = models.TextField()
    confirmed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    confirmed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-confirmed_at", "id"]
        constraints = [models.UniqueConstraint(fields=["supplier", "reference"], name="unique_confirmed_supplier_order")]


class PurchaseOrderLine(UUIDModel):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="lines")
    position = models.PositiveIntegerField()
    description = models.CharField(max_length=400)
    unit = models.CharField(max_length=30)
    ordered_quantity = models.DecimalField(max_digits=22, decimal_places=6)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["order", "position"], name="unique_confirmed_order_position"),
            models.CheckConstraint(condition=models.Q(ordered_quantity__gt=0), name="confirmed_order_quantity_positive"),
        ]
