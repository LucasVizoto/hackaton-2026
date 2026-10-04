import tempfile
from types import SimpleNamespace

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.models import UserProfile
from integrations.models import DocumentSuggestion
from labor.tests import labor_fixtures, stored_bulletin
from receiving.models import InternalNotification
from receiving.tests import fixtures, DAY
from receiving import workflow


class ManagementReadTests(TestCase):
    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings = override_settings(MEDIA_ROOT=media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        fixtures(self)
        self.labor = SimpleNamespace()
        labor_fixtures(self.labor)
        self.bulletin = stored_bulletin(self.labor)
        self.appointment = workflow.create(self.external, {
            "invoice_ids": [self.invoice], "date": DAY, "time": "08:00",
            "packaging": "paletizada", "vehicle_plate": "SYN1234",
        })
        self.notifications = [InternalNotification.objects.create(
            appointment=self.appointment, recipient_role=role, kind="test", message="Sintético",
            dedupe_key=f"manager-read-{role}",
        ) for role in ("warehouse", "purchasing", "gatehouse")]
        self.document = DocumentSuggestion.objects.create(
            file=ContentFile(b"synthetic-image", name="synthetic.png"), original_name="synthetic.png",
            sha256="a" * 64, media_type="image/png", suggestion="Número sintético 123",
            status="completed", created_by=self.operator,
        )
        self.client = APIClient()

    def test_two_management_users_read_modules_and_documents_but_cannot_operate(self):
        for name in ("gestao_demo", "management-independent-name"):
            user = User.objects.create_user(name)
            UserProfile.objects.create(user=user, role="management")
            self.client.force_authenticate(user)
            for version in ("v1", "v2"):
                prefix = f"/api/{version}/"
                for path in ("appointments/", f"appointments/{self.appointment.pk}/", "invoices/",
                             "warehouse-visits/", "non-receipts/", "bulletins/", f"bulletins/{self.bulletin.pk}/",
                             "catalog/workers/", "catalog/service-rates/", "catalog/suppliers/",
                             "catalog/equipment/", "catalog/warehouses/"):
                    with self.subTest(user=name, version=version, path=path):
                        expected = 409 if version == "v1" and path == f"appointments/{self.appointment.pk}/" else 200
                        self.assertEqual(self.client.get(prefix + path).status_code, expected)
                for path in ("non-receipts/", "bulletins/",
                             f"bulletins/{self.bulletin.pk}/close/", f"bulletins/{self.bulletin.pk}/reopen/"):
                    with self.subTest(write=path, user=name, version=version):
                        self.assertEqual(self.client.post(prefix + path, {}, format="json").status_code, 403)
                booking = {"invoice_ids": [str(self.invoice.pk)], "invoice": str(self.invoice.pk),
                           "supplier": str(self.supplier.pk), "date": str(DAY), "time": "10:00",
                           "packaging": "paletizada", "vehicle_plate": "SYN1234"}
                self.assertEqual(self.client.post(prefix + "appointments/", booking, format="json").status_code, 403)
            for path in ("purchase-orders/", "labor-activities/", "labor-rule-occurrences/", "production-records/",
                         f"bulletins/{self.bulletin.pk}/history/", "warehouse-readiness/",
                         f"appointments/{self.appointment.pk}/signatures/"):
                self.assertEqual(self.client.get("/api/v2/" + path).status_code, 200, path)
            notifications = self.client.get("/api/v2/notifications/")
            self.assertEqual(notifications.status_code, 200)
            self.assertTrue({str(n.pk) for n in self.notifications}.issubset({n["id"] for n in notifications.data["results"]}))
            for notification in self.notifications:
                self.assertEqual(self.client.post(f"/api/v2/notifications/{notification.pk}/acknowledge/", {}).status_code, 403)
            documents = self.client.get("/api/v2/integrations/ocr/")
            self.assertEqual(documents.status_code, 200)
            self.assertEqual(documents.data["results"][0]["id"], str(self.document.pk))
            original = self.client.get(f"/api/v2/integrations/ocr/{self.document.pk}/original/")
            self.assertEqual(original.status_code, 200)
            self.assertEqual(b"".join(original.streaming_content), b"synthetic-image")
            self.assertEqual(self.client.post("/api/v2/integrations/ocr/", {}).status_code, 403)
        self.assertFalse(InternalNotification.objects.filter(acknowledged_at__isnull=False).exists())
        self.appointment.refresh_from_db()
        self.assertEqual(self.appointment.revision, 1)
        self.bulletin.refresh_from_db()
        self.assertEqual(self.bulletin.status, "DRAFT")

    def test_new_ocr_list_does_not_extend_supplier_access(self):
        self.client.force_authenticate(self.external)
        self.assertEqual(self.client.get("/api/v2/integrations/ocr/").status_code, 403)
        self.assertEqual(self.client.get(f"/api/v2/integrations/ocr/{self.document.pk}/original/").status_code, 403)
