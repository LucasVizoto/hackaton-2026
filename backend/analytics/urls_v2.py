from django.urls import path

from analytics.logistics import LogisticsView
from analytics.views_v2 import LaborCostsV2View, OperationsV2View, StaffingScenarioV2View

urlpatterns = [
    path("logistics/", LogisticsView.as_view()),
    path("operations/", OperationsV2View.as_view()),
    path("labor-costs/", LaborCostsV2View.as_view()),
    path("staffing-scenario/", StaffingScenarioV2View.as_view()),
]
