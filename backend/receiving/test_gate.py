import base64
import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.models import UserProfile

from .models import Appointment, GateArrival, GlobalSlot

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class GateArrivalTests(TestCase):
    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings = override_settings(
            MEDIA_ROOT=media.name,
            PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
        )
        settings.enable()
        self.addCleanup(settings.disable)
        self.gate = User.objects.create_user("portaria-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.gate, role="portaria")
        self.warehouse = User.objects.create_user("armazem-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.warehouse, role="warehouse")
        self.supplier = User.objects.create_user("fornecedor-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.supplier, role="supplier")
        self.purchasing = User.objects.create_user("compras-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.purchasing, role="purchasing")
        self.client = APIClient()

    def login(self, user):
        response = self.client.post(
            "/api/v1/auth/login/",
            {"username": user.username, "password": "isolated-test-only-password"},
        )
        self.client.credentials(HTTP_AUTHORIZATION="Token " + response.data["token"])

    def photo(self):
        return SimpleUploadedFile("nota.png", TINY_PNG, content_type="image/png")

    def test_gate_notifies_warehouse_with_plate_driver_and_invoice(self):
        self.login(self.gate)
        created = self.client.post(
            "/api/v1/gate-arrivals/",
            {
                "vehicle_plate": "abc1d23",
                "tractor_plate": "xyz9e87",
                "driver_name": "João da Silva",
                "invoice_number": "123.456",
                "file": self.photo(),
            },
            format="multipart",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["vehicle_plate"], "ABC1D23")
        self.assertEqual(created.data["tractor_plate"], "XYZ9E87")
        self.assertEqual(created.data["driver_name"], "João da Silva")
        self.assertEqual(created.data["invoice_number"], "123456")
        self.assertEqual(created.data["decision"], "pending")
        self.assertIsNone(created.data["seen_at"])

        self.login(self.warehouse)
        listing = self.client.get("/api/v1/gate-arrivals/")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data["unread"], 1)
        self.assertEqual(listing.data["results"][0]["invoice_number"], "123456")
        summary = self.client.get("/api/v1/gate-arrivals/?summary=1")
        self.assertEqual(summary.data["unread"], 1)
        image = self.client.get(f"/api/v1/gate-arrivals/{created.data['id']}/file/")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image["Content-Type"], "image/png")
        self.assertEqual(b"".join(image.streaming_content), TINY_PNG)
        seen = self.client.post(f"/api/v1/gate-arrivals/{created.data['id']}/seen/")
        self.assertEqual(seen.status_code, 200)
        self.assertIsNotNone(seen.data["seen_at"])
        self.assertEqual(GateArrival.objects.get().seen_by, self.warehouse)

    def test_other_roles_cannot_register_or_read_arrivals(self):
        self.login(self.supplier)
        denied = self.client.post(
            "/api/v1/gate-arrivals/",
            {
                "vehicle_plate": "ABC1D23",
                "tractor_plate": "XYZ9E87",
                "driver_name": "João da Silva",
                "invoice_number": "123456",
                "file": self.photo(),
            },
            format="multipart",
        )
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(self.client.get("/api/v1/gate-arrivals/").status_code, 403)

    def create_arrival(self, version="v2", **overrides):
        data = {
            "vehicle_plate": "ABC1D23", "tractor_plate": "XYZ9E87",
            "driver_name": "Motorista sintético", "invoice_number": "123456",
            "file": self.photo(), **overrides,
        }
        return self.client.post(f"/api/{version}/gate-arrivals/", data, format="multipart")

    def test_both_persisted_roles_have_versioned_auth_and_same_restricted_policy(self):
        for persisted_role in ("portaria", "gatehouse"):
            with self.subTest(role=persisted_role):
                self.gate.profile.role = persisted_role
                self.gate.profile.save(update_fields=["role"])
                self.client.force_authenticate(self.gate)
                for version, public_role in (("v1", "portaria"), ("v2", "gatehouse")):
                    self.assertEqual(self.client.get(f"/api/{version}/auth/me/").data["role"], public_role)
                    self.assertEqual(self.create_arrival(version).status_code, 201)
                    self.assertEqual(self.client.get(f"/api/{version}/bulletins/").status_code, 403)
                    self.assertEqual(self.client.get(f"/api/{version}/catalog/workers/").status_code, 403)
                self.assertEqual(self.client.get("/api/v2/purchase-orders/").status_code, 403)
        self.assertEqual(GateArrival.objects.count(), 4)
        self.assertEqual(Appointment.objects.count(), 0)
        self.assertEqual(GlobalSlot.objects.count(), 0)

    def test_gate_only_reads_own_notices_and_cannot_acknowledge_or_read_summary(self):
        self.client.force_authenticate(self.gate)
        created = self.create_arrival()
        self.assertEqual(created.status_code, 201)
        other = User.objects.create_user("other-gate")
        UserProfile.objects.create(user=other, role="gatehouse")
        self.client.force_authenticate(other)
        listing = self.client.get("/api/v2/gate-arrivals/")
        self.assertEqual(listing.data["count"], 0)
        self.assertEqual(listing.data["unread"], 0)
        url = f"/api/v2/gate-arrivals/{created.data['id']}"
        self.assertEqual(self.client.get(url + "/file/").status_code, 404)
        self.assertEqual(self.client.post(url + "/seen/").status_code, 403)
        self.assertEqual(self.client.get("/api/v2/gate-arrivals/?summary=1").status_code, 403)

    def test_invoice_number_does_not_silently_truncate_or_extract_typed_values(self):
        self.client.force_authenticate(self.gate)
        for number in ("0", "000000000", "abc123", "123.456", "1" * 10, "1" * 44, "１２３"):
            with self.subTest(number=number):
                response = self.create_arrival(invoice_number=number)
                self.assertEqual(response.status_code, 400)
                self.assertIn("invoice_number", response.data["error"]["details"])
        self.assertEqual(GateArrival.objects.count(), 0)
        for number in ("1", "999999999", "000123", "012345678"):
            created = self.create_arrival(invoice_number=number)
            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.data["invoice_number"], number)
        self.assertEqual(self.create_arrival("v1", invoice_number="abc123").status_code, 400)
        self.assertEqual(self.create_arrival("v1", invoice_number="1" * 44).status_code, 400)

    def test_content_type_is_sniffed_and_spoofed_active_content_is_rejected(self):
        self.client.force_authenticate(self.gate)
        for content in (b"<svg onload='alert(1)'/>", b"<html>active content</html>"):
            response = self.create_arrival(file=SimpleUploadedFile("fake.png", content, content_type="image/png"))
            self.assertEqual(response.status_code, 400)
        valid = self.create_arrival(file=SimpleUploadedFile("photo.bin", TINY_PNG, content_type="application/octet-stream"))
        self.assertEqual(valid.status_code, 201)
        response = self.client.get(f"/api/v2/gate-arrivals/{valid.data['id']}/file/")
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Content-Security-Policy"], "sandbox; default-src 'none'")
        self.assertEqual(b"".join(response.streaming_content), TINY_PNG)

    def test_management_reads_all_operators_without_seen_or_decision_privileges(self):
        self.client.force_authenticate(self.gate)
        first = self.create_arrival().data["id"]
        other = User.objects.create_user("gate-other")
        UserProfile.objects.create(user=other, role="gatehouse")
        self.client.force_authenticate(other)
        second = self.create_arrival().data["id"]
        GateArrival.objects.filter(pk=second).update(decision="rejected")
        for username in ("gestao_demo", "another-manager"):
            manager = User.objects.create_user(username)
            UserProfile.objects.create(user=manager, role="management")
            self.client.force_authenticate(manager)
            for version in ("v1", "v2"):
                base = f"/api/{version}/gate-arrivals/"
                response = self.client.get(base)
                self.assertEqual(response.status_code, 200)
                self.assertEqual({r["id"] for r in response.data["results"]}, {first, second})
                self.assertEqual(self.client.get(base + "?summary=1").status_code, 200)
                self.assertEqual([r["id"] for r in self.client.get(base + "?decision=rejected").data["results"]], [second])
                photo = self.client.get(base + first + "/file/")
                self.assertEqual(photo.status_code, 200)
                self.assertEqual(b"".join(photo.streaming_content), TINY_PNG)
                self.assertEqual(self.client.post(base + first + "/seen/", {}).status_code, 403)
                self.assertEqual(self.client.post(base + first + "/decision/", {"decision": "authorized"}).status_code, 403)
                self.assertEqual(self.create_arrival(version).status_code, 403)
        self.assertEqual(GateArrival.objects.count(), 2)
        self.assertFalse(GateArrival.objects.filter(seen_at__isnull=False).exists())
        self.assertEqual(GateArrival.objects.get(pk=first).decision, "pending")

    def test_pagination_counts_all_unread_and_seen_is_idempotent(self):
        GateArrival.objects.bulk_create([
            GateArrival(vehicle_plate="ABC1D23", tractor_plate="XYZ9E87",
                        driver_name="Sintético", invoice_number=str(index + 1),
                        file="synthetic.png", created_by=self.gate)
            for index in range(51)
        ])
        self.client.force_authenticate(self.warehouse)
        first = self.client.get("/api/v2/gate-arrivals/")
        self.assertEqual(first.data["count"], 51)
        self.assertEqual(first.data["unread"], 51)
        self.assertEqual(len(first.data["results"]), 50)
        second = self.client.get(first.data["next"])
        self.assertEqual(len(second.data["results"]), 1)
        self.assertNotEqual(first.data["results"][0]["id"], second.data["results"][0]["id"])
        url = f"/api/v2/gate-arrivals/{first.data['results'][0]['id']}/seen/"
        seen = self.client.post(url)
        other = User.objects.create_user("other-warehouse")
        UserProfile.objects.create(user=other, role="warehouse")
        self.client.force_authenticate(other)
        repeated = self.client.post(url)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.data["seen_at"], seen.data["seen_at"])
        self.assertEqual(GateArrival.objects.get(id=seen.data["id"]).seen_by, self.warehouse)
        self.assertEqual(self.client.get("/api/v2/gate-arrivals/?summary=1").data["unread"], 50)

    def test_agenda_filters_arrivals_by_local_date(self):
        old, today = GateArrival.objects.bulk_create([
            GateArrival(vehicle_plate=plate, tractor_plate=plate, driver_name="Sintético",
                        invoice_number="1", file="synthetic.png", created_by=self.gate)
            for plate in ("OLD1A23", "NEW1A23")
        ])
        # 02:00 UTC ainda é o dia anterior em São Paulo.
        GateArrival.objects.filter(pk=old.pk).update(created_at="2026-10-02T02:00:00Z")
        GateArrival.objects.filter(pk=today.pk).update(created_at="2026-10-02T15:00:00Z")
        self.client.force_authenticate(self.warehouse)
        listing = self.client.get("/api/v2/gate-arrivals/?date_from=2026-10-02&date_to=2026-10-02")
        self.assertEqual([row["vehicle_plate"] for row in listing.data["results"]], ["NEW1A23"])
        self.assertEqual(self.client.get("/api/v2/gate-arrivals/?date_from=2026-13-01").status_code, 400)

    def test_accept_authorizes_and_reject_goes_to_purchasing(self):
        self.login(self.gate)
        created = self.create_arrival("v1", driver_name="João da Silva")
        self.assertEqual(created.status_code, 201)
        arrival_id = created.data["id"]
        self.login(self.purchasing)
        self.assertEqual(self.client.get("/api/v1/gate-arrivals/").data["results"], [])

        self.login(self.warehouse)
        accepted = self.client.post(
            f"/api/v1/gate-arrivals/{arrival_id}/decision/",
            {"decision": "authorized"},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.data["decision"], "authorized")
        repeated = self.client.post(
            f"/api/v1/gate-arrivals/{arrival_id}/decision/",
            {"decision": "rejected"},
            format="json",
        )
        self.assertEqual(repeated.status_code, 400)

        self.login(self.gate)
        second = self.create_arrival("v1", driver_name="João da Silva")
        self.assertEqual(second.status_code, 201)
        second_id = second.data["id"]
        self.login(self.warehouse)
        rejected = self.client.post(
            f"/api/v1/gate-arrivals/{second_id}/decision/",
            {"decision": "rejected"},
            format="json",
        )
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.data["decision"], "rejected")

        self.login(self.purchasing)
        review = self.client.get("/api/v1/gate-arrivals/")
        self.assertEqual(review.status_code, 200)
        self.assertEqual([item["id"] for item in review.data["results"]], [second_id])
        self.assertEqual(review.data["unread"], 1)
        image = self.client.get(f"/api/v1/gate-arrivals/{second_id}/file/")
        self.assertEqual(image.status_code, 200)
        self.assertEqual(b"".join(image.streaming_content), TINY_PNG)
        hidden = self.client.get(f"/api/v1/gate-arrivals/{arrival_id}/file/")
        self.assertEqual(hidden.status_code, 404)

        self.login(self.gate)
        own = self.client.get("/api/v1/gate-arrivals/")
        decisions = {item["id"]: item["decision"] for item in own.data["results"]}
        self.assertEqual(decisions[arrival_id], "authorized")
        self.assertEqual(decisions[second_id], "rejected")
        waiting = self.client.get("/api/v1/gate-arrivals/?decision=pending")
        self.assertEqual(waiting.data["results"], [])
        self.assertEqual(waiting.data["count"], 0)

    def test_portaria_socket_receives_the_decision(self):
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        from channels.testing import WebsocketCommunicator
        from rest_framework.authtoken.models import Token

        from config.asgi import application

        token = Token.objects.create(user=self.gate)

        async def receive():
            communicator = WebsocketCommunicator(
                application,
                f"/ws/gate/?token={token.key}",
                headers=[(b"origin", b"http://localhost")],
            )
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            await get_channel_layer().group_send(
                f"gate-user-{self.gate.id}",
                {"type": "gate.event", "payload": {"event": "authorized", "arrival": {"driver_name": "João da Silva"}}},
            )
            message = await communicator.receive_json_from()
            await communicator.disconnect()
            return message

        message = async_to_sync(receive)()
        self.assertEqual(message["event"], "authorized")
        self.assertEqual(message["arrival"]["driver_name"], "João da Silva")
