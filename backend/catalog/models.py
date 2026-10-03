from django.db import models

from core.models import ORIGIN_CHOICES, UUIDModel


class Warehouse(UUIDModel):
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=160)

    class Meta:
        ordering = ["name"]


class Depot(UUIDModel):
    code = models.CharField(max_length=80, unique=True)
    warehouse = models.ForeignKey(
        Warehouse, on_delete=models.PROTECT, null=True, blank=True, related_name="depots"
    )

    class Meta:
        ordering = ["code"]


class Supplier(UUIDModel):
    code = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=200)
    document = models.CharField(max_length=30, blank=True)
    origin = models.CharField(
        max_length=30, choices=ORIGIN_CHOICES, default="operacional_registrado"
    )

    class Meta:
        ordering = ["name"]


class Worker(UUIDModel):
    registration = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=160)
    origin = models.CharField(
        max_length=30, choices=ORIGIN_CHOICES, default="operacional_registrado"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["registration"]


class Equipment(UUIDModel):
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=160)
    warehouse = models.ForeignKey(
        Warehouse, on_delete=models.PROTECT, null=True, blank=True, related_name="equipment"
    )
    mobile = models.BooleanField(default=False, null=True, blank=True)
    purpose = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]


class Product(UUIDModel):
    code = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=250)
    unit = models.CharField(max_length=30, blank=True)
    weight = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    group = models.CharField(max_length=100, blank=True)


class ProductDeposit(UUIDModel):
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="deposits")
    depot = models.CharField(max_length=80)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["product", "depot"], name="unique_product_depot")
        ]
