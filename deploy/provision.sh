#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
export DEBIAN_FRONTEND=noninteractive
systemctl mask --now caddy.service postgresql.service postgresql@17-main.service || true
apt-get update
apt-get install -y supervisor postgresql-17 postgresql-client-17 curl ca-certificates gnupg nftables rsync git xz-utils libcap2-bin redis-server
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
systemctl mask --now redis-server.service || true
id cocapec >/dev/null 2>&1 || useradd --system --home-dir /srv/cocapec --shell /usr/sbin/nologin cocapec
install -d -m 755 /srv/cocapec /srv/cocapec/releases /opt/cocapec /opt/cocapec/downloads
install -d -o cocapec -g cocapec -m 750 /srv/cocapec/.npm /srv/cocapec/.cache
install -d -o cocapec -g cocapec -m 750 /srv/cocapec/shared /srv/cocapec/shared/media /srv/cocapec/shared/sources /srv/cocapec/shared/reports
install -d -o cocapec -g cocapec -m 750 /srv/cocapec/shared/redis
install -d -o root -g root -m 750 /var/log/cocapec
install -d -o caddy -g caddy -m 750 /var/log/caddy /var/lib/caddy
install -d -o caddy -g caddy -m 750 /run/cocapec-caddy
printf 'd /run/cocapec-caddy 0750 caddy caddy -\n' >/etc/tmpfiles.d/cocapec-caddy.conf
install -d /etc/systemd/system/supervisor.service.d
printf '[Service]\nRestart=always\nRestartSec=5\n\n[Unit]\nAfter=network-online.target\nWants=network-online.target\n' >/etc/systemd/system/supervisor.service.d/cocapec.conf
sed -i 's/^chmod=.*/chmod=0700/' /etc/supervisor/supervisord.conf
systemctl daemon-reload
systemctl enable --now supervisor
timedatectl set-timezone America/Sao_Paulo
if ! swapon --show=NAME --noheadings | grep -qx /swapfile-cocapec; then
    if [ ! -f /swapfile-cocapec ]; then
        fallocate -l 2G /swapfile-cocapec
        chmod 600 /swapfile-cocapec
        mkswap /swapfile-cocapec
    fi
    swapon /swapfile-cocapec
fi
grep -q '^/swapfile-cocapec ' /etc/fstab || printf '/swapfile-cocapec none swap sw 0 0\n' >>/etc/fstab
cd /opt/cocapec/downloads
if [ ! -x /usr/local/bin/uv ]; then
    curl -fsSLO https://github.com/astral-sh/uv/releases/download/0.12.22/uv-x86_64-unknown-linux-gnu.tar.gz
    curl -fsSLO https://github.com/astral-sh/uv/releases/download/0.12.22/uv-x86_64-unknown-linux-gnu.tar.gz.sha256
    sha256sum -c uv-x86_64-unknown-linux-gnu.tar.gz.sha256
    tar -xzf uv-x86_64-unknown-linux-gnu.tar.gz
    install -m 755 uv-x86_64-unknown-linux-gnu/uv uv-x86_64-unknown-linux-gnu/uvx /usr/local/bin/
fi
export UV_PYTHON_INSTALL_DIR=/opt/cocapec/python
uv python install 3.14.8
uv python find --managed-python 3.14.8 >/srv/cocapec/shared/python-path
chmod -R go+rX /opt/cocapec/python
if [ ! -x /opt/cocapec/node/bin/node ]; then
    curl -fsSLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
    curl -fsSL https://nodejs.org/dist/v24.21.0/SHASUMS256.txt -o node-SHASUMS256.txt
    sha256sum -c --ignore-missing node-SHASUMS256.txt
    tar -xJf node-v24.21.0-linux-x64.tar.xz -C /opt/cocapec
    ln -sfn node-v24.21.0-linux-x64 /opt/cocapec/node
fi
ln -sfn /opt/cocapec/node/bin/node /usr/local/bin/node
ln -sfn /opt/cocapec/node/bin/npm /usr/local/bin/npm
ln -sfn /opt/cocapec/node/bin/npx /usr/local/bin/npx
setcap cap_net_bind_service=+ep /usr/bin/caddy
test -d /var/lib/postgresql/17/main || pg_createcluster 17 main --start-conf=disabled
printf 'disabled\n' >/etc/postgresql/17/main/start.conf
cat >/etc/postgresql/17/main/conf.d/cocapec.conf <<'EOF'
listen_addresses = '127.0.0.1'
port = 5432
max_connections = 50
shared_buffers = '512MB'
logging_collector = off
log_destination = 'stderr'
log_line_prefix = '%m [%p] '
EOF
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [ -L /srv/cocapec/current ]; then
    # Adding Redis must not remove or restart the running API/web programs.
    if ! grep -q '^\[program:cocapec-redis\]' /etc/supervisor/conf.d/cocapec.conf; then
        awk '/^\[program:cocapec-redis\]/{copy=1} /^\[program:cocapec-api\]/{copy=0} copy {print}' "$script_dir/supervisor.conf" >>/etc/supervisor/conf.d/cocapec.conf
    fi
else
    awk '/^\[program:cocapec-api\]/{exit} {print}' "$script_dir/supervisor.conf" >/etc/supervisor/conf.d/cocapec.conf
fi
supervisorctl reread
supervisorctl update
for _ in $(seq 1 30); do
    if runuser -u postgres -- pg_isready -q; then break; fi
    sleep 2
done
runuser -u postgres -- pg_isready -q
python3 "$script_dir/provision-env.py"
curl -fsSL https://www.cloudflare.com/ips-v4 -o /srv/cocapec/shared/cloudflare-v4
curl -fsSL https://www.cloudflare.com/ips-v6 -o /srv/cocapec/shared/cloudflare-v6
python3 "$script_dir/render-caddy.py"
cat >/etc/ssh/sshd_config.d/00-cocapec-keys.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
/usr/sbin/sshd -t
systemctl reload ssh
{
    date --iso-8601=seconds
    uv --version
    "$(cat /srv/cocapec/shared/python-path)" --version
    node --version
    caddy version
    /usr/lib/postgresql/17/bin/postgres --version
    supervisord --version
    sha256sum /usr/bin/caddy /usr/local/bin/uv /opt/cocapec/node/bin/node
    sha256sum "$(cat /srv/cocapec/shared/python-path)" /usr/lib/postgresql/17/bin/postgres /usr/bin/supervisord
    sha256sum "$script_dir/../backend/requirements.production.lock" "$script_dir/../frontend/package-lock.json"
} >/srv/cocapec/shared/reports/toolchain.txt
printf 'Provisioning complete; database supervised and secrets stored privately.\n'
