#!/usr/bin/env bash
set -euo pipefail
release=$(realpath "${1:?compatible previous release directory required}")
[[ "$release" == /srv/cocapec/releases/* ]]
# Refuse old code when the live database contains migrations it does not know.
runuser -u cocapec -- "$release/backend/.venv/bin/python" - "$release" <<'PY'
import os
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'backend'))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_production'
import django
django.setup()
from django.db import connection
from django.db.migrations.loader import MigrationLoader
loader = MigrationLoader(connection)
if set(loader.applied_migrations) - set(loader.disk_migrations):
    raise SystemExit('Rollback refused: database schema requires a newer release.')
PY
ln -sfn "$release" /srv/cocapec/current.next
mv -Tf /srv/cocapec/current.next /srv/cocapec/current
supervisorctl restart cocapec-api
supervisorctl status
