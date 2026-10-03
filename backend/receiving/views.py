import hashlib
from pathlib import Path

from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Supplier
from core.permissions import require_role, user_role

from . import services
from .models import (
    Appointment,
    CapacityHold,
    GlobalSlot,
    Holiday,
    Invoice,
    InvoiceItem,
    NonReceipt,
    TIMES,
    WarehouseVisit,
)
from .serializers import (
    AppointmentCreateSerializer,
    AppointmentSerializer,
    AppointmentUpdateSerializer,
    AssignCapacitySerializer,
    CancelSerializer,
    CapacityHoldSerializer,
    EventTimeSerializer,
    InvoiceSerializer,
    NonReceiptSerializer,
    PurchaseReviewSerializer,
    RescheduleSerializer,
    ResourceSerializer,
    WarehouseReviewSerializer,
    WarehouseVisitSerializer,
)
from .xml_parser import parse_invoice_xml, validate_invoice_number


def supplier_scoped(queryset, user, field="supplier_id"):
    if user_role(user) == "supplier":
        return queryset.filter(**{field: user.profile.supplier_id})
    if user_role(user) not in {"purchasing", "warehouse", "management", "admin", "gatehouse"}:
        raise PermissionDenied("Perfil sem acesso ao recebimento.")
    return queryset


def invoice_scoped(queryset, user):
    queryset = supplier_scoped(queryset, user)
    if user_role(user) == "gatehouse":
        return queryset.filter(load_links__isnull=False).distinct()
    return queryset


def require_legacy(appointment):
    if appointment.workflow_version >= 2:
        raise services.DomainConflict("Este recebimento exige o aplicativo atualizado (API v2).")


def _payload(serializer_class, request):
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    strict_identity = False
    queryset = (
        Invoice.objects.select_related("supplier").prefetch_related("items").order_by("-created_at")
    )
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        return invoice_scoped(self.queryset, self.request.user)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    @transaction.atomic
    def upload(self, request):
        require_role(request.user, "supplier", "purchasing", "warehouse")
        uploaded = request.FILES.get("file")
        if not uploaded or uploaded.size > 10 * 1024 * 1024 or uploaded.size == 0:
            raise ValidationError({"file": "Anexe XML/PDF não vazio de até 10 MB."})
        suffix = Path(uploaded.name).suffix.lower()
        if suffix not in {".xml", ".pdf"}:
            raise ValidationError({"file": "Tipos aceitos: XML e PDF."})
        content = uploaded.read()
        extracted = {}
        if suffix == ".xml":
            extracted = parse_invoice_xml(content)
        elif not content.startswith(b"%PDF-"):
            raise ValidationError({"file": "Conteúdo não reconhecido como PDF."})
        if user_role(request.user) == "supplier":
            supplier = request.user.profile.supplier
            if not supplier:
                raise PermissionDenied("Usuário fornecedor sem vínculo.")
            if request.data.get("supplier") and str(supplier.id) != request.data["supplier"]:
                raise PermissionDenied("Você só pode anexar documentos do seu fornecedor.")
        else:
            supplier = get_object_or_404(Supplier, id=request.data.get("supplier"))
        # Serialize the content-addressed cache within a supplier, including the
        # first upload, so simultaneous retries cannot create duplicate documents.
        Supplier.objects.select_for_update().get(pk=supplier.pk)
        supplied_number = str(request.data.get("number", "")).strip()
        declared_number = extracted.get("number", "")
        if declared_number and supplied_number and declared_number != supplied_number:
            raise ValidationError({"number": "O número informado diverge do nNF do XML."})
        number = declared_number or supplied_number
        if self.strict_identity:
            validate_invoice_number(number)
        elif len(number) > 50:
            raise ValidationError({"number": "Número da nota excede 50 caracteres."})
        declared_key = extracted.get("access_key", "")
        supplied_key = str(request.data.get("access_key", "")).strip()
        if declared_key and supplied_key and declared_key != supplied_key:
            raise ValidationError({"access_key": "A chave informada diverge da chave declarada no XML."})
        access_key = declared_key or supplied_key
        if access_key and (len(access_key) != 44 or not access_key.isascii() or not access_key.isdigit()):
            raise ValidationError({"access_key": "Chave deve conter exatamente 44 dígitos."})
        digest = hashlib.sha256(content).hexdigest()
        existing = Invoice.objects.filter(supplier=supplier, sha256=digest).first()
        if existing:
            if ((self.strict_identity or existing.number) and number != existing.number) or ((self.strict_identity or (access_key and existing.access_key)) and access_key != existing.access_key):
                raise ValidationError({"number": "Este arquivo já está cadastrado com outra identificação; confira o documento existente."})
            return Response(InvoiceSerializer(existing).data)
        uploaded.seek(0)
        with transaction.atomic():
            invoice = Invoice.objects.create(
                supplier=supplier,
                file=uploaded,
                original_name=Path(uploaded.name.replace("\\", "/")).name[:200],
                media_type="application/xml" if suffix == ".xml" else "application/pdf",
                sha256=digest,
                number=number,
                access_key=access_key,
                extracted=extracted,
                extraction_status="extracted_unverified" if suffix == ".xml" else "manual",
                created_by=request.user,
                origin="demo_sintetico"
                if supplier.origin == "demo_sintetico"
                else "operacional_registrado",
            )
            InvoiceItem.objects.bulk_create(
                [InvoiceItem(invoice=invoice, **item) for item in extracted.get("items", [])]
            )
        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class AttachmentDownload(APIView):
    def get(self, request, pk):
        invoice = get_object_or_404(invoice_scoped(Invoice.objects.all(), request.user), id=pk)
        response = FileResponse(
            invoice.file.open("rb"),
            as_attachment=True,
            filename=invoice.original_name,
            content_type=invoice.media_type,
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class AppointmentViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]
    queryset = Appointment.objects.select_related("slot", "supplier", "invoice").prefetch_related(
        "visits__warehouse",
        "visits__equipment",
        "events__actor",
        "equipment",
        "capacity_holds__slot",
    )
    serializer_class = AppointmentSerializer

    def get_object(self):
        appointment = super().get_object()
        require_legacy(appointment)
        return appointment

    def get_queryset(self):
        queryset = supplier_scoped(self.queryset, self.request.user)
        for param, field in (
            ("date", "slot__date"),
            ("operation_status", "operation_status"),
            ("origin", "origin"),
            ("supplier", "supplier_id"),
            ("date_from", "slot__date__gte"),
            ("date_to", "slot__date__lte"),
        ):
            if self.request.query_params.get(param):
                value = self.request.query_params[param]
                from rest_framework import serializers

                if param in {"date", "date_from", "date_to"}:
                    value = serializers.DateField().run_validation(value)
                elif param == "supplier":
                    value = serializers.UUIDField().run_validation(value)
                queryset = queryset.filter(**{field: value})
        return queryset

    def create(self, request, *args, **kwargs):
        require_role(request.user, "supplier", "purchasing", "warehouse")
        data = _payload(AppointmentCreateSerializer, request)
        if data["packaging"] == "machine_implement" or "invoice_ids" in request.data:
            raise services.DomainConflict("Máquinas e múltiplas notas exigem o aplicativo atualizado (API v2).")
        if user_role(request.user) == "supplier":
            supplier = request.user.profile.supplier
            if not supplier or (data.get("supplier") and data["supplier"].id != supplier.id):
                raise PermissionDenied("Você só pode agendar para seu fornecedor.")
        else:
            supplier = data.get("supplier")
            if not supplier:
                raise ValidationError({"supplier": "Informe o fornecedor."})
        appointment = services.create_appointment(
            request.user,
            supplier=supplier,
            invoice=data["invoice"],
            day=data["date"],
            time=data["time"],
            packaging=data["packaging"],
            vehicle_plate=data.get("vehicle_plate", ""),
            notes=data.get("notes", ""),
            origin=data.get("origin"),
        )
        return Response(self.get_serializer(appointment).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        require_role(request.user, "supplier", "purchasing", "warehouse")
        appointment = self.get_object()
        data = _payload(AppointmentUpdateSerializer, request)
        if data.get("packaging") == "machine_implement":
            raise services.DomainConflict("Máquinas exigem o aplicativo atualizado (API v2).")
        forbidden = set(request.data) - {
            "invoice",
            "packaging",
            "vehicle_plate",
            "notes",
            "expected_revision",
        }
        if forbidden:
            raise ValidationError(
                {"fields": "Campos de estado/data são modificados somente pelas ações do domínio."}
            )
        result = services.update_appointment(request.user, appointment.id, data)
        return Response(self.get_serializer(result).data)

    def _apply(self, request, serializer_class, service):
        appointment = self.get_object()
        data = _payload(serializer_class, request)
        result = service(request.user, appointment.id, data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"], url_path="purchase-review")
    def purchase_review(self, request, pk=None):
        return self._apply(request, PurchaseReviewSerializer, services.purchase_review)

    @action(detail=True, methods=["post"], url_path="warehouse-review")
    def warehouse_review(self, request, pk=None):
        return self._apply(request, WarehouseReviewSerializer, services.warehouse_review)

    @action(detail=True, methods=["post"])
    def arrive(self, request, pk=None):
        return self._apply(request, EventTimeSerializer, services.arrive)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self._apply(request, EventTimeSerializer, services.start)

    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        return self._apply(request, ResourceSerializer, services.finish)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._apply(request, CancelSerializer, services.cancel)

    @action(detail=True, methods=["post"])
    def reschedule(self, request, pk=None):
        return self._apply(request, RescheduleSerializer, services.reschedule)


class WarehouseVisitViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = WarehouseVisit.objects.select_related("warehouse", "appointment").prefetch_related(
        "equipment"
    )
    serializer_class = WarehouseVisitSerializer

    def get_object(self):
        visit = super().get_object()
        require_legacy(visit.appointment)
        return visit

    def get_queryset(self):
        return supplier_scoped(self.queryset, self.request.user, "appointment__supplier_id")

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        visit = self.get_object()
        result = services.visit_action(
            request.user, visit.id, _payload(EventTimeSerializer, request), "start"
        )
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        visit = self.get_object()
        result = services.visit_action(
            request.user, visit.id, _payload(ResourceSerializer, request), "finish"
        )
        return Response(self.get_serializer(result).data)


class NonReceiptViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "head", "options"]
    queryset = NonReceipt.objects.select_related("supplier", "appointment")
    serializer_class = NonReceiptSerializer

    def get_queryset(self):
        return supplier_scoped(self.queryset, self.request.user)

    def create(self, request, *args, **kwargs):
        require_role(request.user, "warehouse")
        data = _payload(NonReceiptSerializer, request)
        if data.get("appointment"):
            require_legacy(data["appointment"])
        result = services.create_non_receipt(request.user, data)
        return Response(self.get_serializer(result).data, status=status.HTTP_201_CREATED)


class AvailabilityView(APIView):
    def get(self, request):
        from rest_framework import serializers

        day = serializers.DateField().run_validation(request.query_params.get("date"))
        blocked = day.weekday() >= 5 or Holiday.objects.filter(date=day).exists()
        result = []
        for time, _ in TIMES:
            slot = GlobalSlot.objects.filter(date=day, time=time).first()
            state = (
                services.occupancy(slot)
                if slot
                else {
                    "reserved_units": 0,
                    "held_units": 0,
                    "occupied_units": 0,
                    "has_batida": False,
                }
            )
            free = 0 if blocked or state["has_batida"] else max(0, 2 - state["occupied_units"])
            holds = (
                list(slot.holds.filter(active=True))
                if slot and user_role(request.user) in {"warehouse", "admin"}
                else []
            )
            result.append(
                {
                    "slot_id": str(slot.id) if slot else None,
                    "time": time,
                    **state,
                    "available_units": free,
                    "can_batida": not blocked and state["occupied_units"] == 0,
                    "can_paletizada": free > 0,
                    "can_big_bag": free > 0,
                    "holds": CapacityHoldSerializer(holds, many=True).data,
                }
            )
        return Response(
            {
                "date": str(day),
                "calendar_open": not blocked,
                "global_capacity": 2,
                "slots": result,
                "policy": "Capacidade global. Solicitação reserva; vaga cancelada exige atribuição nominal pelo armazém. Agendados têm prioridade; sem agendamento só entram após agendar e validar.",
            }
        )


class AssignCapacityView(APIView):
    def post(self, request):
        require_role(request.user, "warehouse")
        data = _payload(AssignCapacitySerializer, request)
        get_object_or_404(CapacityHold, id=data["hold_id"])
        require_legacy(get_object_or_404(Appointment, id=data["appointment_id"]))
        result = services.assign_cancelled_capacity(request.user, **data)
        return Response(AppointmentSerializer(result).data)
