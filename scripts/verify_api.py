"""Local demonstration checks over HTTP. Credentials and checkpoints stay private."""

import argparse
import json
import os
from decimal import Decimal
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CHECKPOINT = ROOT / ".private" / "validation-synthetic.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api/v1")
    parser.add_argument("--checkpoint", action="store_true")
    parser.add_argument("--verify-persistence", action="store_true")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    password = os.environ.get("DEMO_PASSWORD")
    if not password:
        raise SystemExit("Configure DEMO_PASSWORD no .env privado e execute seed_demo.")
    token = ""

    def request(path, data=None):
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = "Token " + token
        payload = None if data is None else json.dumps(data).encode()
        if payload:
            headers["Content-Type"] = "application/json"
        try:
            with urlopen(
                Request(
                    args.base_url.rstrip("/") + "/" + path,
                    data=payload,
                    headers=headers,
                ),
                timeout=30,
            ) as response:
                return json.load(response)
        except HTTPError as exc:
            # Never print a response body: it can contain document or personal data.
            raise SystemExit(
                f"Requisição recusada: HTTP {exc.code}; confira API, seed e credenciais locais."
            ) from None

    assert request("health/")["database"] == "postgresql"
    token = request("auth/login/", {"username": "gestao_demo", "password": password})[
        "token"
    ]
    assert request("auth/me/")["role"] == "management"
    filters = {
        "origin": "demo_sintetico",
        "date_from": "2026-10-01",
        "date_to": "2026-10-02",
    }
    costs = request("analytics/labor-costs/?" + urlencode(filters))
    summary = costs["summary"]
    for key, expected in {
        "production": "2213.51",
        "total_payable": "2779.2796",
        "supplement": "565.7696",
        "equivalent_days": "28",
    }.items():
        assert Decimal(summary[key]) == Decimal(expected), (
            "Seed foi alterado; reconfira o período sintético."
        )
    assert summary["people_count"] == 14 and len(costs["groups"]) == 4
    operations = request("analytics/operations/?" + urlencode(filters))
    assert operations["received_loads"] == 2
    assert operations["coverage"]["valid_unloading_records"] == 2
    historical = request(
        "analytics/labor-costs/?"
        + urlencode({**filters, "origin": "historico_importado"})
    )
    assert historical["summary"]["total_payable"] is None
    assert historical["coverage"]["closed_bulletins"] == 0

    def all_records(path):
        rows, page = [], 1
        while True:
            response = request(
                path + "?" + urlencode({"origin": "demo_sintetico", "page": page})
            )
            rows.extend(response["results"])
            if not response.get("next"):
                return rows
            page += 1

    bulletins = all_records("bulletins/")
    appointments = all_records("appointments/")
    non_receipts = all_records("non-receipts/")
    official = next(b for b in bulletins if b["reference_date"] == "2025-11-17")
    assert Decimal(official["calculation"]["production"]) == Decimal("918.1952")
    assert Decimal(official["calculation"]["total_payable"]) == Decimal("991.9041")
    scenario = request(
        "analytics/staffing-scenario/",
        {"bulletin": official["id"], "equivalent_days": "10.5"},
    )
    assert scenario["conditional"] is True
    assert Decimal(scenario["scenario"]["total_payable"]) == Decimal("946.81755")
    assert Decimal(scenario["scenario"]["supplement"]) == Decimal("28.62235")
    assert Decimal(scenario["difference"]) == Decimal("45.08655")
    assert request("data/quality/")["raw_data_exposed"] is False
    snapshot = {
        "origin": "demo_sintetico",
        "bulletins": {
            b["id"]: {k: b[k] for k in ("status", "revision", "calculation")}
            for b in bulletins
        },
        "appointments": {
            a["id"]: {
                k: a[k]
                for k in (
                    "operation_status",
                    "revision",
                    "arrived_at",
                    "started_at",
                    "finished_at",
                    "date",
                    "time",
                    "purchase_status",
                    "warehouse_status",
                    "worker_count",
                    "equipment_ids",
                    "resources_confirmed",
                    "visits",
                    "capacity_holds",
                )
            }
            for a in appointments
        },
        "non_receipts": {
            r["id"]: {k: r[k] for k in ("origin", "reason", "occurred_at")}
            for r in non_receipts
        },
    }
    if args.checkpoint:
        CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
        CHECKPOINT.write_text(
            json.dumps(snapshot, ensure_ascii=False), encoding="utf-8"
        )
    if args.verify_persistence:
        previous = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
        assert previous == snapshot, (
            "Estado mudou após checkpoint; confira alterações antes de atribuir falha à persistência."
        )
        print(
            "Persistência HTTP após reinício: PASS; recebimentos e boletins sintéticos reapareceram sem alteração."
        )
    print(
        "HTTP/API PostgreSQL: PASS; piso oficial, cenário condicional, quatro locais, origem e cobertura conferidos."
    )


if __name__ == "__main__":
    main()
