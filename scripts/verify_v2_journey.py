"""Exercise the real HTTP v2 workflow using explicitly synthetic local fixtures.

Requires a migrated isolated database served on localhost, seeded demo accounts,
and a free weekday. Credentials are read from .env and never included in output.
"""
import argparse
import hashlib
import json
import os
import uuid
from decimal import Decimal
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from dotenv import load_dotenv


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000/api/v2/")
    parser.add_argument("--date")
    parser.add_argument("--verify-checkpoint", type=Path, help="Read-only persistence check against a prior journey output.")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.date and not args.verify_checkpoint:
        parser.error("Provide --date for a new journey or --verify-checkpoint for persistence verification.")
    if urlsplit(args.base_url).hostname not in {"localhost", "127.0.0.1"}:
        raise SystemExit("This verification writes synthetic fixtures and requires localhost.")
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    tokens = {}

    def call(role, path, data=None, *, method=None, raw=None, content_type=None, expected=None):
        headers = {"Accept": "application/json"}
        if role in tokens:
            headers["Authorization"] = "Token "+tokens[role]
        body = raw if raw is not None else json.dumps(data).encode() if data is not None else None
        if body is not None:
            headers["Content-Type"] = content_type or "application/json"
        request = Request(args.base_url+path, data=body, headers=headers, method=method or ("POST" if body is not None else "GET"))
        try:
            with urlopen(request, timeout=30) as response:
                status, content = response.status, response.read()
        except HTTPError as error:
            status, content = error.code, error.read()
        if expected is not None:
            assert status == expected, (path, status, content[:1000])
        else:
            assert 200 <= status < 300, (path, status, content[:1000])
        return json.loads(content) if content else None

    for role, username in {"supplier": "fornecedor_demo", "purchasing": "compras_demo", "warehouse": "armazem_demo", "gatehouse": "portaria_demo", "management": "gestao_demo"}.items():
        tokens[role] = call(role, "auth/login/", {"username": username, "password": os.environ["DEMO_PASSWORD"]})["token"]
    if args.verify_checkpoint:
        previous = json.loads(args.verify_checkpoint.read_text(encoding="utf-8"))
        current = call("warehouse", f"appointments/{previous['appointment']}/")
        baseline = previous["appointment_state"]
        keys = ("id", "revision", "operation_status", "gate_checked_in_at", "gate_checked_out_at", "invoices", "receipt_lines", "visits")
        for key in keys:
            assert current[key] == baseline[key], f"Persisted receipt field changed: {key}"
        bulletin = call("warehouse", f"bulletins/{previous['bulletin']}/")
        assert bulletin["calculation"] == previous["calculation"], "Persisted financial snapshot changed."
        assert len(bulletin["individual_allocations"]) == previous["financial_memberships"]
        result = {"status": "passed", "verification": "persistence_after_restart", "appointment": current["id"],
                  "bulletin": previous["bulletin"], "source_checkpoint_sha256": previous["checkpoint_sha256"]}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result))
        return
    warehouses = call("warehouse", "catalog/warehouses/")["results"]
    destinations = [next(item for item in warehouses if item["code"] == code) for code in ("ADUBO", "INSUMOS")]
    workers = call("warehouse", "catalog/workers/?registration=D031")["results"]
    worker = workers[0]
    run = uuid.uuid4().hex[:10]
    invoices = []
    for offset in range(2):
        number = str(int(run[:6], 16)+offset+1)
        xml = f'<nfeProc><NFe><infNFe><ide><nNF>{number}</nNF><serie>1</serie></ide><emit><xNome>Fornecedor sintético</xNome></emit><det nItem="1"><prod><cProd>DEMO</cProd><xProd>Item sintético {run}</xProd><uCom>UN</uCom><qCom>10</qCom><vUnCom>1</vUnCom></prod></det></infNFe></NFe></nfeProc>'.encode()
        boundary = uuid.uuid4().hex
        content = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="demo-{offset}.xml"\r\nContent-Type: application/xml\r\n\r\n'.encode()+xml+f'\r\n--{boundary}--\r\n'.encode())
        invoices.append(call("supplier", "invoices/upload/", raw=content, content_type="multipart/form-data; boundary="+boundary))
    ap = call("supplier", "appointments/", {"invoice_ids": [item["id"] for item in invoices], "date": args.date,
        "time": "10:00", "packaging": "machine_implement", "vehicle_plate": "DEMO123", "articulated": True,
        "tractor_plate": "TEST456", "carrier_name": "Transportadora sintética", "driver_name": "Motorista sintético",
        "idempotency_key": str(uuid.uuid4())})
    apid = ap["id"]

    def refresh(role="warehouse"):
        return call(role, f"appointments/{apid}/")

    def action(role, code, data):
        current = refresh(role)
        return call(role, f"appointments/{apid}/{code}/", {"expected_revision": current["revision"], "idempotency_key": str(uuid.uuid4()), **data})

    assert len(ap["invoices"]) == 2
    availability = call("supplier", "slots/availability/?"+urlencode({"date": args.date, "packaging": "paletizada"}))
    assert next(item for item in availability["slots"] if item["time"] == "10:00")["eligible"]
    def timestamp(hhmm):
        return args.date+"T"+hhmm+":00-03:00"
    action("gatehouse", "gate-check-in", {"occurred_at": timestamp("09:50")})
    gate_view = refresh("gatehouse")
    assert len(gate_view["invoices"]) == 2 and gate_view["tractor_plate"] == "TEST456"
    call("gatehouse", "analytics/labor-costs/", expected=403)
    action("purchasing", "purchase-review", {"decision": "approved", "order_reference": "DEMO-"+run, "comparison_notes": "Demonstração HTTP isolada"})
    action("warehouse", "warehouse-review", {"warehouse_ids": [item["id"] for item in destinations]})
    for invoice in invoices:
        action("warehouse", "receipt-lines", {"invoice": invoice["id"], "invoice_item": invoice["items"][0]["id"],
            "observed_quantity": "10", "accepted_quantity": "10", "rejected_quantity": "0"})
    visits = refresh()["visits"]
    for index, visit in enumerate(visits):
        for entering, at in ((True, "10:00" if index == 0 else "10:20"), (False, "10:15" if index == 0 else "10:35")):
            payload = {"expected_revision": refresh()["revision"], "idempotency_key": str(uuid.uuid4()), "occurred_at": timestamp(at)}
            if not entering:
                payload.update(worker_count=1, equipment_ids=[], resources_confirmed=True)
            call("warehouse", f"warehouse-visits/{visit['id']}/{'check-in' if entering else 'check-out'}/", payload)
    unloaded = refresh()
    assert unloaded["operation_status"] == "completed" and unloaded["gate_checked_out_at"] is None
    action("gatehouse", "gate-check-out", {"occurred_at": timestamp("10:45")})
    for destination in destinations:
        call("warehouse", "labor-activities/", {"worker": worker["id"], "reference_date": args.date, "origin": "demo_sintetico",
            "warehouse": destination["id"], "appointment": apid, "activity_type": "MACHINE", "attendance_state": "PRESENT", "used": True})
    bulletin = call("warehouse", "bulletins/", {"warehouse": destinations[0]["id"], "reference_date": args.date, "origin": "demo_sintetico",
        "participants": [{"worker": worker["id"], "fraction": "1"}], "lines": [], "daily_services": [{"kind": "HALF", "quantity": "1"}]})
    call("warehouse", "bulletins/", {"warehouse": destinations[1]["id"], "reference_date": args.date, "origin": "demo_sintetico",
        "participants": [{"worker": worker["id"], "fraction": "1"}], "lines": []}, expected=400)
    closed = call("warehouse", f"bulletins/{bulletin['id']}/close/", {"revision": bulletin["revision"]})
    assert len(closed["individual_allocations"]) == 1
    assert Decimal(closed["calculation"]["production"]) == Decimal("45.0786")
    assert Decimal(closed["calculation"]["total_payable"]) == Decimal("90.1731")
    query = urlencode({"date_from": args.date, "date_to": args.date, "origin": "demo_sintetico"})
    costs = call("management", "analytics/labor-costs/?"+query)
    assert costs["reconciliation"]["difference"] == "0.00"
    assert costs["presence"]["used"] == 1
    assert len(costs["individuals"]["records"][0]["activity_warehouses"]) == 2
    result = {"status": "passed", "synthetic": True, "appointment": apid, "bulletin": bulletin["id"], "worker": worker["id"],
              "date": args.date, "invoice_count": 2, "warehouse_count": 2, "financial_memberships": 1,
              "calculation": closed["calculation"], "reconciliation": costs["reconciliation"], "appointment_state": refresh()}
    result["checkpoint_sha256"] = hashlib.sha256(json.dumps(result, sort_keys=True, default=str).encode()).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": "passed", "appointment": apid, "bulletin": bulletin["id"], "checkpoint_sha256": result["checkpoint_sha256"]}))


if __name__ == "__main__":
    main()
