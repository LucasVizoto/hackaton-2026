from decimal import Decimal

from rest_framework import serializers

from catalog.models import Supplier
from .models import Appointment, Invoice, TIMES, ReceiptLine, InternalNotification, ReceivingException, PurchaseOrder, PurchaseOrderLine
from .serializers import PackagingField, AppointmentSerializer, InvoiceSerializer, WarehouseVisitSerializer


class CommandInput(serializers.Serializer):
    expected_revision = serializers.IntegerField(min_value=1)
    idempotency_key = serializers.UUIDField(required=False)


class TimeInput(CommandInput):
    occurred_at = serializers.DateTimeField(required=False)


class GateCheckInInput(TimeInput):
    driver_name = serializers.CharField(max_length=160, required=False, allow_blank=False)


class ResourceInput(TimeInput):
    worker_count = serializers.IntegerField(min_value=0, max_value=100)
    equipment_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)
    resources_confirmed = serializers.BooleanField()


class AppointmentInput(serializers.Serializer):
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), required=False)
    invoice_ids = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all(), many=True)
    date = serializers.DateField()
    time = serializers.ChoiceField(choices=TIMES)
    packaging = PackagingField()
    vehicle_plate = serializers.CharField(max_length=30)
    tractor_plate = serializers.CharField(max_length=30, required=False, allow_blank=True)
    carrier_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    driver_name = serializers.CharField(max_length=160, required=False, allow_blank=True)
    articulated = serializers.BooleanField(default=False)
    booking_kind = serializers.ChoiceField(choices=["scheduled", "spontaneous"], default="scheduled")
    notes = serializers.CharField(required=False, allow_blank=True)
    idempotency_key = serializers.UUIDField(required=False)
    previous_appointment = serializers.PrimaryKeyRelatedField(queryset=Appointment.objects.all(), required=False)
    resubmission_reason = serializers.CharField(max_length=2000, required=False, allow_blank=True)

    def validate_invoice_ids(self, invoices):
        if not 1 <= len(invoices) <= 30 or len({i.pk for i in invoices}) != len(invoices):
            raise serializers.ValidationError("Informe de 1 a 30 notas distintas.")
        return invoices

    def validate(self, data):
        if "origin" in self.initial_data:
            raise serializers.ValidationError({"origin": "A origem é determinada pelo servidor."})
        if data.get("articulated") and not data.get("tractor_plate", "").strip():
            raise serializers.ValidationError({"tractor_plate": "Veículo articulado exige placa do cavalo."})
        return data


class AppointmentEditInput(CommandInput):
    invoice_ids = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all(), many=True, required=False)
    vehicle_plate = serializers.CharField(max_length=30, required=False)
    tractor_plate = serializers.CharField(max_length=30, required=False, allow_blank=True)
    carrier_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    driver_name = serializers.CharField(max_length=160, required=False, allow_blank=True)
    articulated = serializers.BooleanField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    packaging = PackagingField( required=False)

    def validate(self, data):
        allowed = set(self.fields)
        if set(self.initial_data) - allowed:
            raise serializers.ValidationError("Estado, origem e horários exigem as ações específicas.")
        if "invoice_ids" in data:
            AppointmentInput().validate_invoice_ids(data["invoice_ids"])
        return data


class PurchaseInput(CommandInput):
    decision = serializers.ChoiceField(choices=["pending", "approved", "rejected"])
    order_reference = serializers.CharField(max_length=100, required=False, allow_blank=True)
    comparison_notes = serializers.CharField(required=False, allow_blank=True)


class DestinationsInput(CommandInput):
    warehouse_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=4)
    notes = serializers.CharField(required=False, allow_blank=True)


class ReasonInput(CommandInput):
    reason = serializers.CharField(allow_blank=False)


class RescheduleInput(ReasonInput):
    date = serializers.DateField()
    time = serializers.ChoiceField(choices=TIMES)
    nature_exception = serializers.BooleanField()


class CorrectionInput(ReasonInput):
    target = serializers.ChoiceField(choices=["gate_check_in", "gate_check_out", "warehouse_check_in", "warehouse_check_out"])
    visit_id = serializers.UUIDField(required=False)
    occurred_at = serializers.DateTimeField()


class ReceiptLineInput(CommandInput):
    line_id = serializers.UUIDField(required=False)
    invoice = serializers.UUIDField()
    invoice_item = serializers.UUIDField(required=False)
    purchase_order_line = serializers.UUIDField(required=False, allow_null=True)
    previous_receipt_line = serializers.UUIDField(required=False, allow_null=True)
    description = serializers.CharField(max_length=400, required=False)
    unit = serializers.CharField(max_length=30, required=False)
    declared_quantity = serializers.DecimalField(max_digits=22, decimal_places=6, min_value=Decimal(0), required=False)
    observed_quantity = serializers.DecimalField(max_digits=22, decimal_places=6, min_value=Decimal(0))
    accepted_quantity = serializers.DecimalField(max_digits=22, decimal_places=6, min_value=Decimal(0))
    rejected_quantity = serializers.DecimalField(max_digits=22, decimal_places=6, min_value=Decimal(0))
    discrepancy_reason = serializers.CharField(required=False, allow_blank=True)


class ReceiptReviewInput(CommandInput):
    line_id = serializers.UUIDField()
    decision = serializers.ChoiceField(choices=["approved", "rejected"])
    decision_notes = serializers.CharField(allow_blank=False)


class ReceiptLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReceiptLine
        fields = ["id", "invoice", "invoice_item", "purchase_order_line", "previous_receipt_line", "description", "unit", "declared_quantity",
                  "observed_quantity", "accepted_quantity", "rejected_quantity", "decision",
                  "discrepancy_reason", "decision_notes", "reviewed_at", "recorded_at"]


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = InternalNotification
        fields = ["id", "appointment", "recipient_role", "kind", "message", "created_at", "acknowledged_at"]


class VisitSerializer(WarehouseVisitSerializer):
    available_actions = serializers.SerializerMethodField()

    def get_available_actions(self, obj):
        from .workflow import visit_actions
        request = self.context.get("request")
        return visit_actions(obj, request.user) if request else []

    class Meta(WarehouseVisitSerializer.Meta):
        fields = [*WarehouseVisitSerializer.Meta.fields, "checked_in_at", "checked_out_at", "available_actions"]


class AppointmentV2Serializer(AppointmentSerializer):
    invoices = serializers.SerializerMethodField()
    available_actions = serializers.SerializerMethodField()
    visits = VisitSerializer(many=True, read_only=True)
    receipt_lines = ReceiptLineSerializer(many=True, read_only=True)
    exceptions = serializers.SerializerMethodField()

    def get_exceptions(self, obj):
        request = self.context.get("request")
        query = obj.exceptions.all()
        if request:
            from core.permissions import user_role
            if user_role(request.user) == "gatehouse":
                query = query.filter(actor=request.user)
        return [{"id": str(x.pk), "kind": x.kind, "description": x.description,
                 "occurred_at": x.occurred_at.isoformat(), "recorded_at": x.recorded_at.isoformat()}
                for x in query]

    def get_invoices(self, obj):
        links = list(obj.invoice_links.all())
        return InvoiceSerializer([link.invoice for link in links] or [obj.invoice], many=True, context=self.context).data

    def get_available_actions(self, obj):
        from .workflow import available_actions
        request = self.context.get("request")
        return available_actions(obj, request.user) if request else []

    class Meta(AppointmentSerializer.Meta):
        fields = [*AppointmentSerializer.Meta.fields, "invoices", "tractor_plate", "carrier_name", "driver_name",
                  "gate_checked_in_at", "gate_checked_out_at", "available_actions", "receipt_lines",
                  "articulated", "assisted", "booking_kind", "exceptions", "previous_appointment", "resubmission_reason"]


class ExceptionInput(TimeInput):
    kind = serializers.ChoiceField(choices=ReceivingException._meta.get_field("kind").choices)
    description = serializers.CharField(allow_blank=False)


class OrderLineInput(serializers.Serializer):
    description = serializers.CharField(max_length=400)
    unit = serializers.CharField(max_length=30)
    ordered_quantity = serializers.DecimalField(max_digits=22, decimal_places=6, min_value=Decimal("0.000001"))


class OrderInput(serializers.Serializer):
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all())
    reference = serializers.CharField(max_length=100)
    confirmation_notes = serializers.CharField(allow_blank=False)
    lines = OrderLineInput(many=True, min_length=1, max_length=1000)


class OrderLineSerializer(serializers.ModelSerializer):
    accepted_quantity = serializers.SerializerMethodField()
    remaining_quantity = serializers.SerializerMethodField()

    def get_accepted_quantity(self, obj):
        from django.db.models import Sum
        return str(obj.receipts.filter(decision="approved").exclude(
            appointment__operation_status__in=["cancelled", "not_received"]
        ).aggregate(total=Sum("accepted_quantity"))["total"] or Decimal(0))

    def get_remaining_quantity(self, obj):
        return str(obj.ordered_quantity - Decimal(self.get_accepted_quantity(obj)))

    class Meta:
        model = PurchaseOrderLine
        fields = ["id", "position", "description", "unit", "ordered_quantity", "accepted_quantity", "remaining_quantity"]


class OrderSerializer(serializers.ModelSerializer):
    lines = OrderLineSerializer(many=True)

    class Meta:
        model = PurchaseOrder
        fields = ["id", "supplier", "reference", "confirmation_notes", "confirmed_at", "lines"]
