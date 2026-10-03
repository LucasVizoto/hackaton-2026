"""Render trusted proxy ranges from the official Cloudflare network lists."""
import ipaddress
from pathlib import Path

shared = Path("/srv/cocapec/shared")
networks = []
for version in (4, 6):
    parsed = [ipaddress.ip_network(line) for line in (shared / f"cloudflare-v{version}").read_text().splitlines() if line]
    if not parsed or any(n.version != version for n in parsed):
        raise SystemExit("Invalid Cloudflare network list; existing config retained.")
    networks.extend(str(n) for n in parsed)
template = (Path(__file__).parent / "Caddyfile").read_text()
Path("/etc/caddy/Caddyfile").write_text(template.replace("{$CLOUDFLARE_CIDRS}", " ".join(networks)))
print("Caddy configuration rendered with validated proxy ranges.")
