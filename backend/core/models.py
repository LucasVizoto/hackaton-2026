import uuid

from django.conf import settings
from django.db import models

ORIGIN_CHOICES = [
    ("historico_importado", "Histórico importado"),
    ("operacional_registrado", "Operação registrada"),
    ("demo_sintetico", "Demonstração sintética"),
]


class UUIDModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class UserProfile(models.Model):
    ROLES = [
        ("supplier", "Fornecedor"),
        ("purchasing", "Compras"),
        ("warehouse", "Armazém"),
        ("gatehouse", "Portaria"),
        ("management", "Gestão"),
        ("admin", "Administrador"),
    ]
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    supplier = models.ForeignKey(
        "catalog.Supplier", null=True, blank=True, on_delete=models.PROTECT
    )
    role = models.CharField(max_length=20, choices=ROLES)
