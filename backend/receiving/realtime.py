from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .serializers import GateArrivalSerializer


def notify_arrival(arrival, event):
    layer = get_channel_layer()
    if layer is None:
        return
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
    send = async_to_sync(layer.group_send)
    for group in groups:
        send(group, message)
