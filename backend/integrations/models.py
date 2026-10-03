from django.conf import settings
from django.db import models

from core.models import UUIDModel


class WarehouseReadiness(UUIDModel):
    warehouse = models.OneToOneField("catalog.Warehouse", on_delete=models.PROTECT)
    ready = models.BooleanField(null=True)
    notes = models.TextField(blank=True)
    revision = models.PositiveIntegerField(default=1)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    updated_at = models.DateTimeField(auto_now=True)


class ReadinessRevision(UUIDModel):
    readiness = models.ForeignKey(WarehouseReadiness, on_delete=models.PROTECT, related_name="history")
    snapshot = models.JSONField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    recorded_at = models.DateTimeField(auto_now_add=True)


class ReceiptSignature(UUIDModel):
    appointment = models.ForeignKey("receiving.Appointment", on_delete=models.PROTECT, related_name="signatures")
    appointment_revision = models.PositiveIntegerField()
    document_manifest = models.JSONField()
    manifest_sha256 = models.CharField(max_length=64)
    signer_name = models.CharField(max_length=160)
    declaration = models.TextField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    signed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["appointment", "appointment_revision", "actor"], name="unique_receipt_signature_revision_actor")]


class OutboundDelivery(UUIDModel):
    channel = models.CharField(max_length=20)
    dedupe_key = models.CharField(max_length=200, unique=True)
    payload = models.JSONField()
    status = models.CharField(max_length=20, default="pending", choices=[
        ("pending", "Pendente"), ("sending", "Em envio"), ("sent", "Enviado"),
        ("failed", "Falhou"), ("uncertain", "Resultado desconhecido; conferir antes de repetir"),
    ])
    attempts = models.PositiveIntegerField(default=0)
    provider_reference = models.CharField(max_length=200, blank=True)
    error_code = models.CharField(max_length=100, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class DocumentSuggestion(UUIDModel):
    file = models.FileField(upload_to="ocr/%Y/%m/%d/")
    original_name = models.CharField(max_length=200)
    sha256 = models.CharField(max_length=64)
    media_type = models.CharField(max_length=50)
    suggestion = models.TextField(blank=True)
    provider_reference = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, default="pending")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
