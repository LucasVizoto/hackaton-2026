from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from catalog.models import Supplier, Warehouse
from core.models import UserProfile
from receiving.models import Appointment, AppointmentInvoice, GlobalSlot, Invoice, WarehouseVisit

ZONE = ZoneInfo("America/Sao_Paulo")
NOW = datetime(2026, 10, 4, 12, tzinfo=ZONE)


class LogisticsTests(TestCase):
    def setUp(self):
        self.manager = User.objects.create_user("logistics-manager")
        UserProfile.objects.create(user=self.manager, role="management")
        self.supplier = Supplier.objects.create(code="LOG", name="Fornecedor de teste")
        self.invoice = Invoice.objects.create(supplier=self.supplier, created_by=self.manager, sha256="a" * 64)
        self.warehouse = Warehouse.objects.create(code="LOG-1", name="Armazém de teste 1")
        self.second_warehouse = Warehouse.objects.create(code="LOG-2", name="Armazém de teste 2")
        self.client = APIClient()
        self.client.force_authenticate(self.manager)

    def truck(self, **changes):
        slot, _ = GlobalSlot.objects.get_or_create(date=NOW.date(), time="08:00")
        return Appointment.objects.create(
            supplier=self.supplier, invoice=self.invoice, slot=slot, packaging="paletizada",
            created_by=self.manager, **changes,
        )

    def snapshot(self, **query):
        with patch("analytics.logistics.timezone.now", return_value=NOW):
            response = self.client.get("/api/v2/analytics/logistics/", query)
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_empty_snapshot_has_seven_observed_zero_days(self):
        data = self.snapshot()
        self.assertEqual(data["reference_date"], "2026-10-04")
        self.assertEqual(data["timezone"], "America/Sao_Paulo")
        self.assertEqual(data["period"], {"date_from": "2026-09-28", "date_to": "2026-10-04"})
        self.assertEqual([row["date"] for row in data["loads_by_date"]],
                         [f"2026-09-{day}" for day in (28, 29, 30)] + [f"2026-10-0{day}" for day in range(1, 5)])
        self.assertEqual(sum(row["count"] for row in data["loads_by_date"]), 0)
        self.assertEqual(data["summary"], {"received_today": 0, "driver_entries_today": 0, "trucks_in_queue": 0})

    def test_local_midnight_origin_and_distinct_destinations(self):
        truck = self.truck(operation_status="completed", finished_at=NOW)
        second_invoice = Invoice.objects.create(supplier=self.supplier, created_by=self.manager, sha256="b" * 64)
        AppointmentInvoice.objects.create(appointment=truck, invoice=second_invoice, position=1)
        for index, warehouse in enumerate((self.warehouse, self.second_warehouse), 1):
            WarehouseVisit.objects.create(appointment=truck, warehouse=warehouse, sequence=index)
        self.truck(operation_status="completed", finished_at=datetime(2026, 10, 4, 2, 59, tzinfo=ZoneInfo("UTC")))
        self.truck(operation_status="completed", finished_at=datetime(2026, 10, 4, 3, 0, tzinfo=ZoneInfo("UTC")))
        self.truck(operation_status="completed", finished_at=NOW - timedelta(days=7))
        for origin in ("demo_sintetico", "historico_importado"):
            self.truck(origin=origin, operation_status="completed", finished_at=NOW, gate_checked_in_at=NOW, driver_name="Outro")
        data = self.snapshot(origin="demo_sintetico")
        self.assertEqual(data["origin"], "operacional_registrado")
        self.assertEqual(data["summary"]["received_today"], 2)
        self.assertEqual(data["loads_by_date"][-2:], [{"date": "2026-10-03", "count": 1}, {"date": "2026-10-04", "count": 2}])
        self.assertEqual([row["count"] for row in data["loads_by_warehouse"]], [1, 1])
        self.assertEqual(data["coverage"]["destination_associations"], 2)
        self.assertEqual(data["coverage"]["completed_without_destination"], 2)

    def test_entries_count_passages_not_names_or_exits_and_report_gaps(self):
        for _ in range(2):
            self.truck(gate_checked_in_at=NOW, gate_checked_out_at=NOW, driver_name="Mesmo motorista", operation_status="completed")
        for name in ("", " \t\n "):
            self.truck(gate_checked_in_at=NOW, driver_name=name)
        self.truck(gate_checked_in_at=NOW - timedelta(days=1), gate_checked_out_at=NOW, driver_name="Ontem")
        data = self.snapshot()
        self.assertEqual(data["summary"]["driver_entries_today"], 2)
        self.assertEqual(data["coverage"]["driver_entries_without_name"], 2)

    def test_queue_includes_older_entries_but_excludes_started_and_terminal_trucks(self):
        self.truck(gate_checked_in_at=NOW - timedelta(days=10), operation_status="arrived")
        for status in ("in_progress", "completed", "not_received", "cancelled"):
            self.truck(gate_checked_in_at=NOW, operation_status=status)
        self.truck(operation_status="waiting")
        self.truck(gate_checked_in_at=NOW, gate_checked_out_at=NOW, operation_status="arrived")
        self.truck(gate_checked_in_at=NOW, started_at=NOW, operation_status="arrived")
        for field in ("checked_in_at", "started_at"):
            truck = self.truck(gate_checked_in_at=NOW, operation_status="arrived")
            WarehouseVisit.objects.create(appointment=truck, warehouse=self.warehouse, sequence=1, **{field: NOW})
        self.assertEqual(self.snapshot()["summary"]["trucks_in_queue"], 1)

    def test_totals_are_not_limited_to_a_list_page(self):
        for _ in range(105):
            self.truck(operation_status="completed", finished_at=NOW)
        self.assertEqual(self.snapshot()["summary"]["received_today"], 105)

    def test_dashboard_is_internal_read_only(self):
        for role in ("management", "warehouse", "purchasing", "admin", "supplier", "gatehouse", "portaria"):
            user = User.objects.create_user(f"logistics-{role}")
            UserProfile.objects.create(user=user, role=role)
            self.client.force_authenticate(user)
            response = self.client.get("/api/v2/analytics/logistics/")
            self.assertEqual(response.status_code, 200 if role in {"management", "warehouse", "purchasing", "admin"} else 403, role)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post("/api/v2/analytics/logistics/", {}).status_code, 405)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/v2/analytics/logistics/").status_code, 401)
