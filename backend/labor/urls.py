from django.urls import path

from labor.views import (
    BulletinCloseView,
    BulletinDetailView,
    BulletinListView,
    BulletinPreviewView,
    BulletinReopenView,
    RatesView,
)

urlpatterns = [
    path("catalog/service-rates/", RatesView.as_view()),
    path("bulletins/", BulletinListView.as_view()),
    path("bulletins/preview/", BulletinPreviewView.as_view()),
    path("bulletins/<uuid:pk>/", BulletinDetailView.as_view()),
    path("bulletins/<uuid:pk>/close/", BulletinCloseView.as_view()),
    path("bulletins/<uuid:pk>/reopen/", BulletinReopenView.as_view()),
]
