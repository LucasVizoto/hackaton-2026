from urllib.parse import parse_qs, unquote

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from rest_framework.authtoken.models import Token

from core.permissions import user_role


def token_from_scope(scope):
    query = parse_qs(scope.get("query_string", b"").decode())
    if query.get("token"):
        return unquote(query["token"][0])
    for name, value in scope.get("headers", []):
        if name.lower() != b"cookie":
            continue
        for part in value.decode().split(";"):
            key, _, raw = part.strip().partition("=")
            if key == "cocapec_session" and raw:
                return unquote(raw)
    return ""


@database_sync_to_async
def user_from_key(key):
    if not key:
        return None
    try:
        token = Token.objects.select_related("user__profile").get(key=key)
    except Token.DoesNotExist:
        return None
    if not token.user.is_active:
        return None
    return token.user


class GateConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = await user_from_key(token_from_scope(self.scope))
        role = await database_sync_to_async(user_role)(user) if user else ""
        self.joined = []
        if role in {"warehouse", "admin"}:
            self.joined.append("gate-warehouse")
        elif role == "gatehouse":
            self.joined.append(f"gate-user-{user.id}")
        elif role == "purchasing":
            self.joined.append("gate-purchasing")
        if not self.joined:
            await self.close()
            return
        for group in self.joined:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        for group in getattr(self, "joined", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def gate_event(self, event):
        await self.send_json(event["payload"])
