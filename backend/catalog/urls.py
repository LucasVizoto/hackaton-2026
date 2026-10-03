from rest_framework.routers import DefaultRouter

from .views import EquipmentViewSet, SupplierViewSet, WarehouseViewSet, WorkerViewSet

router = DefaultRouter()
router.register("warehouses", WarehouseViewSet)
router.register("suppliers", SupplierViewSet)
router.register("workers", WorkerViewSet)
router.register("equipment", EquipmentViewSet)
urlpatterns = router.urls
