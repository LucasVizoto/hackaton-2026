import re
from pathlib import Path

from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import require_role, user_role

from .models import GateArrival
from .realtime import notify_arrival
from .serializers import GateArrivalSerializer

class GateArrivalPagination(PageNumberPagination):
    page_size = 50


def _plate(value, field):
    plate = " ".join(str(value or "").upper().split())
    if not plate or len(plate) > 15:
        raise ValidationError({field: "Informe a placa."})
    return plate


def _arrival_queryset(user):
    queryset = GateArrival.objects.select_related("created_by")
    role = user_role(user)
    if role == "gatehouse":
        return queryset.filter(created_by=user)
    if role == "purchasing":
        return queryset.filter(decision="rejected")
    if role in {"warehouse", "admin"}:
        return queryset
    return queryset.none()


def _unread(user, queryset):
    if user_role(user) == "purchasing":
        return queryset.filter(decision="rejected").count()
    return queryset.filter(seen_at__isnull=True).count()


def _image_type(content):
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content[4:8] == b"ftyp":
        brands = {content[index:index + 4] for index in range(8, min(len(content), 64), 4)}
        if brands & {b"heic", b"heix", b"hevc", b"hevx"}:
            return "image/heic"
        if brands & {b"mif1", b"msf1"}:
            return "image/heif"
    raise ValidationError({"file": "Envie conteúdo de imagem JPEG, PNG, WebP, HEIC ou HEIF; extensão e tipo informados não bastam."})


def _invoice_number(value, legacy=False):
    text = str(value or "").strip()
    # The old form allowed printed thousands separators. It never needs a
    # 44-digit access key: its OCR extracts the nine-digit nNF portion first.
    if legacy and re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{3}){1,2}", text):
        text = text.replace(".", "")
    if not re.fullmatch(r"[0-9]{1,9}", text) or set(text) == {"0"}:
        raise ValidationError({
            "invoice_number": "Informe o número da NF: de 1 a 9 dígitos. Zeros à esquerda são permitidos; não use letras, só zeros ou a chave de acesso.",
        })
    return text


class GateArrivalListView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        require_role(request.user, "portaria", "warehouse", "purchasing")
        queryset = _arrival_queryset(request.user)
        if request.query_params.get("summary") == "1":
            require_role(request.user, "warehouse", "purchasing")
            return Response({"unread": _unread(request.user, queryset)})
        decision = request.query_params.get("decision")
        listed = queryset
        if decision:
            if decision not in {"pending", "authorized", "rejected"}:
                raise ValidationError({"decision": "Filtro de decisão inválido."})
            listed = queryset.filter(decision=decision)
        paginator = GateArrivalPagination()
        arrivals = paginator.paginate_queryset(listed.order_by("-created_at", "-id"), request, view=self)
        response = paginator.get_paginated_response(GateArrivalSerializer(arrivals, many=True).data)
        response.data["unread"] = _unread(request.user, queryset)
        return response

    def post(self, request):
        require_role(request.user, "portaria")
        uploaded = request.FILES.get("file")
        if not uploaded or uploaded.size == 0 or uploaded.size > 10 * 1024 * 1024:
            raise ValidationError({"file": "Anexe a foto da nota, de até 10 MB."})
        content = uploaded.read()
        media = _image_type(content)
        uploaded.seek(0)
        driver = " ".join(str(request.data.get("driver_name") or "").split())
        if len(driver) < 3 or len(driver) > 120:
            raise ValidationError({"driver_name": "Informe o nome do motorista."})
        number = _invoice_number(request.data.get("invoice_number"), legacy=request.path.startswith("/api/v1/"))
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
        notify_arrival(arrival, "created")
        return Response(GateArrivalSerializer(arrival).data, status=status.HTTP_201_CREATED)


class GateArrivalDecisionView(APIView):
    @transaction.atomic
    def post(self, request, pk):
        require_role(request.user, "warehouse")
        arrival = get_object_or_404(GateArrival.objects.select_for_update(), id=pk)
        choice = request.data.get("decision")
        if choice not in {"authorized", "rejected"}:
            raise ValidationError({"decision": "Informe se a chegada foi aceita ou recusada."})
        if arrival.decision != "pending":
            raise ValidationError({"decision": "Esta chegada já foi decidida."})
        now = timezone.now()
        arrival.decision = choice
        arrival.decided_at = now
        arrival.decided_by = request.user
        if arrival.seen_at is None:
            arrival.seen_at = now
            arrival.seen_by = request.user
        arrival.save(update_fields=["decision", "decided_at", "decided_by", "seen_at", "seen_by"])
        notify_arrival(arrival, choice)
        return Response(GateArrivalSerializer(arrival).data)


class GateArrivalSeenView(APIView):
    @transaction.atomic
    def post(self, request, pk):
        require_role(request.user, "warehouse")
        arrival = get_object_or_404(GateArrival.objects.select_for_update(), id=pk)
        if arrival.seen_at is None:
            arrival.seen_at = timezone.now()
            arrival.seen_by = request.user
            arrival.save(update_fields=["seen_at", "seen_by"])
        return Response(GateArrivalSerializer(arrival).data)


class GateArrivalFileView(APIView):
    def get(self, request, pk):
        require_role(request.user, "portaria", "warehouse", "purchasing")
        arrival = get_object_or_404(_arrival_queryset(request.user), id=pk)
        response = FileResponse(
            arrival.file.open("rb"),
            as_attachment=False,
            filename=arrival.original_name,
            content_type=arrival.media_type or "image/jpeg",
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        response["Content-Disposition"] = "inline"
        return response
