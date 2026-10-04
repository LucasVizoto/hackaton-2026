import json
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent
load_dotenv(REPO_DIR / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Configure DJANGO_SECRET_KEY no ambiente ou no .env privado.")
DEBUG = os.environ.get("DJANGO_DEBUG", os.environ.get("DEBUG", "false")).lower() in {"true", "1"}
ALLOWED_HOSTS = [
    x.strip()
    for x in os.environ.get(
        "DJANGO_ALLOWED_HOSTS", os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1")
    ).split(",")
    if x.strip()
]
INSTALLED_APPS = [
    "daphne",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "core",
    "catalog",
    "receiving",
    "labor",
    "analytics",
    "imports",
    "integrations",
    "channels",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
REDIS_URL = os.environ.get("REDIS_URL", "")
CHANNEL_LAYERS = {"default": {
    "BACKEND": "channels_redis.core.RedisChannelLayer",
    "CONFIG": {"hosts": [{"address": REDIS_URL, "socket_timeout": 10, "socket_connect_timeout": 2}], "prefix": "cocapec", "capacity": 100, "expiry": 60},
}} if REDIS_URL else {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
WEBSOCKET_ALLOWED_ORIGINS = [origin.strip() for origin in os.environ.get(
    "WEBSOCKET_ALLOWED_ORIGINS",
    "http://localhost,https://localhost,http://localhost:4200,http://127.0.0.1:4200",
).split(",") if origin.strip()]
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "cocapec"),
        "USER": os.environ.get("DB_USER", "cocapec"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "127.0.0.1"),
        "PORT": os.environ.get("DB_PORT", "55433"),
        "CONN_MAX_AGE": 0,
    }
}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"}
]
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
MEDIA_ROOT = Path(
    os.environ.get("PRIVATE_MEDIA_ROOT")
    or os.environ.get("MEDIA_ROOT")
    or str(REPO_DIR / ".private" / "media")
)
if not MEDIA_ROOT.is_absolute():
    MEDIA_ROOT = REPO_DIR / MEDIA_ROOT
PRIVATE_DATA_DIR = Path(
    os.environ.get("PRIVATE_DATA_DIR") or str(REPO_DIR / ".private" / "sources")
)
# There is deliberately no public MEDIA_URL route.
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
CORS_ALLOWED_ORIGINS = [
    x.strip()
    for x in os.environ.get(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:4200,http://127.0.0.1:4200,http://localhost,https://localhost,capacitor://localhost",
    ).split(",")
    if x.strip()
]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["core.permissions.HasProfile"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 100,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "core.exceptions.exception_handler",
    "DEFAULT_THROTTLE_RATES": {"login": "20/minute", "assistant": "10/hour",
                               "invoice_reading": os.environ.get("OPENAI_INVOICE_READING_RATE", "10/minute")},
}
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# Optional providers remain off until configured and the operational workflow is accepted.
OPTIONAL_INTEGRATIONS_ENABLED = os.environ.get("OPTIONAL_INTEGRATIONS_ENABLED", "false").lower() == "true"
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "")
OPENAI_VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "")
OPENAI_INVOICE_READING_ENABLED = os.environ.get("OPENAI_INVOICE_READING_ENABLED", "false").lower() == "true"
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "true").lower() == "true"
EMAIL_TIMEOUT = 30
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "")
DIGEST_EMAIL_RECIPIENTS = [item.strip() for item in os.environ.get("DIGEST_EMAIL_RECIPIENTS", "").split(",") if item.strip()]
try:
    NOTIFICATION_EMAIL_RECIPIENTS = json.loads(os.environ.get("NOTIFICATION_EMAIL_RECIPIENTS", "{}"))
except (ValueError, TypeError) as error:
    raise ImproperlyConfigured("NOTIFICATION_EMAIL_RECIPIENTS deve ser um objeto JSON por perfil.") from error
if not isinstance(NOTIFICATION_EMAIL_RECIPIENTS, dict) or any(
    role not in {"warehouse", "purchasing", "gatehouse"}
    or not isinstance(recipients, list)
    or any(not isinstance(address, str) or not address.strip() for address in recipients)
    for role, recipients in NOTIFICATION_EMAIL_RECIPIENTS.items()
):
    raise ImproperlyConfigured("NOTIFICATION_EMAIL_RECIPIENTS exige listas de endereços para perfis operacionais.")
GOOGLE_CALENDAR_ID = os.environ.get("GOOGLE_CALENDAR_ID", "")
GOOGLE_CALENDAR_ACCESS_TOKEN = os.environ.get("GOOGLE_CALENDAR_ACCESS_TOKEN", "")
WHATSAPP_TOKEN = os.environ.get("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_ID = os.environ.get("WHATSAPP_PHONE_ID", "")
WHATSAPP_API_VERSION = os.environ.get("WHATSAPP_API_VERSION", "")
WHATSAPP_TEMPLATE = os.environ.get("WHATSAPP_TEMPLATE", "")
WHATSAPP_TEMPLATE_LANGUAGE = os.environ.get("WHATSAPP_TEMPLATE_LANGUAGE", "pt_BR")
WHATSAPP_RECIPIENTS = [item.strip() for item in os.environ.get("WHATSAPP_RECIPIENTS", "").split(",") if item.strip()]
WEATHER_LATITUDE = os.environ.get("WEATHER_LATITUDE")
WEATHER_LONGITUDE = os.environ.get("WEATHER_LONGITUDE")
HGBRASIL_WEATHER_KEY = os.environ.get("HGBRASIL_WEATHER_KEY", "")
HGBRASIL_WOEID = os.environ.get("HGBRASIL_WOEID", "431819")
