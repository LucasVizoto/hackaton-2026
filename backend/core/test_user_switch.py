from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from catalog.models import Supplier
from core.models import UserProfile


class UserSwitchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.users = []
        for index, role in enumerate(["supplier", "supplier", "purchasing", "warehouse", "management", "portaria", "admin"]):
            user = User.objects.create_user(f"account-{index}")
            supplier = Supplier.objects.create(code=f"switch-{index}", name=f"Supplier {index}") if role == "supplier" else None
            UserProfile.objects.create(user=user, role=role, supplier=supplier)
            self.users.append(user)
        self.superuser = User.objects.create(username="superuser", is_superuser=True)
        self.inactive = User.objects.create(username="inactive", is_active=False)
        UserProfile.objects.create(user=self.inactive, role="warehouse")
        self.no_profile = User.objects.create(username="no-profile")
        self.source_token = Token.objects.create(user=self.users[0])
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.source_token.key}")

    def test_list_search_pagination_and_versions(self):
        response = self.client.get("/api/v2/auth/users/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 8)
        self.assertEqual([row["username"] for row in response.data["results"]], [u.username for u in self.users] + ["superuser"])
        self.assertEqual(self.client.get("/api/v2/auth/users/?search=ACCOUNT-1").data["count"], 1)
        self.assertEqual(self.client.get("/api/v2/auth/users/?search=absent").data["results"], [])
        self.assertEqual(response.data["results"][5]["role"], "gatehouse")
        self.assertEqual(self.client.get("/api/v1/auth/users/").data["results"][5]["role"], "portaria")
        User.objects.bulk_create([User(username=f"page-{i:03}", is_superuser=True) for i in range(101)])
        first = self.client.get("/api/v2/auth/users/")
        second = self.client.get("/api/v2/auth/users/?page=2")
        self.assertEqual(len(first.data["results"]), 100)
        self.assertEqual(len(second.data["results"]), 9)
        self.assertIsNotNone(first.data["next"])

    def test_every_role_can_switch_and_token_preserves_identity(self):
        for source in [*self.users, self.superuser]:
            token, _ = Token.objects.get_or_create(user=source)
            self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
            for target in [*self.users, self.superuser]:
                response = self.client.post("/api/v2/auth/switch/", {"user_id": target.pk}, format="json")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["user"]["id"], target.pk)
                self.assertEqual(Token.objects.get(key=response.data["token"]).user_id, target.pk)
            self.assertTrue(Token.objects.filter(pk=token.pk).exists())

    def test_supplier_scope_and_logout_follow_selected_user(self):
        target = self.users[1]
        response = self.client.post("/api/v2/auth/switch/", {"user_id": target.pk}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")
        self.assertEqual(self.client.get("/api/v2/auth/me/").data["id"], target.pk)
        suppliers = self.client.get("/api/v2/catalog/suppliers/").data["results"]
        self.assertEqual([row["id"] for row in suppliers], [str(target.profile.supplier_id)])
        self.assertEqual(self.client.get("/api/v2/catalog/workers/").status_code, 403)
        self.assertEqual(self.client.post("/api/v2/auth/logout/").status_code, 204)
        self.assertFalse(Token.objects.filter(user=target).exists())
        self.assertTrue(Token.objects.filter(user=self.users[0]).exists())

    def test_invalid_targets_and_anonymous_access(self):
        for value in [None, True, 0, -1, 1.5, "invalid", 10**30]:
            self.assertEqual(self.client.post("/api/v2/auth/switch/", {"user_id": value}, format="json").status_code, 400)
        for user_id in [999999, self.inactive.pk, self.no_profile.pk]:
            self.assertEqual(self.client.post("/api/v2/auth/switch/", {"user_id": user_id}, format="json").status_code, 404)
        self.client.credentials()
        self.assertEqual(self.client.get("/api/v2/auth/users/").status_code, 401)
        self.assertEqual(self.client.post("/api/v2/auth/switch/", {"user_id": self.users[0].pk}).status_code, 401)

    def test_v1_switch_uses_legacy_gatehouse_label(self):
        response = self.client.post("/api/v1/auth/switch/", {"user_id": self.users[5].pk})
        self.assertEqual(response.data["user"]["role"], "portaria")
