import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from .serializers import GateArrivalSerializer

logger = logging.getLogger(__name__)


def notify_arrival(arrival, event):
    message = {
        "type": "gate.event",
        "payload": {
            "event": event,
            "arrival": GateArrivalSerializer(arrival).data,
        },
    }
    groups = ["gate-warehouse"]
    if event in {"authorized", "rejected"}:
        groups.append(f"gate-user-{arrival.created_by_id}")
    if event == "rejected":
        groups.append("gate-purchasing")
    def publish():
        try:
            layer = get_channel_layer()
            if layer is None:
                raise RuntimeError("Channel layer unavailable")
            send = async_to_sync(layer.group_send)
            for group in groups:
                send(group, message)
        except Exception:
            # Never expose connection URLs/tokens or undo a persisted decision.
            logger.warning("Gate notification unavailable; recover persisted state via API. arrival=%s event=%s", arrival.pk, event)

    transaction.on_commit(publish)
