from django.urls import path
from rest_framework.routers import DefaultRouter

from .gate import GateArrivalFileView, GateArrivalListView, GateArrivalSeenView
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
    path("gate-arrivals/", GateArrivalListView.as_view()),
    path("gate-arrivals/<uuid:pk>/seen/", GateArrivalSeenView.as_view()),
    path("gate-arrivals/<uuid:pk>/file/", GateArrivalFileView.as_view()),
    path("slots/availability/", AvailabilityView.as_view()),
    path("slots/assign-cancelled-capacity/", AssignCapacityView.as_view()),
    path("attachments/<uuid:pk>/download/", AttachmentDownload.as_view()),
    *router.urls,
]
