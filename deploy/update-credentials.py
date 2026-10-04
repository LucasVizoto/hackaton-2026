"""Merge the private account inventory; never change passwords or existing entries."""
import json
import os
import tempfile
from pathlib import Path

ACCOUNTS = ("fornecedor_demo", "fornecedor_b_demo", "compras_demo", "armazem_demo", "gestao_demo", "portaria_demo")


def update(path):
    credentials = json.loads(path.read_text(encoding="utf-8"))
    existing = credentials.setdefault("usernames", [])
    for name in ACCOUNTS:
        if name not in existing:
            existing.append(name)
    fd, name = tempfile.mkstemp(prefix=".credentials-", dir=path.parent)
    try:
        os.chmod(name, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(credentials, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


if __name__ == "__main__":
    update(Path("/srv/cocapec/shared/credentials.json"))
    print("Private account inventory refreshed; passwords preserved.")
