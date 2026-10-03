from rest_framework import serializers, viewsets

from core.permissions import user_role

from .models import Equipment, Supplier, Warehouse, Worker


class WarehouseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Warehouse
        fields = ["id", "code", "name"]


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "code", "name", "document", "origin"]


class WorkerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Worker
        fields = ["id", "registration", "name", "origin"]


class EquipmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Equipment
        fields = ["id", "code", "name", "warehouse", "mobile"]


class WarehouseViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Warehouse.objects.all()
    serializer_class = WarehouseSerializer


class SupplierViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer

    def get_queryset(self):
        if user_role(self.request.user) == "supplier":
            return self.queryset.filter(id=self.request.user.profile.supplier_id)
        return self.queryset


class WorkerViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Worker.objects.all()
    serializer_class = WorkerSerializer

    def get_queryset(self):
        if user_role(self.request.user) == "supplier":
            return self.queryset.none()
        queryset = self.queryset
        if self.request.query_params.get("registration"):
            queryset = queryset.filter(registration=self.request.query_params["registration"])
        return queryset


class EquipmentViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Equipment.objects.all()
    serializer_class = EquipmentSerializer
