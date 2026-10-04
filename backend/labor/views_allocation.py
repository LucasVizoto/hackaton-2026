from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import ORIGIN_CHOICES
from core.permissions import IsInternal
from labor.allocation_service import day_plan, norms_payload


class PlanFilters(serializers.Serializer):
    date = serializers.DateField(required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")

    def validate(self, data):
        start = data.get("date_from") or data.get("date") or timezone.localdate()
        end = data.get("date_to") or data.get("date") or start
        if start > end:
            raise serializers.ValidationError("A data inicial deve preceder a final.")
        if (end - start).days > 31:
            raise serializers.ValidationError("Consulte no máximo 31 dias por vez.")
        data.update(date_from=start, date_to=end)
        return data


class AllocationNormsView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        return Response(norms_payload())


class DayPlanView(APIView):
    """Pessoas e empilhadeiras exigidas pela agenda, por horário. Única data → objeto; período → lista."""
    permission_classes = [IsInternal]

    def get(self, request):
        filters = PlanFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        if "date" in data and "date_from" not in request.query_params:
            return Response(day_plan(data["date"], data["origin"]))
        days = (data["date_to"] - data["date_from"]).days + 1
        return Response({"results": [day_plan(data["date_from"] + timedelta(days=i), data["origin"])
                                     for i in range(days)]})
