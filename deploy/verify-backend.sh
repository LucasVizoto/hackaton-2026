#!/usr/bin/env bash
set -euo pipefail
release=$(realpath "${1:?release directory required}")
[[ "$release" == /srv/cocapec/releases/* ]]
runuser -u postgres -- psql -X -q -c 'ALTER ROLE cocapec_validation CREATEDB;'
trap "runuser -u postgres -- psql -X -q -c 'ALTER ROLE cocapec_validation NOCREATEDB;'" EXIT
runuser -u cocapec -- "$release/backend/.venv/bin/python" - "$release" <<'PY'
import os
import subprocess
import sys
from pathlib import Path
from dotenv import load_dotenv
root = Path(sys.argv[1])
load_dotenv(root / '.env')
load_dotenv('/srv/cocapec/shared/.test.env', override=True)
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings'
os.chdir(root)
for args in [
    ['backend/.venv/bin/ruff', 'check', '--config', 'backend/ruff.toml', 'backend', 'scripts', 'deploy'],
    [sys.executable, 'backend/manage.py', 'check'],
    [sys.executable, 'backend/manage.py', 'makemigrations', '--check', '--dry-run', '--noinput'],
    [sys.executable, 'backend/manage.py', 'test', 'core', 'receiving', 'labor', 'analytics', 'imports', 'integrations', '--noinput'],
]:
    subprocess.run(args, check=True)
PY
