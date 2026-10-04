from django.urls import path

from labor.views import BulletinCloseView, BulletinReopenView
from labor.views_allocation import AllocationNormsView, DayPlanView
from labor.views_v2 import (RatesViewV2, BulletinListV2, BulletinDetailV2, BulletinPreviewV2,
    BulletinHistoryView, TransferWorkerView, ActivityListView, ActivityDetailView,
    OccurrenceListView, OccurrenceResolveView, ProductionListView, ProductionDetailView, WorkerStatementView)

urlpatterns = [
    path('catalog/service-rates/', RatesViewV2.as_view()),
    path('bulletins/', BulletinListV2.as_view()),
    path('bulletins/preview/', BulletinPreviewV2.as_view()),
    path('bulletins/<uuid:pk>/', BulletinDetailV2.as_view()),
    path('bulletins/<uuid:pk>/close/', BulletinCloseView.as_view()),
    path('bulletins/<uuid:pk>/reopen/', BulletinReopenView.as_view()),
    path('bulletins/<uuid:pk>/history/', BulletinHistoryView.as_view()),
    path('bulletins/<uuid:pk>/transfer-worker/', TransferWorkerView.as_view()),
    path('labor-activities/', ActivityListView.as_view()),
    path('labor-activities/<uuid:pk>/', ActivityDetailView.as_view()),
    path('labor-rule-occurrences/', OccurrenceListView.as_view()),
    path('labor-rule-occurrences/<uuid:pk>/resolve/', OccurrenceResolveView.as_view()),
    path('production-records/', ProductionListView.as_view()),
    path('production-records/<uuid:pk>/', ProductionDetailView.as_view()),
    path('workers/<uuid:pk>/statement/', WorkerStatementView.as_view()),
    path('allocation/norms/', AllocationNormsView.as_view()),
    path('allocation/day-plan/', DayPlanView.as_view()),
]
