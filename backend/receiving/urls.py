from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AppointmentViewSet,
    AssignCapacityView,
    AttachmentDownload,
    AvailabilityView,
    InvoiceViewSet,
    NonReceiptViewSet,
    WarehouseVisitViewSet,
)

router = DefaultRouter()
router.register("appointments", AppointmentViewSet)
router.register("invoices", InvoiceViewSet)
router.register("warehouse-visits", WarehouseVisitViewSet)
router.register("non-receipts", NonReceiptViewSet)
urlpatterns = [
    path("slots/availability/", AvailabilityView.as_view()),
    path("slots/assign-cancelled-capacity/", AssignCapacityView.as_view()),
    path("attachments/<uuid:pk>/download/", AttachmentDownload.as_view()),
    *router.urls,
]
