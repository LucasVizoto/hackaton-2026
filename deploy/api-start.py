"""Wait for the configured database, then exec the supervised ASGI server."""
import os
import subprocess
import sys
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from redis import Redis
from redis.exceptions import RedisError

root = Path(__file__).resolve().parent.parent
load_dotenv(root / ".env")
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_production"
os.environ["HOME"] = "/srv/cocapec"
for attempt in range(30):
    try:
        with psycopg.connect(
            dbname=os.environ["DB_NAME"], user=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"], host=os.environ["DB_HOST"],
            port=os.environ["DB_PORT"], connect_timeout=2,
        ) as conn:
            conn.execute("SELECT 1").fetchone()
        break
    except psycopg.OperationalError:
        time.sleep(2)
else:
    raise SystemExit("Database unavailable; Supervisor will retry.")
try:
    with Redis.from_url(os.environ["REDIS_URL"], socket_connect_timeout=2, socket_timeout=2) as redis:
        redis.ping()
except (RedisError, KeyError, ValueError):
    raise SystemExit("Redis unavailable; Supervisor will retry.") from None
subprocess.run(
    [sys.executable, str(root / "backend/manage.py"), "migrate", "--check"],
    check=True,
)
os.chdir(root / "backend")
os.execv(str(root / "backend/.venv/bin/daphne"), [
    "daphne", "-b", "127.0.0.1", "-p", "8000", "--verbosity", "0",
    "--access-log", "/dev/null", "--proxy-headers", "config.asgi:application",
])
