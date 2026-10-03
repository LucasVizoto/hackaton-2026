import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent
load_dotenv(REPO_DIR / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("Configure DJANGO_SECRET_KEY no ambiente ou no .env privado.")
DEBUG = os.environ.get("DJANGO_DEBUG", os.environ.get("DEBUG", "false")).lower() in {"true", "1"}
ALLOWED_HOSTS = [x.strip() for x in os.environ.get("DJANGO_ALLOWED_HOSTS", os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1")).split(",") if x.strip()]
INSTALLED_APPS = [
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
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True, "OPTIONS": {"context_processors": ["django.template.context_processors.request", "django.contrib.auth.context_processors.auth", "django.contrib.messages.context_processors.messages"]}}]
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.postgresql", "NAME": os.environ.get("DB_NAME", "cocapec"), "USER": os.environ.get("DB_USER", "cocapec"), "PASSWORD": os.environ.get("DB_PASSWORD", ""), "HOST": os.environ.get("DB_HOST", "127.0.0.1"), "PORT": os.environ.get("DB_PORT", "55433"), "CONN_MAX_AGE": 0}}
AUTH_PASSWORD_VALIDATORS = [{"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"}]
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
MEDIA_ROOT = Path(os.environ.get("PRIVATE_MEDIA_ROOT", str(REPO_DIR / ".private" / "media")))
PRIVATE_DATA_DIR = Path(os.environ.get("PRIVATE_DATA_DIR", str(REPO_DIR / ".private" / "sources")))
# There is deliberately no public MEDIA_URL route.
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
CORS_ALLOWED_ORIGINS = [x.strip() for x in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200,http://localhost,https://localhost,capacitor://localhost").split(",") if x.strip()]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["core.permissions.HasProfile"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 100,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "core.exceptions.exception_handler",
    "DEFAULT_THROTTLE_RATES": {"login": "20/minute"},
}
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
