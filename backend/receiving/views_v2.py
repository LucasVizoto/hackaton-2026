from datetime import timedelta

from django.db import transaction, IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import require_role, user_role
from . import services, workflow
from .models import Appointment, CapacityHold, GlobalSlot, Holiday, InternalNotification, TIMES, PurchaseOrder, PurchaseOrderLine
from .serializers import AssignCapacitySerializer, NonReceiptSerializer, PackagingField
from .serializers_v2 import (
    AppointmentInput, AppointmentEditInput, AppointmentV2Serializer, CommandInput, CorrectionInput,
    DestinationsInput, NotificationSerializer, PurchaseInput, ReasonInput, ReceiptLineInput,
    ReceiptReviewInput, RescheduleInput, ResourceInput, TimeInput, VisitSerializer,
    ExceptionInput, OrderInput, OrderSerializer,
)
from .views import (AppointmentViewSet, InvoiceViewSet, NonReceiptViewSet, WarehouseVisitViewSet,
                    _payload, supplier_scoped)


class InvoicesV2(InvoiceViewSet):
    strict_identity = True


class AppointmentsV2(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = AppointmentV2Serializer
    queryset = AppointmentViewSet.queryset.prefetch_related("invoice_links__invoice__items", "receipt_lines")

    def get_queryset(self):
        return AppointmentViewSet.get_queryset(self)

    def create(self, request):
        data = _payload(AppointmentInput, request)
        result = workflow.create(request.user, data)
        return Response(self.get_serializer(result).data, status=201)

    def partial_update(self, request, pk=None):
        ap = self.get_object()
        result = workflow.perform(request.user, ap.pk, "edit", _payload(AppointmentEditInput, request))
        return Response(self.get_serializer(result).data)

    def apply(self, request, code, schema, legacy_service=None):
        ap = self.get_object()
        data = _payload(schema, request)
        if ap.workflow_version == 1:
            if not legacy_service:
                raise services.DomainConflict("Registro legado não contém os quatro marcos; use as ações legadas disponíveis.")
            result = legacy_service(request.user, ap.pk, data)
        else:
            result = workflow.perform(request.user, ap.pk, code, data)
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"], url_path="gate-check-in")
    def gate_check_in(self, request, pk=None):
        return self.apply(request, "gate-check-in", TimeInput)

    @action(detail=True, methods=["post"], url_path="gate-check-out")
    def gate_check_out(self, request, pk=None):
        return self.apply(request, "gate-check-out", TimeInput)

    @action(detail=True, methods=["post"], url_path="purchase-review")
    def purchase_review(self, request, pk=None):
        return self.apply(request, "purchase-review", PurchaseInput, services.purchase_review)

    @action(detail=True, methods=["post"], url_path="forward-to-purchasing")
    def forward_to_purchasing(self, request, pk=None):
        return self.apply(request, "forward-to-purchasing", ReasonInput, services.forward_to_purchasing)

    @action(detail=True, methods=["post"], url_path="warehouse-review")
    def warehouse_review(self, request, pk=None):
        return self.apply(request, "warehouse-review", DestinationsInput, services.warehouse_review)

    @action(detail=True, methods=["post"], url_path="correct-time")
    def correct_time(self, request, pk=None):
        return self.apply(request, "correct-time", CorrectionInput)

    @action(detail=True, methods=["post"], url_path="receipt-lines")
    def receipt_lines(self, request, pk=None):
        return self.apply(request, "receipt-lines", ReceiptLineInput)

    @action(detail=True, methods=["post"], url_path="receipt-review")
    def receipt_review(self, request, pk=None):
        return self.apply(request, "receipt-review", ReceiptReviewInput)

    @action(detail=True, methods=["post"])
    def exceptions(self, request, pk=None):
        return self.apply(request, "exceptions", ExceptionInput)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self.apply(request, "cancel", ReasonInput, services.cancel)

    @action(detail=True, methods=["post"])
    def reschedule(self, request, pk=None):
        return self.apply(request, "reschedule", RescheduleInput, services.reschedule)

    def legacy_only(self, request, schema, service):
        ap = self.get_object()
        if ap.workflow_version != 1:
            raise services.DomainConflict("Este registro exige os quatro marcos de portaria/armazém.")
        result = service(request.user, ap.pk, _payload(schema, request))
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"])
    def arrive(self, request, pk=None):
        return self.legacy_only(request, TimeInput, services.arrive)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self.legacy_only(request, TimeInput, services.start)

    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        return self.legacy_only(request, ResourceInput, services.finish)


class VisitsV2(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = WarehouseVisitViewSet.queryset
    serializer_class = VisitSerializer

    def get_queryset(self):
        return supplier_scoped(self.queryset, self.request.user, "appointment__supplier_id")

    def apply(self, request, entering):
        visit = self.get_object()
        data = _payload(TimeInput if entering else ResourceInput, request)
        if visit.appointment.workflow_version != 2:
            raise services.DomainConflict("Etapa legada: use start/finish; novos horários não são inferidos.")
        workflow.perform(request.user, visit.appointment_id, "check-in" if entering else "check-out",
                         {**data, "visit_id": visit.pk})
        visit.refresh_from_db()
        return Response(self.get_serializer(visit).data)

    @action(detail=True, methods=["post"], url_path="check-in")
    def check_in(self, request, pk=None):
        return self.apply(request, True)

    @action(detail=True, methods=["post"], url_path="check-out")
    def check_out(self, request, pk=None):
        return self.apply(request, False)

    def legacy_only(self, request, entering):
        visit = self.get_object()
        if visit.appointment.workflow_version != 1:
            raise services.DomainConflict("Use check-in/check-out para este recebimento.")
        result = services.visit_action(request.user, visit.pk,
                 _payload(TimeInput if entering else ResourceInput, request), "start" if entering else "finish")
        return Response(self.get_serializer(result).data)

    @action(detail=True, methods=["post"])
    def start(self, request, pk=None):
        return self.legacy_only(request, True)

    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        return self.legacy_only(request, False)


class NonReceiptsV2(NonReceiptViewSet):
    @transaction.atomic
    def create(self, request, *args, **kwargs):
        require_role(request.user, "warehouse")
        if "origin" in request.data:
            raise ValidationError({"origin": "A origem é determinada pelo servidor."})
        data = _payload(NonReceiptSerializer, request)
        supplier = data.get("supplier")
        if not data.get("appointment"):
            data["origin"] = "demo_sintetico" if supplier and supplier.origin == "demo_sintetico" else "operacional_registrado"
        if data.get("appointment") and data["appointment"].workflow_version == 2:
            _payload(CommandInput, request)
        result = services.create_non_receipt(request.user, data)
        if result.appointment_id and result.appointment.gate_checked_in_at:
            workflow.notification(result.appointment, "gatehouse", "non_receipt", "Não recebimento registrado; conferir saída da portaria.")
        return Response(self.get_serializer(result).data, status=201)


class AvailabilityInput(serializers.Serializer):
    date = serializers.DateField(required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    packaging = PackagingField(default="paletizada")
    exclude_appointment = serializers.UUIDField(required=False)
    nature_exception = serializers.BooleanField(default=False)

    def validate(self, data):
        if "date" in data:
            if "date_from" in data or "date_to" in data:
                raise serializers.ValidationError("Use data única ou intervalo, não ambos.")
        else:
            if "date_from" not in data or "date_to" not in data:
                raise serializers.ValidationError("Informe date ou date_from e date_to.")
            span = (data["date_to"] - data["date_from"]).days
            if not 0 <= span < 62:
                raise serializers.ValidationError("Intervalo deve conter entre 1 e 62 dias.")
        return data


class AvailabilityV2(APIView):
    def get(self, request):
        schema = AvailabilityInput(data=request.query_params)
        schema.is_valid(raise_exception=True)
        data = schema.validated_data
        ap = None
        if data.get("exclude_appointment"):
            ap = get_object_or_404(supplier_scoped(Appointment.objects.all(), request.user), pk=data["exclude_appointment"])
        if data["nature_exception"]:
            require_role(request.user, "warehouse")
            if not ap:
                raise ValidationError("Exceção exige o agendamento a reagendar.")
        if "date" in data:
            return Response(self.day(data["date"], data, ap))
        days = [self.day(data["date_from"] + timedelta(days=index), data, ap)
                for index in range((data["date_to"] - data["date_from"]).days + 1)]
        return Response({"global_capacity": 2, "days": days, "packaging": data["packaging"]})

    def day(self, day, data, ap):
        blocked = day.weekday() >= 5 or Holiday.objects.filter(date=day).exists()
        exclusive = data["packaging"] == "batida"
        rows = []
        for time, _ in TIMES:
            slot = GlobalSlot.objects.filter(date=day, time=time).first()
            state = services.occupancy(slot, exclude_appointment=ap.pk if ap else None) if slot else {
                "reserved_units": 0, "held_units": 0, "occupied_units": 0, "has_batida": False}
            free = 0 if blocked or state["has_batida"] else max(0, 2 - state["occupied_units"])
            can_exclusive = not blocked and state["occupied_units"] == 0
            eligible = can_exclusive if exclusive else not blocked and not state["has_batida"] and (free > 0 or data["nature_exception"])
            reason = "" if eligible else ("Calendário fechado." if blocked else "Horário indisponível para este acondicionamento.")
            rows.append({"slot_id": str(slot.pk) if slot else None, "time": time, **state,
                         "available_units": free, "can_batida": can_exclusive,
                         "can_machine_implement": not blocked and not state["has_batida"] and (free > 0 or data["nature_exception"]),
                         "can_paletizada": not blocked and not state["has_batida"] and (free > 0 or data["nature_exception"]),
                         "can_big_bag": not blocked and not state["has_batida"] and (free > 0 or data["nature_exception"]),
                         "eligible": eligible, "reason": reason})
        return {"date": str(day), "calendar_open": not blocked, "global_capacity": 2,
                "slots": rows, "packaging": data["packaging"], "nature_exception": data["nature_exception"]}


class AssignCapacityV2(APIView):
    def post(self, request):
        require_role(request.user, "warehouse")
        data = _payload(AssignCapacitySerializer, request)
        ap = get_object_or_404(Appointment, pk=data["appointment_id"])
        get_object_or_404(CapacityHold, pk=data["hold_id"])
        if ap.workflow_version == 2:
            _payload(CommandInput, request)
        result = services.assign_cancelled_capacity(request.user, **data)
        return Response(AppointmentV2Serializer(result, context={"request": request}).data)


class NotificationsV2(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        require_role(self.request.user, "warehouse", "purchasing", "gatehouse", "management")
        query = InternalNotification.objects.select_related("appointment")
        if user_role(self.request.user) not in {"admin", "management"}:
            query = query.filter(recipient_role=user_role(self.request.user))
        if self.request.query_params.get("unread") == "true":
            query = query.filter(acknowledged_at__isnull=True)
        return query

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        require_role(request.user, "warehouse", "purchasing", "gatehouse")
        with transaction.atomic():
            item = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
            if not item.acknowledged_at:
                item.acknowledged_at = timezone.now()
                item.acknowledged_by = request.user
                item.save(update_fields=["acknowledged_at", "acknowledged_by"])
        return Response(self.get_serializer(item).data)


class PurchaseOrdersV2(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = OrderSerializer

    def get_queryset(self):
        require_role(self.request.user, "purchasing", "warehouse", "management")
        query = PurchaseOrder.objects.prefetch_related("lines")
        supplier = self.request.query_params.get("supplier")
        if supplier:
            query = query.filter(supplier_id=serializers.UUIDField().run_validation(supplier))
        return query

    def create(self, request):
        require_role(request.user, "purchasing")
        data = _payload(OrderInput, request)
        try:
            with transaction.atomic():
                order = PurchaseOrder.objects.create(supplier=data["supplier"], reference=data["reference"],
                            confirmation_notes=data["confirmation_notes"], confirmed_by=request.user)
                PurchaseOrderLine.objects.bulk_create([PurchaseOrderLine(order=order, position=i, **line)
                                                       for i, line in enumerate(data["lines"], 1)])
        except IntegrityError:
            raise ValidationError({"reference": "Pedido confirmado já cadastrado para este fornecedor."}) from None
        return Response(self.get_serializer(order).data, status=201)
