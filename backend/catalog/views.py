from rest_framework import serializers, viewsets, status
from rest_framework.response import Response

from core.permissions import user_role, IsInternal, require_role

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
        fields = ["id", "registration", "name", "origin", "is_active"]

    def validate_origin(self, value):
        if self.instance and value == self.instance.origin:
            return value
        if value == "historico_importado":
            raise serializers.ValidationError("Origem histórica exige importação rastreável.")
        if self.instance and value != self.instance.origin:
            raise serializers.ValidationError("A origem de um cadastro existente não muda.")
        return value


class EquipmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Equipment
        fields = ["id", "code", "name", "warehouse", "mobile", "purpose", "is_active"]


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


class ActiveCatalogMixin:
    def perform_create(self, serializer):
        require_role(self.request.user, "warehouse", "management")
        serializer.save()

    def perform_update(self, serializer):
        require_role(self.request.user, "warehouse", "management")
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        require_role(request.user, "warehouse", "management")
        instance = self.get_object()
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def get_queryset(self):
        query = super().get_queryset()
        active = self.request.query_params.get("is_active")
        if active in {"true", "false"}:
            query = query.filter(is_active=active == "true")
        return query


class WorkerCatalogPermission(IsInternal):
    def has_permission(self, request, view):
        if (request.path.startswith('/api/v1/') and request.method in {'GET', 'HEAD', 'OPTIONS'}
                and request.user.is_authenticated and user_role(request.user) == 'supplier'):
            return True
        return super().has_permission(request, view)


class WorkerViewSet(ActiveCatalogMixin, viewsets.ModelViewSet):
    permission_classes = [WorkerCatalogPermission]
    queryset = Worker.objects.all()
    serializer_class = WorkerSerializer

    def get_queryset(self):
        if user_role(self.request.user) == "supplier":
            return self.queryset.none()
        queryset = super().get_queryset()
        if self.request.query_params.get("registration"):
            queryset = queryset.filter(registration=self.request.query_params["registration"])
        return queryset


class EquipmentViewSet(ActiveCatalogMixin, viewsets.ModelViewSet):
    queryset = Equipment.objects.all()
    serializer_class = EquipmentSerializer

    def perform_create(self, serializer):
        require_role(self.request.user, "warehouse")
        serializer.save()

    def perform_update(self, serializer):
        require_role(self.request.user, "warehouse")
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        require_role(request.user, "warehouse")
        return super().destroy(request, *args, **kwargs)
