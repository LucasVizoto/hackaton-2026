from decimal import Decimal

from rest_framework import serializers

from catalog.models import Warehouse, Worker
from core.models import ORIGIN_CHOICES
from labor.constants import CATEGORY_CHOICES


class LineInput(serializers.Serializer):
    category = serializers.ChoiceField(choices=CATEGORY_CHOICES)
    unloading = serializers.DecimalField(
        max_digits=18, decimal_places=4, min_value=Decimal(0), default=0
    )
    removal = serializers.DecimalField(
        max_digits=18, decimal_places=4, min_value=Decimal(0), default=0
    )
    transfer = serializers.DecimalField(
        max_digits=18, decimal_places=4, min_value=Decimal(0), default=0
    )


class ParticipantInput(serializers.Serializer):
    worker = serializers.PrimaryKeyRelatedField(queryset=Worker.objects.all())
    fraction = serializers.DecimalField(max_digits=2, decimal_places=1)

    def validate_fraction(self, value):
        if value not in (Decimal("0.5"), Decimal("1.0")):
            raise serializers.ValidationError("Use diária completa (1) ou meia diária (0,5).")
        return value


class BulletinInput(serializers.Serializer):
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.all())
    reference_date = serializers.DateField()
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")
    lines = LineInput(many=True)
    participants = ParticipantInput(many=True)
    revision = serializers.IntegerField(required=False, min_value=1)

    def validate(self, data):
        lines = data.get("lines", [])
        people = data.get("participants", [])
        if len({line["category"] for line in lines}) != len(lines):
            raise serializers.ValidationError(
                {"lines": "Cada categoria deve aparecer uma única vez."}
            )
        if len(people) > 20:
            raise serializers.ValidationError({"participants": "O boletim aceita até 20 pessoas."})
        if len({person["worker"].pk for person in people}) != len(people):
            raise serializers.ValidationError({"participants": "Matrícula duplicada no boletim."})
        origin = data.get("origin")
        if (
            origin
            and any(p["worker"].origin == "demo_sintetico" for p in people)
            and origin != "demo_sintetico"
        ):
            raise serializers.ValidationError(
                {"origin": "Equipe de demonstração exige origem demo_sintetico."}
            )
        if origin == "demo_sintetico" and any(p["worker"].origin != "demo_sintetico" for p in people):
            raise serializers.ValidationError({"origin": "Boletim de demonstração aceita somente pessoas sintéticas."})
        if origin == "historico_importado":
            raise serializers.ValidationError(
                {"origin": "Histórico exige importação rastreável; não use no lançamento manual."}
            )
        return data
