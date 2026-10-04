import re
from pathlib import Path

from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import require_role, user_role

from . import services, workflow
from .models import Appointment, GateArrival
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
    if role in {"warehouse", "management", "admin"}:
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
        require_role(request.user, "portaria", "warehouse", "purchasing", "management")
        queryset = _arrival_queryset(request.user)
        if request.query_params.get("summary") == "1":
            require_role(request.user, "warehouse", "purchasing", "management")
            return Response({"unread": _unread(request.user, queryset)})
        decision = request.query_params.get("decision")
        listed = queryset
        if decision:
            if decision not in {"pending", "authorized", "rejected"}:
                raise ValidationError({"decision": "Filtro de decisão inválido."})
            listed = queryset.filter(decision=decision)
        # A agenda mostra as chegadas do período visível; a data é a local, a mesma do calendário.
        for param, lookup in (("date_from", "created_at__date__gte"), ("date_to", "created_at__date__lte")):
            if request.query_params.get(param):
                value = serializers.DateField().run_validation(request.query_params[param])
                listed = listed.filter(**{lookup: value})
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
        if request.data.get("appointment"):
            if choice != "authorized":
                raise ValidationError({"appointment": "Só uma chegada aceita é vinculada a uma reserva."})
            arrival.appointment = _register_entry(arrival, request.user, request.data["appointment"])
        now = timezone.now()
        arrival.decision = choice
        arrival.decided_at = now
        arrival.decided_by = request.user
        if arrival.seen_at is None:
            arrival.seen_at = now
            arrival.seen_by = request.user
        arrival.save(update_fields=["decision", "decided_at", "decided_by", "seen_at", "seen_by", "appointment"])
        notify_arrival(arrival, choice)
        return Response(GateArrivalSerializer(arrival).data)


def _plate_key(value):
    return re.sub(r"[^0-9A-Z]", "", str(value or "").upper())


def _invoice_numbers(appointment):
    numbers = [link.invoice.number for link in appointment.invoice_links.all()]
    if appointment.invoice_id:
        numbers.append(appointment.invoice.number)
    return list(dict.fromkeys(numbers))


def _candidates(arrival):
    """Reservas do dia da chegada ainda aguardando o caminhão; a portaria só registra entrada na data reservada."""
    day = timezone.localdate(arrival.created_at)
    return (
        Appointment.objects.select_related("slot", "supplier", "invoice")
        .prefetch_related("invoice_links__invoice")
        .filter(slot__date=day, operation_status="waiting", gate_arrival__isnull=True)
        .exclude(purchase_status="rejected")
        .order_by("slot__time", "supplier__name")
    )


def _register_entry(arrival, user, appointment_id):
    serializers.UUIDField().run_validation(appointment_id)
    appointment = _candidates(arrival).filter(pk=appointment_id).first()
    if appointment is None:
        raise ValidationError({"appointment": "Reserva indisponível: precisa ser do dia da chegada e ainda aguardar o caminhão."})
    data = {"occurred_at": arrival.created_at, "driver_name": arrival.driver_name}
    if appointment.workflow_version == 2:
        # O marco é da Portaria: quem registrou o aviso é o autor da entrada, no horário do aviso.
        return workflow.perform(arrival.created_by, appointment.pk, "gate-check-in", data)
    workflow.gate_entry_on_slot_date(appointment, arrival.created_at)
    return services.arrive(user, appointment.pk, {"occurred_at": arrival.created_at})


class GateArrivalCandidatesView(APIView):
    def get(self, request, pk):
        require_role(request.user, "warehouse")
        arrival = get_object_or_404(_arrival_queryset(request.user), id=pk)
        plate, number = _plate_key(arrival.vehicle_plate), arrival.invoice_number.lstrip("0")
        rows = []
        for appointment in _candidates(arrival):
            invoices = _invoice_numbers(appointment)
            rows.append({
                "id": str(appointment.pk),
                "time": appointment.slot.time,
                "supplier_name": appointment.supplier.name,
                "vehicle_plate": appointment.vehicle_plate,
                "invoice_numbers": invoices,
                "matches": _plate_key(appointment.vehicle_plate) == plate
                or any(value.lstrip("0") == number for value in invoices),
            })
        rows.sort(key=lambda row: not row["matches"])
        return Response({"results": rows})


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
        require_role(request.user, "portaria", "warehouse", "purchasing", "management")
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
