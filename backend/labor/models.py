from django.conf import settings
from django.db import models

from core.models import ORIGIN_CHOICES, UUIDModel
from labor.constants import CATEGORY_CHOICES, FLOOR


class ServiceRate(UUIDModel):
    code = models.CharField(max_length=40, choices=CATEGORY_CHOICES, unique=True)
    label = models.CharField(max_length=120)
    price = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(price__gte=0), name="rate_nonnegative")
        ]


class DailyBulletin(UUIDModel):
    warehouse = models.ForeignKey("catalog.Warehouse", on_delete=models.PROTECT)
    reference_date = models.DateField()
    origin = models.CharField(max_length=30, choices=ORIGIN_CHOICES)
    status = models.CharField(
        max_length=10, choices=[("DRAFT", "Rascunho"), ("CLOSED", "Fechado")], default="DRAFT"
    )
    revision = models.PositiveIntegerField(default=1)
    floor_per_day = models.DecimalField(max_digits=18, decimal_places=4, default=FLOOR)
    calculation = models.JSONField(default=dict)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    source_file = models.ForeignKey(
        "imports.SourceFile", on_delete=models.PROTECT, null=True, blank=True,
        related_name="bulletins",
    )

    class Meta:
        ordering = ["-reference_date", "warehouse__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["warehouse", "reference_date"], name="one_bulletin_per_warehouse_date"
            )
        ]


class BulletinLine(UUIDModel):
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.CASCADE, related_name="lines")
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES)
    unloading = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    removal = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    transfer = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    price = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["bulletin", "category"], name="one_category_per_bulletin"
            ),
            models.CheckConstraint(
                condition=models.Q(unloading__gte=0, removal__gte=0, transfer__gte=0, price__gte=0),
                name="bulletin_line_nonnegative",
            ),
        ]


class BulletinParticipant(UUIDModel):
    bulletin = models.ForeignKey(
        DailyBulletin, on_delete=models.CASCADE, related_name="participants"
    )
    worker = models.ForeignKey("catalog.Worker", on_delete=models.PROTECT)
    fraction = models.DecimalField(max_digits=2, decimal_places=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["bulletin", "worker"], name="one_worker_per_bulletin"),
            models.CheckConstraint(
                condition=models.Q(fraction__in=["0.5", "1.0"]), name="valid_bulletin_fraction"
            ),
        ]


class BulletinRevision(UUIDModel):
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.PROTECT, related_name="history")
    revision = models.PositiveIntegerField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reason = models.TextField()
    snapshot = models.JSONField()
    recorded_at = models.DateTimeField(auto_now_add=True, null=True)
