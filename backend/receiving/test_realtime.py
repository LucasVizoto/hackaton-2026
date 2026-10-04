import asyncio
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.db import close_old_connections, transaction
from django.test import TransactionTestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from core.models import UserProfile
from .models import GateArrival
from .realtime import notify_arrival


class GateRealtimeTests(TransactionTestCase):
    def setUp(self):
        self.gate = User.objects.create_user("gate-realtime")
        UserProfile.objects.create(user=self.gate, role="portaria")
        self.warehouse = User.objects.create_user("warehouse-realtime")
        UserProfile.objects.create(user=self.warehouse, role="warehouse")
        self.token = Token.objects.create(user=self.gate).key
        self.arrival = GateArrival.objects.create(
            vehicle_plate="ABC1D23", tractor_plate="XYZ9E87", driver_name="Synthetic realtime",
            invoice_number="123", file="synthetic.png", created_by=self.gate,
        )

    def test_notification_waits_for_commit_and_is_discarded_on_rollback(self):
        with patch("receiving.realtime.get_channel_layer") as layer:
            layer.return_value.group_send = AsyncMock()
            with self.assertRaises(ValueError), transaction.atomic():
                notify_arrival(self.arrival, "created")
                layer.assert_not_called()
                raise ValueError("rollback")
            layer.assert_not_called()
            with transaction.atomic():
                notify_arrival(self.arrival, "created")
                layer.assert_not_called()
            layer.assert_called_once()

    def test_broker_failure_does_not_undo_decision(self):
        client = APIClient()
        client.force_authenticate(self.warehouse)
        with patch("receiving.realtime.get_channel_layer", side_effect=ConnectionError), self.assertLogs("receiving.realtime", level="WARNING"):
            result = client.post(f"/api/v2/gate-arrivals/{self.arrival.pk}/decision/", {"decision": "authorized"})
        self.assertEqual(result.status_code, 200)
        self.arrival.refresh_from_db()
        self.assertEqual(self.arrival.decision, "authorized")

    def test_concurrent_opposing_decisions_have_one_winner(self):
        barrier = Barrier(2)

        def decide(value):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(pk=self.warehouse.pk))
                barrier.wait(timeout=10)
                return client.post(f"/api/v2/gate-arrivals/{self.arrival.pk}/decision/", {"decision": value}).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(decide, ["authorized", "rejected"]))
        self.assertEqual(sorted(statuses), [200, 400])
        self.arrival.refresh_from_db()
        self.assertIsNotNone(self.arrival.decided_at)
        self.assertEqual(self.arrival.decided_by_id, self.warehouse.pk)

    def test_socket_authentication_origins_and_profile_isolation(self):
        from config.asgi import application
        supplier = User.objects.create_user("supplier-realtime")
        UserProfile.objects.create(user=supplier, role="supplier")
        supplier_token = Token.objects.create(user=supplier).key

        async def check():
            for key, origin, allowed in [(self.token, b"http://localhost", True),
                                         (self.token, b"https://localhost", True),
                                         (self.token, b"https://untrusted.invalid", False),
                                         ("invalid", b"http://localhost", False),
                                         (supplier_token, b"http://localhost", False)]:
                socket = WebsocketCommunicator(application, f"/ws/gate/?token={key}", headers=[(b"origin", origin)])
                connected, _ = await socket.connect()
                self.assertEqual(connected, allowed)
                await socket.disconnect()
        async_to_sync(check)()

    @override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
    def test_management_receives_all_arrivals_without_mutating_decisions(self):
        from config.asgi import application
        tokens = []
        for name in ("gestao_demo", "management-realtime-other"):
            user = User.objects.create_user(name)
            UserProfile.objects.create(user=user, role="management")
            tokens.append(Token.objects.create(user=user).key)

        async def check():
            from channels.layers import get_channel_layer
            sockets = []
            try:
                for key in tokens:
                    socket = WebsocketCommunicator(application, f"/ws/gate/?token={key}", headers=[(b"origin", b"http://localhost")])
                    self.assertTrue((await socket.connect())[0])
                    sockets.append(socket)
                for event in ("created", "authorized", "rejected"):
                    await get_channel_layer().group_send("gate-warehouse", {
                        "type": "gate.event", "payload": {"event": event, "arrival": {"id": str(self.arrival.pk)}},
                    })
                    for socket in sockets:
                        self.assertEqual((await socket.receive_json_from())["event"], event)
            finally:
                for socket in sockets:
                    await socket.disconnect()
        async_to_sync(check)()
        self.arrival.refresh_from_db()
        self.assertEqual(self.arrival.decision, "pending")
        self.assertIsNone(self.arrival.seen_at)

    def test_redis_delivers_from_a_separate_process(self):
        url = os.environ.get("TEST_REDIS_URL")
        if not url:
            self.skipTest("Set TEST_REDIS_URL to run cross-process Redis acceptance.")
        from config.asgi import application
        config = {"default": {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [{"address": url, "socket_timeout": 10, "socket_connect_timeout": 2}], "prefix": "cocapec-test"}}}

        async def check():
            socket = WebsocketCommunicator(application, f"/ws/gate/?token={self.token}&stream_version=2", headers=[(b"origin", b"http://localhost")])
            connected, _ = await socket.connect()
            self.assertTrue(connected)
            self.assertEqual((await socket.receive_json_from(timeout=15))["event"], "heartbeat")
            code = "import asyncio,os; from channels_redis.core import RedisChannelLayer; layer=RedisChannelLayer(hosts=[os.environ['TEST_REDIS_URL']],prefix='cocapec-test'); asyncio.run(layer.group_send(os.environ['TEST_GROUP'],{'type':'gate.event','payload':{'event':'authorized','arrival':{'id':'separate-process'}}}))"
            env = {**os.environ, "TEST_GROUP": f"gate-user-{self.gate.pk}"}
            await asyncio.to_thread(subprocess.run, [sys.executable, "-c", code], env=env, check=True, capture_output=True)
            message = await socket.receive_json_from(timeout=5)
            self.assertEqual(message["arrival"]["id"], "separate-process")
            await socket.disconnect()

        with override_settings(CHANNEL_LAYERS=config):
            async_to_sync(check)()

    def test_legacy_sockets_do_not_receive_unknown_heartbeat_frames(self):
        from config.asgi import application

        async def check():
            socket = WebsocketCommunicator(application, f"/ws/gate/?token={self.token}", headers=[(b"origin", b"http://localhost")])
            self.assertTrue((await socket.connect())[0])
            self.assertTrue(await socket.receive_nothing(timeout=11))
            await socket.disconnect()

        async_to_sync(check)()
