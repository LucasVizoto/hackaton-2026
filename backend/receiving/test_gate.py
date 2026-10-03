import base64

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import UserProfile

from .models import GateArrival

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class GateArrivalTests(TestCase):
    def setUp(self):
        self.gate = User.objects.create_user("portaria-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.gate, role="portaria")
        self.warehouse = User.objects.create_user("armazem-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.warehouse, role="warehouse")
        self.supplier = User.objects.create_user("fornecedor-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.supplier, role="supplier")
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
