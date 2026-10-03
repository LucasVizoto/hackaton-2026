"""Provision private environment and PostgreSQL roles without logging credentials."""
import grp
import json
import os
import secrets
import subprocess
from pathlib import Path

shared = Path("/srv/cocapec/shared")
env_path = shared / ".env"


def psql(sql):
    result = subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "-X", "-q", "-t", "-A",
         "-v", "ON_ERROR_STOP=1", "-d", "postgres"],
        input=sql, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        raise SystemExit("PostgreSQL provisioning failed; credentials were not printed.")
    return result.stdout.strip()


def private_file(path, text, app_readable=True):
    path.write_text(text, encoding="utf-8")
    os.chmod(path, 0o640 if app_readable else 0o600)
    os.chown(path, 0, grp.getgrnam("cocapec").gr_gid)


if not env_path.exists():
    values = {
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
        "DJANGO_SETTINGS_MODULE": "config.settings_production",
        "DEBUG": "false", "DB_NAME": "cocapec", "DB_USER": "cocapec",
        "DB_PASSWORD": secrets.token_urlsafe(32), "DB_HOST": "127.0.0.1", "DB_PORT": "5432",
        "MEDIA_ROOT": str(shared / "media"), "PRIVATE_DATA_DIR": str(shared / "sources"),
        "DEMO_PASSWORD": secrets.token_urlsafe(24),
    }
    private_file(env_path, "".join(f"{k}={v}\n" for k, v in values.items()))
    private_file(shared / "credentials.json", json.dumps({
        "url": "https://cocapec.lucasvizoto.com",
        "usernames": ["fornecedor_demo", "fornecedor_b_demo", "compras_demo", "armazem_demo", "gestao_demo"],
        "password": values["DEMO_PASSWORD"],
    }, indent=2) + "\n", False)
values = dict(line.split("=", 1) for line in env_path.read_text().splitlines() if "=" in line)
for role_name, password, database, createdb in [
    ("cocapec", values["DB_PASSWORD"], "cocapec", False),
    ("cocapec_validation", None, "cocapec_validation", True),
]:
    test_env = shared / ".test.env"
    if role_name == "cocapec_validation":
        if test_env.exists():
            password = dict(line.split("=", 1) for line in test_env.read_text().splitlines())["DB_PASSWORD"]
        else:
            password = secrets.token_urlsafe(32)
            private_file(test_env, f"DB_NAME={database}\nDB_USER={role_name}\nDB_PASSWORD={password}\n")
    if not psql(f"SELECT 1 FROM pg_roles WHERE rolname='{role_name}';"):
        psql(f"CREATE ROLE {role_name} LOGIN {'CREATEDB' if createdb else 'NOCREATEDB'} NOSUPERUSER NOCREATEROLE PASSWORD '{password}';")
    if not psql(f"SELECT 1 FROM pg_database WHERE datname='{database}';"):
        psql(f"CREATE DATABASE {database} OWNER {role_name} ENCODING 'UTF8';")
print("Private environment and database roles ready.")
