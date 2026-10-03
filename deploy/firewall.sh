#!/usr/bin/env bash
set -euo pipefail
mode=${1:-bootstrap}
test "$mode" = bootstrap || test "$mode" = cloudflare
install -d /etc/nftables.d
python3 - "$mode" <<'PY'
import ipaddress
import sys
from pathlib import Path
allow = 'tcp dport 443 accept'
if sys.argv[1] == 'cloudflare':
    entries = []
    for version in (4, 6):
        nets = [ipaddress.ip_network(x) for x in Path(f'/srv/cocapec/shared/cloudflare-v{version}').read_text().splitlines() if x]
        assert nets and all(x.version == version for x in nets)
        family = 'ip' if version == 4 else 'ip6'
        entries.append(f'{family} saddr {{ ' + ', '.join(map(str, nets)) + ' } tcp dport 443 accept')
    allow = '\n        '.join(entries)
Path('/etc/nftables.d/cocapec.nft').write_text('''add table inet cocapec
flush table inet cocapec
table inet cocapec {
    chain input {
        type filter hook input priority 0; policy drop;
        iifname "lo" accept
        ct state established,related accept
        ct state invalid drop
        ip protocol icmp accept
        meta l4proto ipv6-icmp accept
        udp sport 67 udp dport 68 accept
        udp sport 547 udp dport 546 accept
        tcp dport { 22, 80 } accept
        ''' + allow + '''
    }
}
''')
PY
nft -c -f /etc/nftables.d/cocapec.nft
# Remove only our table if the operator loses access before validating SSH.
systemctl stop cocapec-firewall-rollback.timer 2>/dev/null || true
systemd-run --unit=cocapec-firewall-rollback --on-active=120 /usr/sbin/nft delete table inet cocapec
nft -f /etc/nftables.d/cocapec.nft
printf '# Cocapec firewall; only this application table is managed.\ninclude "/etc/nftables.d/cocapec.nft"\n' >/etc/nftables.conf
systemctl enable nftables
printf 'Firewall applied. Validate a new SSH connection and stop cocapec-firewall-rollback.timer.\n'
