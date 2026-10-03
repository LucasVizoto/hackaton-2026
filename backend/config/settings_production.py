"""Settings for the supervised HTTPS deployment; local settings stay unchanged."""
# ruff: noqa: F403, F405
import os

from .settings import *

DEBUG = False
ALLOWED_HOSTS = ["cocapec.lucasvizoto.com", "localhost", "127.0.0.1"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 3600
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False
CSRF_TRUSTED_ORIGINS = ["https://cocapec.lucasvizoto.com"]
CORS_ALLOWED_ORIGINS = ["https://cocapec.lucasvizoto.com", "https://localhost"]
STATIC_ROOT = os.environ.get("STATIC_ROOT", "/srv/cocapec/shared/static")
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "cocapec_cache",
        "TIMEOUT": 60,
        "OPTIONS": {"MAX_ENTRIES": 10000},
    }
}
# Caddy sends exactly one validated client IP to the loopback-only backend.
REST_FRAMEWORK = {**REST_FRAMEWORK, "NUM_PROXIES": 1}
