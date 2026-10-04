import asyncio
from contextlib import suppress

from urllib.parse import parse_qs, unquote

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from rest_framework.authtoken.models import Token
from redis.exceptions import RedisError

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
    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        except RedisError:
            # Broker URLs and authentication material must not enter server logs.
            with suppress(Exception):
                await self.close(code=1013)
        finally:
            task = getattr(self, "heartbeat_task", None)
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    async def connect(self):
        self.heartbeat_enabled = parse_qs(self.scope.get("query_string", b"").decode()).get("stream_version") == ["2"]
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
        try:
            await asyncio.wait_for(self.subscribe(), timeout=5)
        except Exception:
            await self.close(code=1013)
            return
        await self.accept()
        self.heartbeat_task = asyncio.create_task(self.heartbeat())

    async def subscribe(self):
        for group in self.joined:
            await self.channel_layer.group_add(group, self.channel_name)

    async def heartbeat(self):
        try:
            while True:
                await asyncio.sleep(10)
                # Refresh memberships after a Redis restart and probe the broker.
                await asyncio.wait_for(self.subscribe(), timeout=5)
                if self.heartbeat_enabled:
                    await self.send_json({"event": "heartbeat"})
        except asyncio.CancelledError:
            raise
        except Exception:
            await self.close(code=1013)

    async def disconnect(self, code):
        task = getattr(self, "heartbeat_task", None)
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        for group in getattr(self, "joined", []):
            with suppress(Exception):
                await asyncio.wait_for(self.channel_layer.group_discard(group, self.channel_name), timeout=2)

    async def gate_event(self, event):
        await self.send_json(event["payload"])
