from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.test import TestCase
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from catalog.models import Supplier
from labor.calculation import calculate
from labor.models import DailyBulletin
from labor.serializers import BulletinInput
from labor.services import close_bulletin, reopen_bulletin, replace_contents
from labor.tests import REFERENCE, labor_fixtures, official_payload, stored_bulletin
from receiving.models import Appointment, GlobalSlot, Invoice, WarehouseVisit


class DashboardTests(TestCase):
    def setUp(self):
        labor_fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        self.filters = {"date_from": str(REFERENCE), "date_to": str(REFERENCE), "origin": "demo_sintetico"}

    def costs(self, **filters):
        response = self.client.get("/api/v2/analytics/labor-costs/", {**self.filters, **filters})
        self.assertEqual(response.status_code, 200)
        return response.data

    def snapshot(self, *, warehouse=None, day=REFERENCE, production="0", floor="90.1731", origin="demo_sintetico", status="CLOSED"):
        calculation = calculate([{"unloading": "1", "price": production}], [{"fraction": "1"}], Decimal(floor))
        return DailyBulletin.objects.create(warehouse=warehouse or self.warehouse, reference_date=day,
            origin=origin, status=status, calculation=calculation, created_by=self.operator)

    def test_daily_floor_is_applied_per_bulletin_and_gaps_stay_null(self):
        self.snapshot(production="400")
        self.snapshot(warehouse=self.other_warehouse, production="0")
        self.snapshot(day=REFERENCE + timedelta(days=2), floor="0")
        data = self.costs(date_to=str(REFERENCE + timedelta(days=2)))
        rows = data["daily_series"]
        self.assertEqual(Decimal(rows[0]["production"]), Decimal("400"))
        self.assertEqual(Decimal(rows[0]["total_payable"]), Decimal("490.1731"))
        self.assertEqual(Decimal(rows[0]["supplement"]), Decimal("90.1731"))
        self.assertEqual(rows[0]["bulletin_count"], 2)
        self.assertIsNone(rows[1]["production"])
        self.assertIsNone(rows[1]["total_payable"])
        self.assertEqual(rows[1]["bulletin_count"], 0)
        self.assertEqual(Decimal(rows[2]["total_payable"]), 0)
        self.assertEqual(sum(Decimal(row["total_payable"]) for row in rows if row["total_payable"] is not None), Decimal(data["summary"]["total_payable"]))

    def test_series_uses_every_snapshot_beyond_evidence_limit(self):
        for offset in range(105):
            self.snapshot(day=REFERENCE + timedelta(days=offset), production="0.00001")
        with CaptureQueriesContext(connection) as queries:
            data = self.costs(date_to=str(REFERENCE + timedelta(days=104)))
        self.assertEqual(sum('FROM "labor_dailybulletin"' in query["sql"] for query in queries), 1)
        self.assertTrue(data["source_records"]["truncated"])
        self.assertEqual(data["source_records"]["returned_count"], 100)
        self.assertEqual(sum(row["bulletin_count"] for row in data["daily_series"]), 105)
        self.assertEqual(sum(Decimal(row["production"]) for row in data["daily_series"]), Decimal("0.00105"))
        self.assertEqual(data["weekly_supplement"]["closed_bulletins"], 7)

    def test_week_window_clips_to_filter_and_preserves_exact_ties(self):
        self.snapshot(day=REFERENCE - timedelta(days=7), floor="9999")
        for warehouse in (self.warehouse, self.other_warehouse):
            self.snapshot(warehouse=warehouse, day=REFERENCE - timedelta(days=6))
        self.snapshot(day=REFERENCE, production="999")
        data = self.costs(date_from=str(REFERENCE - timedelta(days=10)))
        week = data["weekly_supplement"]
        self.assertEqual(week["period"]["date_from"], str(REFERENCE - timedelta(days=6)))
        self.assertCountEqual(week["leaders"], [str(self.warehouse.pk), str(self.other_warehouse.pk)])
        self.assertTrue(all(Decimal(row["supplement"]) == Decimal("90.1731") for row in week["groups"]))
        clipped = self.costs()["weekly_supplement"]
        self.assertEqual(clipped["period"]["date_from"], str(REFERENCE))
        self.assertEqual(clipped["closed_bulletins"], 1)
        self.assertEqual(clipped["leaders"], [])

    def test_origin_warehouse_and_closed_status_isolation(self):
        self.snapshot()
        self.snapshot(warehouse=self.other_warehouse)
        self.snapshot(day=REFERENCE + timedelta(days=1), status="DRAFT")
        self.snapshot(warehouse=self.other_warehouse, day=REFERENCE + timedelta(days=1), origin="operacional_registrado")
        filtered = self.costs(warehouse=str(self.other_warehouse.pk), date_to=str(REFERENCE + timedelta(days=1)))
        self.assertEqual(filtered["daily_series"][0]["bulletin_count"], 1)
        self.assertIsNone(filtered["daily_series"][1]["total_payable"])
        self.assertEqual(filtered["weekly_supplement"]["leaders"], [str(self.other_warehouse.pk)])
        empty = self.costs(origin="historico_importado")
        self.assertIsNone(empty["daily_series"][0]["production"])
        self.assertEqual(empty["weekly_supplement"]["closed_bulletins"], 0)
        self.client.force_authenticate(self.external)
        self.assertEqual(self.client.get("/api/v2/analytics/labor-costs/", self.filters).status_code, 403)

    def departure(self, *, first=None, gate=True):
        supplier, _ = Supplier.objects.get_or_create(code="TASK4", defaults={"name": "Fornecedor sintético", "origin": "demo_sintetico"})
        invoice = Invoice.objects.create(supplier=supplier, file="test.pdf", sha256="d" * 64, created_by=self.operator)
        slot, _ = GlobalSlot.objects.get_or_create(date=REFERENCE, time="08:00")
        at = datetime.combine(REFERENCE, datetime.min.time()).replace(hour=8, tzinfo=ZoneInfo("America/Sao_Paulo"))
        ap = Appointment.objects.create(supplier=supplier, invoice=invoice, slot=slot, packaging="paletizada",
            origin="demo_sintetico", gate_checked_in_at=at if gate else None,
            gate_checked_out_at=at + timedelta(hours=3), created_by=self.operator)
        WarehouseVisit.objects.create(appointment=ap, warehouse=self.warehouse, sequence=1,
            checked_in_at=at + timedelta(minutes=first) if first is not None else None)
        WarehouseVisit.objects.create(appointment=ap, warehouse=self.other_warehouse, sequence=2,
            checked_in_at=at + timedelta(minutes=150))
        return ap

    def test_wait_attribution_does_not_repeat_in_later_destination(self):
        self.departure(first=135)
        data = self.client.get("/api/v2/analytics/operations/", self.filters).data
        self.assertEqual(len(data["gate_wait_by_warehouse"]), 1)
        row = data["gate_wait_by_warehouse"][0]
        self.assertEqual(row["warehouse"], str(self.warehouse.pk))
        self.assertEqual(row["average_minutes"], 135)
        self.assertEqual(row["valid_records"], 1)
        other = self.client.get("/api/v2/analytics/operations/", {**self.filters, "warehouse": str(self.other_warehouse.pk)}).data
        self.assertEqual(other["gate_wait_by_warehouse"], [])

    def test_median_resists_one_typo_and_filter_applies_to_overall_wait(self):
        for first in (10, 12, 170):
            self.departure(first=first)
        data = self.client.get("/api/v2/analytics/operations/", self.filters).data
        self.assertEqual(data["average_gate_wait_minutes"], (10 + 12 + 170) / 3)
        self.assertEqual(data["median_gate_wait_minutes"], 12)
        self.assertEqual(data["median_total_stay_minutes"], 180)
        other = self.client.get("/api/v2/analytics/operations/", {**self.filters, "warehouse": str(self.other_warehouse.pk)}).data
        self.assertIsNone(other["average_gate_wait_minutes"])
        self.assertIsNone(other["median_gate_wait_minutes"])
        self.assertEqual(other["coverage"]["excluded_gate_wait_records"], 0)

    def test_invalid_and_missing_waits_never_use_later_visits(self):
        self.departure(first=0)
        self.departure(first=None)
        self.departure(first=-5)
        self.departure(first=200)
        self.departure(first=10, gate=False)
        data = self.client.get("/api/v2/analytics/operations/", self.filters).data
        row = data["gate_wait_by_warehouse"][0]
        self.assertEqual(row["average_minutes"], 0)
        self.assertEqual(row["valid_records"], 1)
        self.assertEqual(row["excluded_records"], 4)
        self.assertEqual(data["coverage"]["excluded_gate_wait_records"], 4)

    def test_wait_population_uses_gate_exit_date_and_historical_is_unavailable(self):
        ap = self.departure(first=15)
        ap.gate_checked_out_at += timedelta(days=1)
        ap.save(update_fields=["gate_checked_out_at"])
        data = self.client.get("/api/v2/analytics/operations/", self.filters).data
        self.assertEqual(data["gate_wait_by_warehouse"], [])
        next_day = {**self.filters, "date_from": str(REFERENCE + timedelta(days=1)), "date_to": str(REFERENCE + timedelta(days=1))}
        self.assertEqual(self.client.get("/api/v2/analytics/operations/", next_day).data["gate_wait_by_warehouse"][0]["average_minutes"], 15)
        historical = self.client.get("/api/v2/analytics/operations/", {**self.filters, "origin": "historico_importado"}).data
        self.assertIsNone(historical["gate_wait_by_warehouse"])

    def test_series_rereads_real_closed_snapshot_after_reopen_edit_close(self):
        bulletin = close_bulletin(stored_bulletin(self).pk, self.operator, 1)
        before = self.costs()["daily_series"][0]["production"]
        bulletin = reopen_bulletin(bulletin.pk, self.operator, bulletin.revision, "Correção sintética para verificar releitura")
        self.assertIsNone(self.costs()["daily_series"][0]["production"])
        raw = official_payload(self.warehouse, self.workers)
        raw["lines"] = []
        serializer = BulletinInput(data=raw)
        serializer.is_valid(raise_exception=True)
        replace_contents(bulletin, serializer.validated_data)
        close_bulletin(bulletin.pk, self.operator, bulletin.revision)
        after = self.costs()["daily_series"][0]
        self.assertNotEqual(before, after["production"])
        self.assertEqual(Decimal(after["production"]), 0)
        self.assertEqual(Decimal(after["supplement"]), Decimal("991.9041"))
