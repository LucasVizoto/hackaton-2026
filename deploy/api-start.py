#!/usr/bin/env python3
"""Wait for the configured database, then exec the supervised Gunicorn master."""
import os
import subprocess
import sys
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv

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
subprocess.run(
    [sys.executable, str(root / "backend/manage.py"), "migrate", "--check"],
    check=True,
)
os.chdir(root / "backend")
os.execv(str(root / "backend/.venv/bin/gunicorn"), [
    "gunicorn", "config.wsgi:application", "--bind", "127.0.0.1:8000",
    "--workers", "3", "--worker-class", "sync", "--timeout", "60",
    "--graceful-timeout", "30", "--access-logfile", "-", "--error-logfile", "-",
    "--access-logformat", '%(h)s %(m)s %(U)s %(s)s %(L)s',
])
