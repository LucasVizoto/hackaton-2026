from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsInternal, require_role
from labor.constants import FLOOR, RATE_TABLE
from labor.models import DailyBulletin
from labor.serializers import BulletinInput
from labor.services import (
    check_revision,
    close_bulletin,
    preview,
    reopen_bulletin,
    replace_contents,
    service_rates,
    values,
)


class RatesView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        rates = service_rates()
        return Response(
            {
                "floor_per_day": str(FLOOR),
                "categories": [
                    {"code": code, "label": label, "price": str(rates[code])}
                    for code, label, _ in RATE_TABLE
                ],
            }
        )


class BulletinFilters(serializers.Serializer):
    warehouse = serializers.UUIDField(required=False)
    origin = serializers.ChoiceField(
        choices=["historico_importado", "operacional_registrado", "demo_sintetico"], required=False
    )
    status = serializers.ChoiceField(choices=["DRAFT", "CLOSED"], required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate(self, data):
        if data.get("date_from") and data.get("date_to") and data["date_from"] > data["date_to"]:
            raise serializers.ValidationError("A data inicial deve preceder a final.")
        return data


class BulletinListView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        filters = BulletinFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        query = DailyBulletin.objects.select_related("warehouse")
        for key in ("warehouse", "origin", "status"):
            if data.get(key):
                query = query.filter(**{key: data[key]})
        if data.get("date_from"):
            query = query.filter(reference_date__gte=data["date_from"])
        if data.get("date_to"):
            query = query.filter(reference_date__lte=data["date_to"])
        pager = PageNumberPagination()
        page = pager.paginate_queryset(query, request)
        return pager.get_paginated_response([values(b) for b in page])

    def post(self, request):
        require_role(request.user, "warehouse")
        serializer = BulletinInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            with transaction.atomic():
                bulletin = DailyBulletin.objects.create(
                    warehouse=data["warehouse"],
                    reference_date=data["reference_date"],
                    origin=data["origin"],
                    created_by=request.user,
                )
                replace_contents(bulletin, data)
        except IntegrityError:
            raise ValidationError("Já existe um boletim para este local e data.") from None
        return Response(values(bulletin), status=201)


class BulletinDetailView(APIView):
    permission_classes = [IsInternal]

    def get(self, request, pk):
        return Response(
            values(get_object_or_404(DailyBulletin.objects.select_related("warehouse"), pk=pk))
        )

    def patch(self, request, pk):
        require_role(request.user, "warehouse")
        with transaction.atomic():
            bulletin = get_object_or_404(
                DailyBulletin.objects.select_for_update().select_related("warehouse"), pk=pk
            )
            check_revision(bulletin, request.data.get("revision"))
            if bulletin.status != "DRAFT":
                raise ValidationError(
                    "Boletim fechado é imutável; reabra com motivo para corrigir."
                )
            serializer = BulletinInput(
                data={**request.data, "origin": bulletin.origin}, partial=True
            )
            serializer.is_valid(raise_exception=True)
            if (
                "warehouse" in request.data
                or "reference_date" in request.data
                or ("origin" in request.data and request.data["origin"] != bulletin.origin)
            ):
                raise ValidationError("Local, data e origem não mudam nesta revisão.")
            replace_contents(bulletin, serializer.validated_data)
            bulletin.revision += 1
            bulletin.save(update_fields=["revision"])
            return Response(values(bulletin))


class BulletinPreviewView(APIView):
    permission_classes = [IsInternal]

    def post(self, request):
        serializer = BulletinInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(preview(serializer.validated_data))


class BulletinCloseView(APIView):
    permission_classes = [IsInternal]

    def post(self, request, pk):
        require_role(request.user, "warehouse")
        get_object_or_404(DailyBulletin, pk=pk)
        return Response(values(close_bulletin(pk, request.user, request.data.get("revision"))))


class BulletinReopenView(APIView):
    permission_classes = [IsInternal]

    def post(self, request, pk):
        require_role(request.user, "warehouse")
        get_object_or_404(DailyBulletin, pk=pk)
        return Response(
            values(
                reopen_bulletin(
                    pk, request.user, request.data.get("revision"), request.data.get("reason")
                )
            )
        )
