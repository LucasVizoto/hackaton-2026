from django.urls import include, path

from core.views import HealthView

urlpatterns = [
    path("api/v2/health/", HealthView.as_view()),
    path("api/v2/auth/", include("core.urls")),
    path("api/v2/catalog/", include("catalog.urls")),
    path("api/v2/", include("receiving.urls_v2")),
    path("api/v2/", include("labor.urls_v2")),
    path("api/v2/analytics/", include("analytics.urls_v2")),
    path("api/v2/", include("integrations.urls")),
    path("api/v2/data/", include("imports.urls")),
    path("api/v1/health/", HealthView.as_view()),
    path("api/v1/auth/", include("core.urls")),
    path("api/v1/catalog/", include("catalog.urls")),
    path("api/v1/", include("receiving.urls")),
    path("api/v1/", include("labor.urls")),
    path("api/v1/analytics/", include("analytics.urls")),
    path("api/v1/data/", include("imports.urls")),
]
