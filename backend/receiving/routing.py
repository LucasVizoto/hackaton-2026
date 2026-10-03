from django.urls import path

from .consumers import GateConsumer

websocket_urlpatterns = [path("ws/gate/", GateConsumer.as_asgi())]
