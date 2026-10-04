from django.urls import path

from .views import (AssistantView, CapabilitiesView, InvoiceReadingView, OCROriginalView, OCRView, ReadinessView,
                    SignatureView, SupplierHistoryView, WeatherView)

urlpatterns = [
    path("integrations/capabilities/", CapabilitiesView.as_view()),
    path("integrations/assistant/", AssistantView.as_view()),
    path("integrations/weather/", WeatherView.as_view()),
    path("integrations/ocr/", OCRView.as_view()),
    path("integrations/invoice-reading/", InvoiceReadingView.as_view()),
    path("integrations/ocr/<uuid:pk>/original/", OCROriginalView.as_view()),
    path("warehouse-readiness/", ReadinessView.as_view()),
    path("appointments/<uuid:pk>/signatures/", SignatureView.as_view()),
    path("suppliers/<uuid:pk>/history/", SupplierHistoryView.as_view()),
]
