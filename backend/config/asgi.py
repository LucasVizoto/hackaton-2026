import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django_asgi = get_asgi_application()


def _websocket():
    from receiving.routing import websocket_urlpatterns

    return AllowedHostsOriginValidator(URLRouter(websocket_urlpatterns))


application = ProtocolTypeRouter(
    {
        "http": django_asgi,
        "websocket": _websocket(),
    }
)
