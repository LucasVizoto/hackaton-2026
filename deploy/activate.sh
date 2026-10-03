#!/usr/bin/env bash
set -euo pipefail
release=$(realpath "${1:?release directory required}")
[[ "$release" == /srv/cocapec/releases/* ]]
previous=""
if [ -L /srv/cocapec/current ]; then previous=$(readlink -f /srv/cocapec/current); fi
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
chmod 755 /srv/cocapec/releases
chmod -R o-rwx "$release"
chmod o+x "$release" "$release/frontend" "$release/frontend/dist"
chmod -R o+rX "$release/frontend/dist/browser"
setcap cap_net_bind_service=+ep /usr/bin/caddy
touch /var/log/caddy/cocapec-access.log
chown caddy:caddy /var/log/caddy/cocapec-access.log
runuser -u caddy -- env HOME=/var/lib/caddy XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
cp "$release/deploy/supervisor.conf" /etc/supervisor/conf.d/cocapec.conf
supervisorctl reread
supervisorctl update
if [ -n "$previous" ]; then supervisorctl restart cocapec-api; fi
for attempt in $(seq 1 30); do
    if supervisorctl status | awk '($2 != "RUNNING"){bad=1} END{exit(bad || NR != 3)}'; then break; fi
    sleep 2
done
supervisorctl status
supervisorctl status | awk '($2 != "RUNNING"){bad=1} END{exit(bad || NR != 3)}'
printf 'Release activated; run public verification before accepting deployment.\n'
