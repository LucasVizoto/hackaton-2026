from rest_framework import serializers

from catalog.models import Supplier
from core.permissions import user_role

from .models import (
    Appointment,
    CapacityHold,
    GateArrival,
    Invoice,
    InvoiceItem,
    NonReceipt,
    PACKAGING,
    PURCHASE,
    ReceivingEvent,
    TIMES,
    WarehouseVisit,
)


class PackagingField(serializers.ChoiceField):
    def __init__(self, **kwargs):
        super().__init__(choices=PACKAGING, **kwargs)

    def to_internal_value(self, data):
        return super().to_internal_value("machine_implement" if data == "maquina_implemento" else data)


class InvoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceItem
        fields = [
            "id",
            "position",
            "supplier_code",
            "description",
            "unit",
            "quantity",
            "unit_value",
        ]


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceItemSerializer(many=True, read_only=True)
    attachment_id = serializers.UUIDField(source="id", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    download_url = serializers.SerializerMethodField()

    def get_download_url(self, obj):
        return f"/api/v1/attachments/{obj.id}/download/"

    class Meta:
        model = Invoice
        fields = [
            "id",
            "supplier",
            "supplier_name",
            "number",
            "access_key",
            "original_name",
            "media_type",
            "extracted",
            "extraction_status",
            "items",
            "attachment_id",
            "download_url",
            "origin",
            "created_at",
        ]


class WarehouseVisitSerializer(serializers.ModelSerializer):
    warehouse_name = serializers.CharField(source="warehouse.name", read_only=True)
    equipment_ids = serializers.PrimaryKeyRelatedField(
        source="equipment", many=True, read_only=True
    )

    class Meta:
        model = WarehouseVisit
        fields = [
            "id",
            "appointment",
            "warehouse",
            "warehouse_name",
            "sequence",
            "started_at",
            "finished_at",
            "worker_count",
            "equipment_ids",
            "resources_confirmed",
        ]


class ReceivingEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.username", read_only=True)

    class Meta:
        model = ReceivingEvent
        fields = ["id", "kind", "actor_name", "occurred_at", "recorded_at", "data"]


class CapacityHoldSerializer(serializers.ModelSerializer):
    date = serializers.DateField(source="slot.date", read_only=True)
    time = serializers.CharField(source="slot.time", read_only=True)

    class Meta:
        model = CapacityHold
        fields = [
            "id",
            "slot",
            "date",
            "time",
            "source_appointment",
            "units",
            "exclusive",
            "active",
            "reason",
            "created_at",
            "assigned_to",
        ]


class AppointmentSerializer(serializers.ModelSerializer):
    date = serializers.DateField(source="slot.date", read_only=True)
    time = serializers.CharField(source="slot.time", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    invoice_number = serializers.CharField(source="invoice.number", read_only=True)
    attachment_id = serializers.UUIDField(source="invoice_id", read_only=True)
    visits = WarehouseVisitSerializer(many=True, read_only=True)
    events = ReceivingEventSerializer(many=True, read_only=True)
    equipment_ids = serializers.PrimaryKeyRelatedField(
        source="equipment", many=True, read_only=True
    )
    capacity_holds = CapacityHoldSerializer(many=True, read_only=True)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request and user_role(request.user) == "gatehouse":
            for field in ("order_reference", "comparison_notes", "purchase_reviewed_at", "divergence_notes", "divergence_reported_at", "notes", "resubmission_reason"):
                data.pop(field, None)
            # Status is sufficient for access control. Internal purchase decisions
            # and receipt analyses do not become visible through the audit trail.
            operational = {"created", "arrived", "started", "finished", "cancelled", "not_received", "rescheduled",
                           "gate_check_in", "gate_check_out", "warehouse_check_in", "warehouse_check_out", "timestamp_corrected"}
            data["events"] = [
                {key: value for key, value in event.items() if key not in {"data", "actor_name"}}
                for event in data.get("events", []) if event["kind"] in operational
            ]
            for hold in data.get("capacity_holds", []):
                hold.pop("reason", None)
            # The v2 subclass adds these fields before this representation hook.
            if "receipt_lines" in data:
                data["receipt_lines"] = []
        return data

    class Meta:
        model = Appointment
        fields = [
            "id",
            "workflow_version",
            "supplier",
            "supplier_name",
            "invoice",
            "invoice_number",
            "attachment_id",
            "slot",
            "date",
            "time",
            "packaging",
            "vehicle_plate",
            "notes",
            "origin",
            "purchase_status",
            "order_reference",
            "comparison_notes",
            "purchase_reviewed_at",
            "warehouse_status",
            "warehouse_reviewed_at",
            "divergence_notes",
            "divergence_reported_at",
            "operation_status",
            "arrived_at",
            "started_at",
            "finished_at",
            "worker_count",
            "equipment_ids",
            "resources_confirmed",
            "capacity_reserved",
            "nature_exception",
            "priority",
            "revision",
            "created_at",
            "updated_at",
            "visits",
            "events",
            "capacity_holds",
        ]


class AppointmentCreateSerializer(serializers.Serializer):
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all(), required=False)
    invoice = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all())
    date = serializers.DateField()
    time = serializers.ChoiceField(choices=TIMES)
    packaging = PackagingField()
    vehicle_plate = serializers.CharField(max_length=30, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    origin = serializers.ChoiceField(
        choices=["operacional_registrado", "demo_sintetico"], required=False
    )


class AppointmentUpdateSerializer(serializers.Serializer):
    invoice = serializers.PrimaryKeyRelatedField(queryset=Invoice.objects.all(), required=False)
    packaging = PackagingField( required=False)
    vehicle_plate = serializers.CharField(max_length=30, required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    expected_revision = serializers.IntegerField(min_value=1, required=False)


class EventTimeSerializer(serializers.Serializer):
    occurred_at = serializers.DateTimeField(required=False)
    expected_revision = serializers.IntegerField(min_value=1, required=False)


class ResourceSerializer(EventTimeSerializer):
    worker_count = serializers.IntegerField(min_value=0, max_value=100)
    equipment_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)
    resources_confirmed = serializers.BooleanField()


class PurchaseReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=PURCHASE)
    order_reference = serializers.CharField(max_length=100, required=False, allow_blank=True)
    comparison_notes = serializers.CharField(required=False, allow_blank=True)
    expected_revision = serializers.IntegerField(min_value=1, required=False)


class WarehouseReviewSerializer(serializers.Serializer):
    warehouse_ids = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=4
    )
    notes = serializers.CharField(required=False, allow_blank=True)
    expected_revision = serializers.IntegerField(min_value=1, required=False)


class CancelSerializer(serializers.Serializer):
    reason = serializers.CharField(allow_blank=False)
    expected_revision = serializers.IntegerField(min_value=1, required=False)


class RescheduleSerializer(CancelSerializer):
    date = serializers.DateField()
    time = serializers.ChoiceField(choices=TIMES)
    nature_exception = serializers.BooleanField()


class AssignCapacitySerializer(serializers.Serializer):
    hold_id = serializers.UUIDField()
    appointment_id = serializers.UUIDField()
    expected_revision = serializers.IntegerField(min_value=1, required=False)


class GateArrivalSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = GateArrival
        fields = [
            "id",
            "vehicle_plate",
            "tractor_plate",
            "driver_name",
            "invoice_number",
            "created_at",
            "decision",
            "decided_at",
            "seen_at",
            "created_by_name",
            "appointment",
            "occurrence_at",
        ]


class NonReceiptSerializer(serializers.ModelSerializer):
    expected_revision = serializers.IntegerField(min_value=1, required=False, write_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = NonReceipt
        fields = [
            "id",
            "appointment",
            "supplier",
            "supplier_name",
            "reason",
            "description",
            "vehicle_plate",
            "occurred_at",
            "origin",
            "created_at",
            "expected_revision",
        ]
        read_only_fields = ["id", "created_at"]
        extra_kwargs = {"occurred_at": {"required": False}, "appointment": {"validators": []}}
        validators = []
