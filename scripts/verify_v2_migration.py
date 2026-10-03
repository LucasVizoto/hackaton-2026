"""Fingerprint existing PostgreSQL columns before/after an additive migration.

Run only against an explicitly selected isolated database. The artifact contains
column names, counts and hashes, never source values or credentials.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["snapshot", "verify"])
    parser.add_argument("--database", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--richardy-policy", action="store_true",
                        help="Snapshot expected canonical machine and source-hold transformations.")
    args = parser.parse_args()
    os.environ["DB_NAME"] = args.database
    import django
    django.setup()
    from django.db import connection

    quote = connection.ops.quote_name
    prior = json.loads(args.output.read_text(encoding="utf-8")) if args.mode == "verify" else None
    result = {}
    with connection.cursor() as cursor:
        cursor.execute("SELECT EXISTS(SELECT 1 FROM django_migrations WHERE app='receiving' AND name='0005_release_rescheduled_source_holds')")
        release_already_applied = cursor.fetchone()[0]
        tables = connection.introspection.table_names(cursor)
        selected = prior["tables"] if prior else {
            table: {"columns": [col.name for col in connection.introspection.get_table_description(cursor, table)]}
            for table in tables if table not in {"django_migrations", "django_content_type", "auth_permission", "authtoken_token", "django_session"}
        }
        for table, metadata in selected.items():
            if table not in tables:
                result[table] = {"error": "table missing"}
                continue
            columns = metadata["columns"]
            expressions = {col: quote(col) for col in columns}
            if args.mode == "snapshot" and args.richardy_policy:
                if table == "receiving_appointment":
                    expressions["packaging"] = "CASE WHEN packaging = 'maquina_implemento' THEN 'machine_implement' ELSE packaging END AS packaging"
                if table == "receiving_capacityhold":
                    released = "(active AND assigned_to_id IS NULL AND (reason LIKE 'Vaga de origem de reagendamento%' OR reason LIKE 'Vaga de origem da atribuição administrativa%'))"
                    if release_already_applied:
                        released = "false"
                    machine = "(active AND NOT " + released + " AND source_appointment_id IN (SELECT id FROM receiving_appointment WHERE packaging IN ('machine_implement', 'maquina_implemento')))"
                    expressions["active"] = f"CASE WHEN {released} THEN false ELSE active END AS active"
                    expressions["units"] = f"CASE WHEN {machine} THEN 1 ELSE units END AS units"
                    expressions["exclusive"] = f"CASE WHEN {machine} THEN false ELSE exclusive END AS exclusive"
            projection = ", ".join(expressions[col] for col in columns)
            cursor.execute(f"SELECT row_to_json(t)::text FROM (SELECT {projection} FROM {quote(table)}) t")
            digests = sorted(hashlib.sha256(row[0].encode()).hexdigest() for row in cursor)
            result[table] = {
                "columns": columns, "count": len(digests),
                "sha256": hashlib.sha256("\n".join(digests).encode()).hexdigest(),
            }
    if prior:
        failures = [table for table, value in result.items() if prior["tables"][table] != value]
        print(json.dumps({"preserved": not failures, "tables_checked": len(result), "changed_tables": failures}))
        return 1 if failures else 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"database": args.database, "tables": result}, indent=2), encoding="utf-8")
    print(json.dumps({"tables_snapshotted": len(result), "rows": sum(item["count"] for item in result.values())}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
