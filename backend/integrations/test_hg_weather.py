from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from core.models import UserProfile
from integrations.providers import ProviderUnavailable


class HgWeatherTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user = User.objects.create_user("supplier-weather")
        UserProfile.objects.create(user=user, role="supplier")
        self.client.force_authenticate(user)

    @patch("integrations.views.json_request")
    def test_day_five_comes_from_open_meteo(self, json_request):
        json_request.return_value = {"daily": {
            "time": ["2026-10-05"],
            "weather_code": [81],
            "precipitation_sum": [6.7],
            "precipitation_probability_max": [73],
        }}
        response = self.client.get("/api/v2/integrations/hg-weather/", {"date": "2026-10-05"})
        self.assertEqual(response.status_code, 200)
        called = json_request.call_args.args[0]
        self.assertIn("https://api.open-meteo.com/v1/forecast?", called)
        self.assertIn("latitude=-22.1908", called)
        self.assertIn("start_date=2026-10-05", called)
        self.assertIn("end_date=2026-10-05", called)
        forecast = response.data["results"]["forecast"]
        self.assertEqual(len(forecast), 1)
        self.assertEqual(forecast[0]["full_date"], "05/10/2026")
        self.assertEqual(forecast[0]["condition"], "rain")

    @patch("integrations.views.json_request", side_effect=ProviderUnavailable("http_429"))
    def test_rate_limit_stays_a_client_fallback(self, _json_request):
        response = self.client.get("/api/v2/integrations/hg-weather/", {"date": "2026-10-05"})
        self.assertEqual(response.status_code, 429)

    @patch("integrations.views.json_request", side_effect=ProviderUnavailable("http_503"))
    def test_upstream_outage_stays_a_client_fallback(self, _json_request):
        response = self.client.get("/api/v2/integrations/hg-weather/", {"date": "2026-10-05"})
        self.assertEqual(response.status_code, 503)

    def test_invalid_date_does_not_call_the_provider(self):
        response = self.client.get("/api/v2/integrations/hg-weather/", {"date": "05/10/2026"})
        self.assertEqual(response.status_code, 400)
