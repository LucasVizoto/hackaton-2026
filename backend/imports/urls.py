from django.urls import path

from .views import QualityView

urlpatterns = [path("quality/", QualityView.as_view())]
