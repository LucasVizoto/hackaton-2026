"""Check new runtime dependencies before interrupting the active release."""
import os
import sys
from pathlib import Path

import django
from dotenv import load_dotenv
from redis import Redis
from redis.exceptions import RedisError

root = Path(__file__).resolve().parent.parent
load_dotenv(root / ".env")
sys.path.insert(0, str(root / "backend"))
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_production"

django.setup()
from config.asgi import application  # noqa: E402,F401
try:
    with Redis.from_url(os.environ["REDIS_URL"], socket_connect_timeout=2, socket_timeout=2) as redis:
        redis.ping()
except (RedisError, KeyError, ValueError):
    raise SystemExit("Redis unavailable; provision the runtime before activating. Live API unchanged.") from None
print("ASGI and Redis preflight passed.")
