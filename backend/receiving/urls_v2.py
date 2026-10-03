from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AttachmentDownload
from .gate import (
    GateArrivalDecisionView,
    GateArrivalFileView,
    GateArrivalListView,
    GateArrivalSeenView,
)
from .views_v2 import (AppointmentsV2, AvailabilityV2, AssignCapacityV2, InvoicesV2,
                       VisitsV2, NonReceiptsV2, NotificationsV2, PurchaseOrdersV2)

router = DefaultRouter()
router.register("appointments", AppointmentsV2, basename="v2-appointments")
router.register("invoices", InvoicesV2, basename="v2-invoices")
router.register("warehouse-visits", VisitsV2, basename="v2-visits")
router.register("non-receipts", NonReceiptsV2, basename="v2-nonreceipts")
router.register("notifications", NotificationsV2, basename="v2-notifications")
router.register("purchase-orders", PurchaseOrdersV2, basename="v2-purchase-orders")
urlpatterns = [
    path("gate-arrivals/", GateArrivalListView.as_view()),
    path("gate-arrivals/<uuid:pk>/decision/", GateArrivalDecisionView.as_view()),
    path("gate-arrivals/<uuid:pk>/seen/", GateArrivalSeenView.as_view()),
    path("gate-arrivals/<uuid:pk>/file/", GateArrivalFileView.as_view()),
    path("slots/availability/", AvailabilityV2.as_view()),
    path("slots/assign-cancelled-capacity/", AssignCapacityV2.as_view()),
    path("attachments/<uuid:pk>/download/", AttachmentDownload.as_view()),
    *router.urls,
]
