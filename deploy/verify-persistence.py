"""Verify persistent row identities across migrations without storing row data."""
import argparse
import hashlib
import json
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg import sql

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("mode", choices=("capture", "verify"))
parser.add_argument("--report", type=Path, default=Path("/srv/cocapec/shared/reports/persistence-before.json"))
args = parser.parse_args()
load_dotenv("/srv/cocapec/shared/.env")


def identities(connection):
    keys = connection.execute("""
        SELECT tc.table_name, array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position)
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
        WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY'
          AND (tc.table_name LIKE 'receiving_%' OR tc.table_name LIKE 'labor_%'
               OR tc.table_name LIKE 'imports_%' OR tc.table_name LIKE 'catalog_%'
               OR tc.table_name LIKE 'core_%' OR tc.table_name='auth_user')
        GROUP BY tc.table_name ORDER BY tc.table_name
    """).fetchall()
    result = {}
    for table, columns in keys:
        rows = connection.execute(sql.SQL("SELECT {} FROM {}.{}").format(
            sql.SQL(", ").join(map(sql.Identifier, columns)),
            sql.Identifier("public"), sql.Identifier(table),
        )).fetchall()
        fingerprints = sorted(hashlib.sha256(json.dumps(
            [str(value) for value in row], separators=(",", ":"),
        ).encode()).hexdigest() for row in rows)
        result[table] = {"columns": columns, "identities": fingerprints}
    return result


with psycopg.connect(
    dbname=os.environ["DB_NAME"], user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"], host=os.environ["DB_HOST"],
    port=os.environ["DB_PORT"], connect_timeout=10,
) as connection:
    connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
    current = identities(connection)
assert current, "No persistent application tables found."
if args.mode == "capture":
    args.report.write_text(json.dumps(current), encoding="utf-8")
    args.report.chmod(0o600)
    print(f"Persistence checkpoint captured: {len(current)} tables; row contents not stored.")
else:
    previous = json.loads(args.report.read_text(encoding="utf-8"))
    for table, expected in previous.items():
        assert table in current, f"Persistent table removed: {table}; review its migration mapping."
        assert expected["columns"] == current[table]["columns"], f"Primary key changed: {table}; review identity mapping."
        assert set(expected["identities"]) <= set(current[table]["identities"]), f"Persistent records missing: {table}."
    print(f"Persistence across migrations PASS: existing identities preserved in {len(previous)} tables.")
