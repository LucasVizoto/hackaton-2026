from importlib import import_module
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings
from django.middleware.security import SecurityMiddleware


class ProductionProxyTests(SimpleTestCase):
    def setUp(self):
        with patch.dict("os.environ", {"REDIS_URL": "redis://127.0.0.1:56479/0"}):
            self.config = import_module("config.settings_production")

    def test_separate_settings_keep_debug_off_and_exact_origins(self):
        self.assertFalse(self.config.DEBUG)
        self.assertNotIn("*", self.config.ALLOWED_HOSTS)
        self.assertEqual(
            self.config.CORS_ALLOWED_ORIGINS,
            ["https://cocapec.lucasvizoto.com", "https://localhost"],
        )
        self.assertEqual(self.config.REST_FRAMEWORK["NUM_PROXIES"], 1)
        self.assertEqual(self.config.CACHES["default"]["BACKEND"],
                         "django.core.cache.backends.db.DatabaseCache")

    @override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_PROXY_SSL_HEADER=("HTTP_X_FORWARDED_PROTO", "https"),
        ALLOWED_HOSTS=["cocapec.lucasvizoto.com"],
    )
    def test_sanitized_https_proxy_does_not_redirect_in_a_loop(self):
        request = RequestFactory().get(
            "/api/v1/health/", HTTP_HOST="cocapec.lucasvizoto.com",
            HTTP_X_FORWARDED_PROTO="https",
        )
        self.assertTrue(request.is_secure())
        self.assertIsNone(SecurityMiddleware(lambda req: None).process_request(request))

    @override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_PROXY_SSL_HEADER=("HTTP_X_FORWARDED_PROTO", "https"),
        ALLOWED_HOSTS=["cocapec.lucasvizoto.com"],
    )
    def test_plain_http_redirects_to_same_https_path(self):
        request = RequestFactory().get(
            "/api/v1/health/", HTTP_HOST="cocapec.lucasvizoto.com",
        )
        response = SecurityMiddleware(lambda req: None).process_request(request)
        self.assertEqual(response.status_code, 301)
        self.assertEqual(response["Location"],
                         "https://cocapec.lucasvizoto.com/api/v1/health/")
