import tempfile
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.core.files.base import ContentFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from analytics.views import occupied_minutes
from catalog.models import Equipment, Supplier
from imports.models import HistoricalLaborDay, HistoricalMovement, ImportBatch
from labor.services import close_bulletin
from labor.tests import REFERENCE, labor_fixtures, stored_bulletin
from receiving.models import Appointment, GlobalSlot, Invoice, NonReceipt, WarehouseVisit

AT = datetime(2026, 10, 5, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))


class AnalyticsTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media.cleanup)
        labor_fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        self.supplier = Supplier.objects.create(
            code="AN-SYN", name="Fornecedor sintético analítico", origin="demo_sintetico"
        )
        self.invoice = Invoice.objects.create(
            supplier=self.supplier,
            file=ContentFile(b"%PDF-1.4\nsynthetic\n%%EOF", name="analytic-demo.pdf"),
            original_name="analytic-demo.pdf",
            media_type="application/pdf",
            sha256="1" * 64,
            created_by=self.operator,
            origin="demo_sintetico",
        )
        self.equipment = Equipment.objects.create(
            code="AN-EQ1", name="Máquina sintética 1", warehouse=self.warehouse
        )
        self.other_equipment = Equipment.objects.create(
            code="AN-EQ2", name="Máquina sintética 2", warehouse=self.other_warehouse
        )

    def query(self, origin="demo_sintetico", **extra):
        return {"date_from": str(REFERENCE), "date_to": str(REFERENCE), "origin": origin, **extra}

    def truck(self, *, origin="demo_sintetico", missing_times=False):
        slot, _ = GlobalSlot.objects.get_or_create(date=REFERENCE, time="08:00")
        appointment = Appointment.objects.create(
            supplier=self.supplier,
            invoice=self.invoice,
            slot=slot,
            packaging="paletizada",
            origin=origin,
            operation_status="completed",
            arrived_at=None if missing_times else AT,
            started_at=None if missing_times else AT + timedelta(minutes=10),
            finished_at=AT + timedelta(minutes=40),
            worker_count=None if missing_times else 2,
            resources_confirmed=not missing_times,
            created_by=self.operator,
        )
        for sequence, warehouse in enumerate([self.warehouse, self.other_warehouse], 1):
            WarehouseVisit.objects.create(
                appointment=appointment,
                warehouse=warehouse,
                sequence=sequence,
                started_at=None
                if missing_times
                else AT + timedelta(minutes=10 if sequence == 1 else 25),
                finished_at=None
                if missing_times
                else AT + timedelta(minutes=25 if sequence == 1 else 40),
                worker_count=None if missing_times else 2,
                resources_confirmed=not missing_times,
            )
        return appointment

    def test_historical_financial_gaps_are_unavailable_and_rh_not_cost(self):
        batch = ImportBatch.objects.create(
            kind="csv",
            file_hash="a" * 64,
            importer_version="test1",
            source_name="synthetic-history.csv",
        )
        HistoricalLaborDay.objects.create(
            batch=batch,
            source_row=2,
            day=REFERENCE,
            worker_count=11,
            coffee_worker_count=2,
            payroll_paid=Decimal("999999"),
        )
        result = self.client.get(
            "/api/v1/analytics/labor-costs/", self.query("historico_importado")
        )
        self.assertEqual(result.status_code, 200)
        self.assertIsNone(result.data["summary"]["total_payable"])
        self.assertIsNone(result.data["summary"]["production"])
        self.assertIsNone(result.data["summary"]["supplement"])
        self.assertEqual(result.data["coverage"]["closed_bulletins"], 0)
        self.assertEqual(result.data["coverage"]["covered_dates"], [])
        self.assertIsNone(result.data["coverage"]["coverage_ratio"])

    def test_financial_filter_synthetic_and_draft_do_not_enter_operational(self):
        closed = close_bulletin(stored_bulletin(self).id, self.operator, 1)
        stored_bulletin(self, warehouse=self.other_warehouse)
        actual = self.client.get(
            "/api/v1/analytics/labor-costs/", self.query("operacional_registrado")
        )
        self.assertIsNone(actual.data["summary"]["total_payable"])
        demo = self.client.get("/api/v1/analytics/labor-costs/", self.query())
        self.assertTrue(demo.data["synthetic"])
        self.assertEqual(demo.data["summary"]["bulletin_count"], 1)
        self.assertEqual(demo.data["coverage"]["covered_warehouses"], 1)
        self.assertEqual(Decimal(demo.data["summary"]["total_payable"]), Decimal("991.9041"))
        self.assertEqual(demo.data["groups"][0]["warehouse"], str(closed.warehouse_id))
        self.assertIn("não comprova ociosidade", demo.data["groups"][0]["evidence"])

    def test_each_local_floor_applied_before_period_sum(self):
        rich = stored_bulletin(
            self,
            people=[{"worker": str(self.workers[0].id), "fraction": "1"}],
            lines=[
                {"category": "FERTILIZANTES", "unloading": "4000", "removal": "0", "transfer": "0"}
            ],
        )
        poor = stored_bulletin(
            self,
            warehouse=self.other_warehouse,
            people=[{"worker": str(self.workers[1].id), "fraction": "1"}],
            lines=[],
        )
        close_bulletin(rich.id, self.operator, 1)
        close_bulletin(poor.id, self.operator, 1)
        result = self.client.get("/api/v1/analytics/labor-costs/", self.query()).data
        self.assertEqual(Decimal(result["summary"]["production"]), Decimal("1289.6"))
        self.assertEqual(Decimal(result["summary"]["supplement"]), Decimal("90.1731"))
        self.assertEqual(Decimal(result["summary"]["total_payable"]), Decimal("1379.7731"))
        self.assertEqual(len(result["groups"]), 2)

    def test_people_deduplicated_between_locals_but_fractions_and_cost_not_dropped(self):
        people = [{"worker": str(self.workers[0].id), "fraction": "0.5"}]
        for warehouse in [self.warehouse, self.other_warehouse]:
            bulletin = stored_bulletin(self, warehouse=warehouse, people=people, lines=[])
            close_bulletin(bulletin.id, self.operator, 1)
        result = self.client.get("/api/v1/analytics/labor-costs/", self.query()).data
        self.assertEqual(result["summary"]["people_count"], 1)
        self.assertEqual(Decimal(result["summary"]["equivalent_days"]), Decimal("1"))
        self.assertEqual(Decimal(result["summary"]["total_payable"]), Decimal("90.1731"))
        self.assertEqual(result["summary"]["bulletin_count"], 2)
        self.assertEqual(sum(group["people_count"] for group in result["groups"]), 2)

    def test_conditional_scenario_keeps_production_and_does_not_modify_bulletin(self):
        bulletin = close_bulletin(stored_bulletin(self).id, self.operator, 1)
        calculation = dict(bulletin.calculation)
        revision = bulletin.revision
        result = self.client.post(
            "/api/v1/analytics/staffing-scenario/",
            {"bulletin": str(bulletin.id), "equivalent_days": "10.5"},
            format="json",
        )
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data["conditional"])
        self.assertEqual(result.data["nature"], "cenario")
        self.assertEqual(Decimal(result.data["scenario"]["production"]), Decimal("918.1952"))
        self.assertEqual(Decimal(result.data["scenario"]["total_payable"]), Decimal("946.81755"))
        self.assertEqual(Decimal(result.data["difference"]), Decimal("45.08655"))
        self.assertEqual(result.data["display_difference"], "45.09")
        self.assertIn("não representa economia garantida", " ".join(result.data["assumptions"]))
        bulletin.refresh_from_db()
        self.assertEqual(bulletin.calculation, calculation)
        self.assertEqual(bulletin.revision, revision)

    def test_scenario_never_pays_less_than_production_and_validates_half_multiples(self):
        bulletin = close_bulletin(stored_bulletin(self).id, self.operator, 1)
        result = self.client.post(
            "/api/v1/analytics/staffing-scenario/",
            {"bulletin": str(bulletin.id), "equivalent_days": "0.5"},
            format="json",
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(Decimal(result.data["scenario"]["total_payable"]), Decimal("918.1952"))
        for days in ["0", "0.7", "21", "NaN"]:
            self.assertEqual(
                self.client.post(
                    "/api/v1/analytics/staffing-scenario/",
                    {"bulletin": str(bulletin.id), "equivalent_days": days},
                    format="json",
                ).status_code,
                400,
            )
        draft = stored_bulletin(self, warehouse=self.other_warehouse)
        self.assertEqual(
            self.client.post(
                "/api/v1/analytics/staffing-scenario/",
                {"bulletin": str(draft.id), "equivalent_days": "1"},
                format="json",
            ).status_code,
            404,
        )

    def test_multiwarehouse_truck_count_global_times_resources_and_equipment_are_not_summed(self):
        appointment = self.truck()
        appointment.equipment.add(self.equipment)
        for visit in appointment.visits.all():
            visit.equipment.add(self.equipment)
        result = self.client.get("/api/v1/analytics/operations/", self.query()).data
        self.assertEqual(result["received_loads"], 1)
        self.assertEqual(result["average_wait_minutes"], 10)
        self.assertEqual(result["average_unloading_minutes"], 30)
        self.assertEqual(result["average_workers_per_receipt"], 2)
        self.assertEqual(sum(local["count"] for local in result["loads_by_warehouse"]), 2)
        self.assertEqual(
            [local["occupied_minutes"] for local in result["loads_by_warehouse"]], [15, 15]
        )
        self.assertEqual(result["equipment"][0]["received_loads"], 1)
        self.assertIsNone(result["equipment"][0]["occupied_minutes"])
        self.assertTrue(
            all(local["utilization_percent"] is None for local in result["loads_by_warehouse"])
        )

    def test_missing_operational_times_and_resource_confirmations_are_not_fabricated(self):
        self.truck(missing_times=True)
        result = self.client.get("/api/v1/analytics/operations/", self.query()).data
        self.assertEqual(result["received_loads"], 1)
        self.assertIsNone(result["average_wait_minutes"])
        self.assertIsNone(result["average_unloading_minutes"])
        self.assertIsNone(result["average_workers_per_receipt"])
        self.assertEqual(result["coverage"]["valid_wait_records"], 0)
        self.assertEqual(result["coverage"]["excluded_wait_records"], 1)
        self.assertTrue(
            all(local["occupied_minutes"] is None for local in result["loads_by_warehouse"])
        )

    def test_historical_documents_not_trucks_and_order_weight_not_summed(self):
        active = ImportBatch.objects.create(
            kind="movements",
            file_hash="b" * 64,
            importer_version="test1",
            source_name="synthetic-history.xlsx",
        )
        inactive = ImportBatch.objects.create(
            kind="movements",
            file_hash="c" * 64,
            importer_version="test1",
            source_name="synthetic-old.xlsx",
            active=False,
        )
        for row, batch in [(2, active), (3, active), (4, inactive)]:
            HistoricalMovement.objects.create(
                batch=batch,
                source_sheet="Demo",
                source_row=row,
                purchase_order="SYN-PO",
                receipt_number="SYN-RECEIPT",
                depot="SYN-DEPOT",
                received_on=REFERENCE,
                reported_order_weight=Decimal("1000"),
                quantity=Decimal("100"),
            )
        result = self.client.get(
            "/api/v1/analytics/operations/", self.query("historico_importado")
        ).data
        self.assertEqual(result["historical_documentary"]["rows"], 2)
        self.assertEqual(result["historical_documentary"]["purchase_orders"], 1)
        self.assertEqual(result["historical_documentary"]["receipt_numbers"], 1)
        self.assertIsNone(result["received_loads"])
        self.assertIsNone(result["average_wait_minutes"])
        self.assertIsNone(result["average_unloading_minutes"])
        self.assertNotIn("weight", result["historical_documentary"])

    def test_avulso_nonreceipt_counts_and_origin_filters_do_not_mix(self):
        NonReceipt.objects.create(
            reason="unscheduled_no_capacity",
            description="Ocorrência avulsa sintética",
            occurred_at=AT,
            created_by=self.operator,
            origin="demo_sintetico",
        )
        NonReceipt.objects.create(
            reason="other",
            description="Registro operacional isolado para teste",
            occurred_at=AT,
            created_by=self.operator,
            origin="operacional_registrado",
        )
        demo = self.client.get("/api/v1/analytics/operations/", self.query()).data
        self.assertEqual(
            demo["non_receipts_by_reason"], [{"reason": "unscheduled_no_capacity", "count": 1}]
        )
        actual = self.client.get(
            "/api/v1/analytics/operations/", self.query("operacional_registrado")
        ).data
        self.assertEqual(actual["non_receipts_by_reason"], [{"reason": "other", "count": 1}])

    def test_local_equipment_filter_does_not_attribute_other_destination_equipment(self):
        appointment = self.truck()
        first, second = list(appointment.visits.all())
        first.equipment.add(self.equipment)
        second.equipment.add(self.other_equipment)
        appointment.equipment.add(self.equipment, self.other_equipment)
        result = self.client.get(
            "/api/v1/analytics/operations/", self.query(warehouse=str(self.warehouse.id))
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["received_loads"], 1)
        self.assertEqual(
            [row["equipment"] for row in result.data["equipment"]], [str(self.equipment.id)]
        )

    def test_filters_and_permissions_validation(self):
        for query in [
            self.query(date_from="bad"),
            self.query(date_from="2026-10-06"),
            self.query(origin="unavailable"),
            self.query(warehouse="not-uuid"),
        ]:
            self.assertEqual(
                self.client.get("/api/v1/analytics/labor-costs/", query).status_code, 400
            )
        self.client.force_authenticate(self.external)
        for endpoint in ["operations", "labor-costs"]:
            self.assertEqual(
                self.client.get(f"/api/v1/analytics/{endpoint}/", self.query()).status_code, 403
            )
        self.assertEqual(
            self.client.post("/api/v1/analytics/staffing-scenario/", {}, format="json").status_code,
            403,
        )

    def test_occupied_intervals_union_avoids_double_utilization_count(self):
        intervals = [
            (AT, AT + timedelta(minutes=20)),
            (AT + timedelta(minutes=10), AT + timedelta(minutes=30)),
            (AT + timedelta(minutes=40), AT + timedelta(minutes=50)),
        ]
        self.assertEqual(occupied_minutes(intervals), 40)

    def test_source_records_match_completed_date_and_local_not_booking_date(self):
        appointment = self.truck()
        appointment.slot.date = REFERENCE - timedelta(days=1)
        appointment.slot.save(update_fields=["date"])
        self.truck(origin="operacional_registrado")
        result = self.client.get(
            "/api/v1/analytics/operations/", self.query(warehouse=str(self.warehouse.id))
        ).data
        evidence = result["source_records"]
        self.assertEqual(evidence["count"], result["received_loads"])
        self.assertEqual(evidence["returned_count"], 1)
        self.assertFalse(evidence["truncated"])
        record = evidence["records"][0]
        self.assertEqual(record["id"], str(appointment.pk))
        self.assertEqual(record["slot_date"], str(REFERENCE - timedelta(days=1)))
        self.assertEqual(datetime.fromisoformat(record["finished_at"]), appointment.finished_at)
        self.assertEqual(set(record["warehouse_ids"]), {
            str(self.warehouse.pk), str(self.other_warehouse.pk)
        })
        self.assertNotIn("supplier_name", record)
        self.assertNotIn("invoice_number", record)

    def test_source_bulletins_match_exact_filtered_closed_costs(self):
        closed = close_bulletin(stored_bulletin(self).id, self.operator, 1)
        stored_bulletin(self, warehouse=self.other_warehouse)
        result = self.client.get(
            "/api/v1/analytics/labor-costs/", self.query(warehouse=str(self.warehouse.id))
        ).data
        evidence = result["source_records"]
        self.assertEqual(evidence["count"], result["summary"]["bulletin_count"])
        self.assertEqual(evidence["returned_count"], 1)
        self.assertFalse(evidence["truncated"])
        record = evidence["records"][0]
        self.assertEqual(record["id"], str(closed.pk))
        self.assertEqual(record["reference_date"], str(REFERENCE))
        self.assertEqual(record["warehouse_id"], str(self.warehouse.pk))
        for field in ["production", "equivalent_days", "total_payable", "supplement"]:
            self.assertEqual(record[field], closed.calculation[field])
        self.assertNotIn("participants", record)

    def test_source_records_are_limited_and_deterministic_without_changing_totals(self):
        slot = GlobalSlot.objects.create(date=REFERENCE, time="08:00")
        appointments = [Appointment(
            supplier=self.supplier, invoice=self.invoice, slot=slot,
            packaging="paletizada", origin="demo_sintetico", operation_status="completed",
            finished_at=AT + timedelta(minutes=index), created_by=self.operator,
        ) for index in range(101)]
        Appointment.objects.bulk_create(appointments)
        result = self.client.get("/api/v1/analytics/operations/", self.query()).data
        evidence = result["source_records"]
        self.assertEqual(result["received_loads"], 101)
        self.assertEqual(evidence["count"], 101)
        self.assertEqual(evidence["returned_count"], 100)
        self.assertTrue(evidence["truncated"])
        self.assertEqual(
            [record["id"] for record in evidence["records"]],
            [str(appointment.pk) for appointment in appointments[:100]],
        )

    def test_source_records_require_management_and_history_does_not_invent_links(self):
        self.truck()
        close_bulletin(stored_bulletin(self).id, self.operator, 1)
        self.client.force_authenticate(self.operator)
        for endpoint in ["operations", "labor-costs"]:
            result = self.client.get(f"/api/v1/analytics/{endpoint}/", self.query())
            self.assertEqual(result.status_code, 200)
            self.assertIsNone(result.data["source_records"])
        self.client.force_authenticate(self.manager)
        for endpoint in ["operations", "labor-costs"]:
            result = self.client.get(
                f"/api/v1/analytics/{endpoint}/", self.query("historico_importado")
            )
            self.assertEqual(result.status_code, 200)
            self.assertIsNone(result.data["source_records"])

    def test_source_distributions_use_their_own_dates_and_preserve_avulso(self):
        appointment = self.truck()
        appointment.arrived_at = AT - timedelta(days=1)
        appointment.save(update_fields=["arrived_at"])
        non_receipt = NonReceipt.objects.create(
            reason="unscheduled_no_capacity", description="Ocorrência avulsa sintética",
            occurred_at=AT, created_by=self.operator, origin="demo_sintetico",
        )
        result = self.client.get("/api/v1/analytics/operations/", self.query()).data
        evidence = result["source_records"]
        self.assertEqual(evidence["count"], 1)
        self.assertEqual(evidence["arrivals"]["count"], 0)
        self.assertEqual(result["arrivals_by_hour"], [])
        self.assertEqual(evidence["bookings"]["count"], 1)
        self.assertEqual(evidence["bookings"]["records"], [{
            "id": str(appointment.pk), "slot_date": str(REFERENCE), "slot_time": "08:00"
        }])
        self.assertEqual(evidence["non_receipts"]["count"], 1)
        self.assertEqual(evidence["non_receipts"]["records"][0]["id"], str(non_receipt.pk))
        self.assertIsNone(evidence["non_receipts"]["records"][0]["appointment_id"])
        self.assertNotIn("description", evidence["non_receipts"]["records"][0])
        local = self.client.get(
            "/api/v1/analytics/operations/", self.query(warehouse=str(self.warehouse.pk))
        ).data
        self.assertEqual(local["source_records"]["non_receipts"]["count"], 0)
        self.assertEqual(local["non_receipts_by_reason"], [])
