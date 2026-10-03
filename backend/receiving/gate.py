import re
from pathlib import Path

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import require_role, user_role

from .models import GateArrival
from .serializers import GateArrivalSerializer

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}


def _plate(value, field):
    plate = " ".join(str(value or "").upper().split())
    if not plate or len(plate) > 15:
        raise ValidationError({field: "Informe a placa."})
    return plate


def _arrival_queryset(user):
    queryset = GateArrival.objects.select_related("created_by")
    if user_role(user) == "portaria":
        return queryset.filter(created_by=user)
    return queryset


class GateArrivalListView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        require_role(request.user, "portaria", "warehouse")
        queryset = _arrival_queryset(request.user)
        if request.query_params.get("summary") == "1":
            require_role(request.user, "warehouse")
            return Response({"unread": queryset.filter(seen_at__isnull=True).count()})
        arrivals = queryset[:50]
        return Response(
            {
                "results": GateArrivalSerializer(arrivals, many=True).data,
                "unread": queryset.filter(seen_at__isnull=True).count(),
            }
        )

    def post(self, request):
        require_role(request.user, "portaria")
        uploaded = request.FILES.get("file")
        if not uploaded or uploaded.size == 0 or uploaded.size > 10 * 1024 * 1024:
            raise ValidationError({"file": "Anexe a foto da nota, de até 10 MB."})
        suffix = Path(uploaded.name).suffix.lower()
        media = (uploaded.content_type or "").lower()
        if suffix not in IMAGE_SUFFIXES and not media.startswith("image/"):
            raise ValidationError({"file": "Envie uma imagem da nota fiscal."})
        if media and not media.startswith("image/"):
            raise ValidationError({"file": "Envie uma imagem da nota fiscal."})
        driver = " ".join(str(request.data.get("driver_name") or "").split())
        if len(driver) < 3 or len(driver) > 120:
            raise ValidationError({"driver_name": "Informe o nome do motorista."})
        number = re.sub(r"\D", "", str(request.data.get("invoice_number") or ""))[:44]
        if len(number) < 3:
            raise ValidationError({"invoice_number": "Informe o número da nota fiscal."})
        arrival = GateArrival.objects.create(
            vehicle_plate=_plate(request.data.get("vehicle_plate"), "vehicle_plate"),
            tractor_plate=_plate(request.data.get("tractor_plate"), "tractor_plate"),
            driver_name=driver,
            invoice_number=number,
            file=uploaded,
            original_name=Path(uploaded.name.replace("\\", "/")).name[:200],
            media_type=media or "image/jpeg",
            created_by=request.user,
        )
        return Response(GateArrivalSerializer(arrival).data, status=status.HTTP_201_CREATED)


class GateArrivalSeenView(APIView):
    def post(self, request, pk):
        require_role(request.user, "warehouse")
        arrival = get_object_or_404(GateArrival, id=pk)
        if arrival.seen_at is None:
            arrival.seen_at = timezone.now()
            arrival.seen_by = request.user
            arrival.save(update_fields=["seen_at", "seen_by"])
        return Response(GateArrivalSerializer(arrival).data)


class GateArrivalFileView(APIView):
    def get(self, request, pk):
        require_role(request.user, "portaria", "warehouse")
        arrival = get_object_or_404(_arrival_queryset(request.user), id=pk)
        response = FileResponse(
            arrival.file.open("rb"),
            as_attachment=False,
            filename=arrival.original_name,
            content_type=arrival.media_type or "image/jpeg",
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Disposition"] = "inline"
        return response
