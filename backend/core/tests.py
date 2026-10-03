from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import UserProfile


class AuthenticationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("login-test", password="isolated-test-only-password")
        UserProfile.objects.create(user=self.user, role="warehouse")
        self.client = APIClient()

    def test_login_me_logout_revokes_token(self):
        login = self.client.post("/api/v1/auth/login/", {"username": self.user.username, "password": "isolated-test-only-password"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.data["user"]["role"], "warehouse")
        self.client.credentials(HTTP_AUTHORIZATION="Token " + login.data["token"])
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        self.assertFalse(Token.objects.filter(user=self.user).exists())
        self.assertEqual(self.client.get("/api/v1/auth/me/").status_code, 401)

    def test_bad_password_and_no_profile_do_not_authenticate(self):
        self.assertEqual(self.client.post("/api/v1/auth/login/", {"username": self.user.username, "password": "wrong"}).status_code, 401)
        self.user.profile.delete()
        self.assertEqual(self.client.post("/api/v1/auth/login/", {"username": self.user.username, "password": "isolated-test-only-password"}).status_code, 401)

    def test_health_queries_real_postgresql(self):
        result = self.client.get("/api/v1/health/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["database"], "postgresql")

    def test_removed_profile_cannot_use_existing_token_for_catalog(self):
        token = Token.objects.create(user=self.user)
        self.user.profile.delete()
        self.client.credentials(HTTP_AUTHORIZATION="Token " + token.key)
        self.assertEqual(self.client.get("/api/v1/catalog/suppliers/").status_code, 403)
