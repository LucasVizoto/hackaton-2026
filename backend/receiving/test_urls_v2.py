from django.urls import include, path

urlpatterns = [
    path("api/v1/catalog/", include("catalog.urls")),
    path("api/v1/auth/", include("core.urls")),
    path("api/v1/", include("receiving.urls")),
    path("api/v2/", include("receiving.urls_v2")),
]
