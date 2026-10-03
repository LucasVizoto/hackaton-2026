#!/usr/bin/env bash
set -euo pipefail
release=$(realpath "${1:?release directory required}")
[[ "$release" == /srv/cocapec/releases/* ]]
exec 9>/srv/cocapec/shared/deployment.lock
flock -n 9 || { printf 'Another deployment is running.\n' >&2; exit 75; }
test -f "$release/backend/requirements.production.lock"
test -f /srv/cocapec/shared/.env
ln -sfn /srv/cocapec/shared/.env "$release/.env"
chown -R cocapec:cocapec "$release"
runtime_python=$(cat /srv/cocapec/shared/python-path)
uv venv --python "$runtime_python" "$release/backend/.venv"
uv pip sync --python "$release/backend/.venv/bin/python" "$release/backend/requirements.production.lock"
chown -R cocapec:cocapec "$release/backend/.venv"
runuser -u cocapec -- env HOME=/srv/cocapec bash -c 'cd "$1/frontend"; npm ci; npm run lint; npm test; npm run build:production' bash "$release"
"$release/deploy/verify-backend.sh" "$release"
runuser -u cocapec -- env DJANGO_SETTINGS_MODULE=config.settings_production "$release/backend/.venv/bin/python" "$release/backend/manage.py" check --deploy --fail-level WARNING
"$release/deploy/activate.sh" "$release"
