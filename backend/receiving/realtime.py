import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from .serializers import GateArrivalSerializer

logger = logging.getLogger(__name__)


# Avisos internos que viram alerta em tempo real; o registro persistido continua sendo a fonte da verdade.
NOTIFICATION_GROUPS = {"purchasing": "gate-purchasing"}


def notify_arrival(arrival, event):
    message = {
        "type": "gate.event",
        "payload": {
            "event": event,
            "arrival": GateArrivalSerializer(arrival).data,
        },
    }
    groups = ["gate-warehouse"]
    if event in {"authorized", "rejected", "occurrence"}:
        groups.append(f"gate-user-{arrival.created_by_id}")
    # Compras recebe as ocorrências para decidir, as recusas e o desfecho das ocorrências que decidiu.
    if event in {"occurrence", "rejected"} or arrival.occurrence_at:
        groups.append("gate-purchasing")
    _publish_on_commit(groups, message, f"arrival={arrival.pk} event={event}")


def notify_internal(notification):
    group = NOTIFICATION_GROUPS.get(notification.recipient_role)
    if not group:
        return
    from .serializers_v2 import NotificationSerializer
    message = {"type": "gate.event", "payload": {"event": "notification", "notification": NotificationSerializer(notification).data}}
    _publish_on_commit([group], message, f"notification={notification.pk}")


def _publish_on_commit(groups, message, context):
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
            logger.warning("Gate notification unavailable; recover persisted state via API. %s", context)

    transaction.on_commit(publish)
