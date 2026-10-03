import io
import os
import tempfile
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import UserProfile


class AuthenticationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("login-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.user, role="warehouse")
        self.client = APIClient()

    def test_login_me_logout_revokes_token(self):
        login = self.client.post(
            "/api/v1/auth/login/",
            {"username": self.user.username, "password": "isolated-test-only-password"},
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.data["user"]["role"], "warehouse")
        self.client.credentials(HTTP_AUTHORIZATION="Token " + login.data["token"])
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        self.assertFalse(Token.objects.filter(user=self.user).exists())
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 401)

    def test_bad_password_and_no_profile_do_not_authenticate(self):
        self.assertEqual(
            self.client.post(
                "/api/v1/auth/login/", {"username": self.user.username, "password": "wrong"}
            ).status_code,
            401,
        )
        self.user.profile.delete()
        self.assertEqual(
            self.client.post(
                "/api/v1/auth/login/",
                {"username": self.user.username, "password": "isolated-test-only-password"},
            ).status_code,
            401,
        )

    def test_health_queries_real_postgresql(self):
        result = self.client.get("/api/v1/health/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["database"], "postgresql")

    def test_removed_profile_cannot_use_existing_token_for_catalog(self):
        token = Token.objects.create(user=self.user)
        self.user.profile.delete()
        self.client.credentials(HTTP_AUTHORIZATION="Token " + token.key)
        self.assertEqual(self.client.get("/api/v1/catalog/suppliers/").status_code, 403)


class SyntheticSeedTests(TestCase):
    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings = override_settings(
            MEDIA_ROOT=media.name,
            PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
        )
        settings.enable()
        self.addCleanup(settings.disable)
        password = patch.dict(os.environ, {"DEMO_PASSWORD": "synthetic-test-password-only"})
        password.start()
        self.addCleanup(password.stop)

    def seed(self):
        call_command("seed_demo", stdout=io.StringIO())

    def test_reproducible_half_day_example_and_repeat_preserve_existing_state(self):
        from labor.models import DailyBulletin
        from receiving.models import Appointment

        self.seed()
        bulletin = DailyBulletin.objects.get(
            warehouse__code="ADUBO", reference_date=date(2025, 11, 18)
        )
        self.assertEqual(bulletin.origin, "demo_sintetico")
        self.assertEqual(bulletin.status, "CLOSED")
        self.assertEqual(bulletin.participants.count(), 11)
        self.assertEqual(bulletin.participants.filter(fraction="0.5").count(), 1)
        self.assertEqual(Decimal(bulletin.calculation["production"]), Decimal("918.1952"))
        self.assertEqual(Decimal(bulletin.calculation["equivalent_days"]), Decimal("10.5"))
        self.assertEqual(Decimal(bulletin.calculation["total_payable"]), Decimal("946.81755"))
        self.assertEqual(Decimal(bulletin.calculation["supplement"]), Decimal("28.62235"))
        appointment = Appointment.objects.first()
        appointment.vehicle_plate = "SYN-EDITADO"
        appointment.save(update_fields=["vehicle_plate"])
        before = list(DailyBulletin.objects.order_by("pk").values())
        receipt = list(Appointment.objects.order_by("pk").values())
        self.seed()
        self.assertEqual(list(DailyBulletin.objects.order_by("pk").values()), before)
        self.assertEqual(list(Appointment.objects.order_by("pk").values()), receipt)

    def test_existing_operational_bulletin_is_not_relabelled_or_overwritten(self):
        from catalog.models import Warehouse
        from labor.models import DailyBulletin

        warehouse = Warehouse.objects.create(code="ADUBO", name="Local existente")
        user = User.objects.create_user("synthetic-seed-existing-operator")
        bulletin = DailyBulletin.objects.create(
            warehouse=warehouse, reference_date=date(2025, 11, 18),
            origin="operacional_registrado", created_by=user,
        )
        with self.assertRaises(CommandError):
            self.seed()
        bulletin.refresh_from_db()
        self.assertEqual(bulletin.origin, "operacional_registrado")
        self.assertEqual(bulletin.status, "DRAFT")
        self.assertEqual(DailyBulletin.objects.count(), 1)

    def test_existing_portaria_alias_is_preserved_by_repeat_seed(self):
        user = User.objects.create_user("portaria_demo")
        profile = UserProfile.objects.create(user=user, role="portaria")
        self.seed()
        self.seed()
        profile.refresh_from_db()
        self.assertEqual(profile.role, "portaria")
        self.assertEqual(User.objects.filter(username="portaria_demo").count(), 1)
