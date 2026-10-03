from django.urls import include, path

from core.views import HealthView

urlpatterns = [
    path("api/v1/health/", HealthView.as_view()),
    path("api/v1/auth/", include("core.urls")),
    path("api/v1/catalog/", include("catalog.urls")),
    path("api/v1/", include("receiving.urls")),
    path("api/v1/", include("labor.urls")),
    path("api/v1/analytics/", include("analytics.urls")),
    path("api/v1/data/", include("imports.urls")),
]
