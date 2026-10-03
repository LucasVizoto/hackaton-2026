from django.urls import path

from analytics.views import LaborCostsView, OperationsView, StaffingScenarioView

urlpatterns = [
    path("operations/", OperationsView.as_view()),
    path("labor-costs/", LaborCostsView.as_view()),
    path("staffing-scenario/", StaffingScenarioView.as_view()),
]
