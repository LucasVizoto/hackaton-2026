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


class TariffTable(UUIDModel):
    """Tarifas e piso com data de vigência. Cada boletim usa a tabela vigente na sua data."""
    valid_from = models.DateField(unique=True)
    floor_per_day = models.DecimalField(max_digits=18, decimal_places=4)
    notes = models.TextField(blank=True)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-valid_from"]
        constraints = [
            models.CheckConstraint(condition=models.Q(floor_per_day__gte=0), name="tariff_floor_nonnegative")
        ]


class TariffRate(UUIDModel):
    table = models.ForeignKey(TariffTable, on_delete=models.CASCADE, related_name="rates")
    code = models.CharField(max_length=40, choices=CATEGORY_CHOICES)
    price = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["table", "code"], name="one_rate_per_tariff_table"),
            models.CheckConstraint(condition=models.Q(price__gte=0), name="tariff_rate_nonnegative"),
        ]


class DailyBulletin(UUIDModel):
    # Nulo no boletim único do dia (boletim-v3); preenchido nos boletins por armazém anteriores.
    warehouse = models.ForeignKey("catalog.Warehouse", on_delete=models.PROTECT, null=True, blank=True)
    reference_date = models.DateField()
    origin = models.CharField(max_length=30, choices=ORIGIN_CHOICES)
    status = models.CharField(
        max_length=10, choices=[("DRAFT", "Rascunho"), ("CLOSED", "Fechado")], default="DRAFT"
    )
    revision = models.PositiveIntegerField(default=1)
    floor_per_day = models.DecimalField(max_digits=18, decimal_places=4, default=FLOOR)
    calculation = models.JSONField(default=dict)
    financial_version = models.CharField(max_length=30, default="boletim-v1")
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
            ),
            models.UniqueConstraint(
                fields=["reference_date", "origin"], condition=models.Q(warehouse__isnull=True),
                name="one_daily_bulletin_per_date_origin",
            ),
        ]


class BulletinLine(UUIDModel):
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.CASCADE, related_name="lines")
    warehouse = models.ForeignKey("catalog.Warehouse", on_delete=models.PROTECT, null=True, blank=True)
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES)
    unloading = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    removal = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    transfer = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    price = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["bulletin", "category"], condition=models.Q(warehouse__isnull=True),
                name="one_category_per_bulletin",
            ),
            models.UniqueConstraint(
                fields=["bulletin", "warehouse", "category"], condition=models.Q(warehouse__isnull=False),
                name="one_category_per_bulletin_warehouse",
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
    worker_day = models.OneToOneField(
        "WorkerDay", on_delete=models.PROTECT, null=True, blank=True,
        related_name="financial_participation",
    )

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


class WorkerDay(UUIDModel):
    worker = models.ForeignKey("catalog.Worker", on_delete=models.PROTECT, related_name="work_days")
    reference_date = models.DateField(db_index=True)
    origin = models.CharField(max_length=30, choices=ORIGIN_CHOICES)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=["worker", "reference_date", "origin"], name="unique_worker_day_origin"
        )]


class BulletinDailyService(UUIDModel):
    KINDS = [("FULL", "Diária Completa"), ("HALF", "Meia Diária")]
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.CASCADE, related_name="daily_services")
    kind = models.CharField(max_length=8, choices=KINDS)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    price = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["bulletin", "kind"], name="unique_bulletin_daily_service"),
            models.CheckConstraint(condition=models.Q(quantity__gte=0, price__gte=0), name="daily_service_nonnegative"),
        ]


class IndividualAllocation(UUIDModel):
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.PROTECT, related_name="allocations")
    worker = models.ForeignKey("catalog.Worker", on_delete=models.PROTECT, related_name="allocations")
    worker_day = models.ForeignKey(WorkerDay, on_delete=models.PROTECT, related_name="allocations")
    bulletin_revision = models.PositiveIntegerField()
    policy_version = models.CharField(max_length=40, default="proportional-largest-remainder-v1")
    fraction = models.DecimalField(max_digits=2, decimal_places=1)
    exact = models.JSONField()
    display = models.JSONField()
    total_payable = models.DecimalField(max_digits=24, decimal_places=2)
    active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=["bulletin", "bulletin_revision", "worker"], name="unique_individual_allocation_revision"
        )]


class LaborActivity(UUIDModel):
    worker_day = models.ForeignKey(WorkerDay, on_delete=models.PROTECT, related_name="activities")
    warehouse = models.ForeignKey("catalog.Warehouse", on_delete=models.PROTECT)
    appointment = models.ForeignKey("receiving.Appointment", on_delete=models.PROTECT, null=True, blank=True)
    equipment = models.ForeignKey("catalog.Equipment", on_delete=models.PROTECT, null=True, blank=True)
    activity_type = models.CharField(max_length=20, choices=[
        ("RECEIVING", "Recebimento"), ("INTERNAL", "Movimentação interna"),
        ("MACHINE", "Máquinas / implementos"), ("OTHER", "Outro"),
    ])
    attendance_state = models.CharField(max_length=10, choices=[
        ("PLANNED", "Prevista"), ("PRESENT", "Presente"), ("ABSENT", "Ausente"),
    ], default="PLANNED")
    used = models.BooleanField(default=False)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    revision = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class LaborActivityRevision(UUIDModel):
    activity = models.ForeignKey(LaborActivity, on_delete=models.PROTECT, related_name="history")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    reason = models.TextField()
    snapshot = models.JSONField()
    recorded_at = models.DateTimeField(auto_now_add=True)


class LaborRuleOccurrence(UUIDModel):
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.PROTECT, related_name="rule_occurrences")
    worker = models.ForeignKey("catalog.Worker", on_delete=models.PROTECT, null=True, blank=True)
    code = models.CharField(max_length=40, choices=[
        ("FRACTION", "Fração excepcional"), ("EARLY_LEAVE", "Saída antecipada"),
        ("OVERTIME", "Horas extras"), ("SPECIAL_DAILY", "Diária especial"), ("OTHER", "Outra regra"),
    ])
    description = models.TextField()
    proposed_fraction = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    activity = models.ForeignKey(LaborActivity, on_delete=models.PROTECT, null=True, blank=True)
    policy_version = models.CharField(max_length=40, blank=True)
    resolution_type = models.CharField(max_length=30, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="labor_occurrences")
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="labor_resolutions")
    resolution = models.TextField(blank=True)


class ProductionRecord(UUIDModel):
    """A source event belongs to one bulletin; activities never duplicate its production."""
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.PROTECT, related_name="production_records")
    warehouse = models.ForeignKey("catalog.Warehouse", on_delete=models.PROTECT, null=True, blank=True)
    source_key = models.CharField(max_length=200)
    origin = models.CharField(max_length=30, choices=ORIGIN_CHOICES)
    category = models.CharField(max_length=40, choices=CATEGORY_CHOICES)
    movement = models.CharField(max_length=15, choices=[("unloading", "Descarga"), ("removal", "Remoção"), ("transfer", "Transferência")])
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    price = models.DecimalField(max_digits=18, decimal_places=4)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["source_key", "origin"], name="unique_production_source_origin"),
            models.CheckConstraint(condition=models.Q(quantity__gte=0, price__gte=0), name="production_record_nonnegative"),
        ]


class WorkerAdjustment(UUIDModel):
    """Acréscimo ou desconto individual. Não altera produção, piso nem complemento do boletim."""
    KINDS = [("OVERTIME", "Hora extra confirmada"), ("EARLY_LEAVE", "Saída antecipada"),
             ("SPECIAL_DAILY", "Diária especial"), ("DISCOUNT", "Desconto"), ("OTHER", "Outro")]
    worker = models.ForeignKey("catalog.Worker", on_delete=models.PROTECT, related_name="adjustments")
    reference_date = models.DateField(db_index=True)
    origin = models.CharField(max_length=30, choices=ORIGIN_CHOICES)
    bulletin = models.ForeignKey(DailyBulletin, on_delete=models.PROTECT, null=True, blank=True,
                                 related_name="adjustments")
    kind = models.CharField(max_length=20, choices=KINDS)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    reason = models.TextField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
                                   related_name="labor_adjustments")
    created_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
                                     related_name="cancelled_labor_adjustments")
    cancel_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["reference_date", "created_at"]
        constraints = [
            models.CheckConstraint(condition=~models.Q(amount=0), name="adjustment_nonzero"),
        ]
