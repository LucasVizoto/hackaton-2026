#!/usr/bin/env bash
set -euo pipefail
release=$(realpath "${1:?release directory required}")
[[ "$release" == /srv/cocapec/releases/* ]]
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
previous=$(readlink -f /srv/cocapec/current || true)
if [ -n "$previous" ]; then supervisorctl stop cocapec-api; fi
baseline_ready=false
if runuser -u postgres -- psql -X -t -A -d cocapec -c "SELECT to_regclass('public.imports_seedrun') IS NOT NULL;" | grep -qx t; then
    if runuser -u postgres -- psql -X -t -A -d cocapec -c "SELECT EXISTS(SELECT 1 FROM imports_seedrun);" | grep -qx t; then baseline_ready=true; fi
fi
if [ "$baseline_ready" = false ]; then
    runuser -u cocapec -- env DJANGO_SETTINGS_MODULE=config.settings_production "$release/backend/.venv/bin/python" "$release/backend/manage.py" bootstrap_database --dry-run --report /srv/cocapec/shared/reports/bootstrap-dry-run.json
    runuser -u cocapec -- env DJANGO_SETTINGS_MODULE=config.settings_production "$release/backend/.venv/bin/python" "$release/backend/manage.py" bootstrap_database --report /srv/cocapec/shared/reports/bootstrap.json
else
    runuser -u cocapec -- env DJANGO_SETTINGS_MODULE=config.settings_production "$release/backend/.venv/bin/python" "$release/backend/manage.py" migrate --noinput
fi
runuser -u cocapec -- env DJANGO_SETTINGS_MODULE=config.settings_production "$release/backend/.venv/bin/python" "$release/backend/manage.py" createcachetable
runuser -u cocapec -- env DJANGO_SETTINGS_MODULE=config.settings_production "$release/backend/.venv/bin/python" "$release/backend/manage.py" seed_demo
runuser -u cocapec -- env DJANGO_SETTINGS_MODULE=config.settings_production "$release/backend/.venv/bin/python" "$release/backend/manage.py" collectstatic --noinput
if [ -n "$previous" ]; then printf '%s\n' "$previous" >/srv/cocapec/shared/previous-release; fi
ln -sfn "$release" /srv/cocapec/current.next
mv -Tf /srv/cocapec/current.next /srv/cocapec/current
chmod 755 /srv/cocapec/releases "$release"
setcap cap_net_bind_service=+ep /usr/bin/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
cp "$release/deploy/supervisor.conf" /etc/supervisor/conf.d/cocapec.conf
supervisorctl reread
supervisorctl update
if [ -n "$previous" ]; then supervisorctl restart cocapec-api; fi
supervisorctl status
printf 'Release activated; run public verification before accepting deployment.\n'
