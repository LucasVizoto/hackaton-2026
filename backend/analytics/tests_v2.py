from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from analytics.views_v2 import LaborCostsV2View, OperationsV2View, StaffingScenarioV2View
from catalog.models import Supplier
from core.models import UserProfile
from labor.models import LaborActivity, WorkerDay
from labor.services import close_bulletin
from labor.tests import REFERENCE, labor_fixtures, stored_bulletin
from receiving.models import Appointment, GlobalSlot, Invoice, WarehouseVisit


class V2IndicatorTests(TestCase):
    def setUp(self):
        labor_fixtures(self)
        self.factory = APIRequestFactory()
        self.filters = {"date_from": str(REFERENCE), "date_to": str(REFERENCE), "origin": "demo_sintetico"}

    def call(self, view, data=None, *, post=False, user=None):
        request = self.factory.post("/", data, format="json") if post else self.factory.get("/", data or self.filters)
        force_authenticate(request, user=user or self.manager)
        return view.as_view()(request)

    def close_v2(self):
        bulletin = stored_bulletin(self)
        bulletin.financial_version = "boletim-v2"
        bulletin.save(update_fields=["financial_version"])
        return close_bulletin(bulletin.pk, self.operator, bulletin.revision)

    def test_individual_display_reconciles_and_activity_locations_do_not_duplicate_pay(self):
        bulletin = self.close_v2()
        day = bulletin.allocations.first().worker_day
        for warehouse in (self.warehouse, self.other_warehouse):
            LaborActivity.objects.create(worker_day=day, warehouse=warehouse, activity_type="INTERNAL",
                                         attendance_state="PRESENT", used=True, created_by=self.operator)
        response = self.call(LaborCostsV2View)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["reconciliation"]["difference"], "0.00")
        self.assertEqual(response.data["reconciliation"]["individual_display_total"], "991.90")
        self.assertEqual(response.data["presence"]["present"], 1)
        self.assertEqual(response.data["presence"]["used"], 1)
        rows = response.data["individuals"]["records"]
        self.assertEqual(len(rows), 11)
        self.assertEqual(sum(Decimal(row["display"]["total_payable"]) for row in rows), Decimal("991.90"))
        worker = next(row for row in rows if row["worker"] == str(day.worker_id))
        self.assertEqual(len(worker["activity_warehouses"]), 2)
        self.assertEqual(len(worker["cost_warehouses"]), 1)

    def test_legacy_totals_do_not_invent_nominal_allocations(self):
        close_bulletin(stored_bulletin(self).pk, self.operator, 1)
        data = self.call(LaborCostsV2View).data
        self.assertEqual(data["reconciliation"]["legacy_bulletins_without_allocations"], 1)
        self.assertIsNone(data["reconciliation"]["individual_display_total"])
        self.assertIsNone(data["reconciliation"]["difference"])
        self.assertEqual(data["individuals"]["count"], 0)

    def test_presence_counts_person_days_not_unique_people_or_activity_rows(self):
        for offset in (0, 1):
            day = WorkerDay.objects.create(worker=self.workers[0], reference_date=REFERENCE + timedelta(days=offset), origin='demo_sintetico')
            for warehouse in (self.warehouse, self.other_warehouse):
                LaborActivity.objects.create(worker_day=day, warehouse=warehouse, activity_type='INTERNAL',
                    attendance_state='PRESENT', used=True, created_by=self.operator)
        data = self.call(LaborCostsV2View, {**self.filters, 'date_to': str(REFERENCE + timedelta(days=1))}).data
        self.assertEqual(data['presence']['present'], 2)
        self.assertEqual(data['presence']['used'], 2)
        self.assertEqual(data['presence']['coverage'], 2)
        self.assertEqual(data['presence']['unit'], 'pessoa/dia distinta com atividade registrada')

    def test_gatehouse_cannot_query_pay_or_scenarios(self):
        gate = User.objects.create_user("analytics-gate")
        UserProfile.objects.create(user=gate, role="gatehouse")
        self.assertEqual(self.call(LaborCostsV2View, user=gate).status_code, 403)
        self.assertEqual(self.call(StaffingScenarioV2View, {}, post=True, user=gate).status_code, 403)

    def test_total_stay_uses_gate_exit_instead_of_unloading_finish(self):
        supplier = Supplier.objects.create(code="V2-SUP", name="Fornecedor sintético", origin="demo_sintetico")
        invoice = Invoice.objects.create(supplier=supplier, file="test.pdf", sha256="a"*64, created_by=self.operator)
        slot = GlobalSlot.objects.create(date=REFERENCE, time="08:00")
        at = datetime(2026, 10, 5, 8, tzinfo=ZoneInfo("America/Sao_Paulo"))
        appointment = Appointment.objects.create(supplier=supplier, invoice=invoice, slot=slot, packaging="paletizada",
            origin="demo_sintetico", operation_status="completed", arrived_at=at, started_at=at+timedelta(minutes=10),
            finished_at=at+timedelta(minutes=40), gate_checked_in_at=at, gate_checked_out_at=at+timedelta(minutes=65),
            created_by=self.operator)
        for sequence, warehouse in enumerate((self.warehouse, self.other_warehouse), 1):
            start = at + timedelta(minutes=10 if sequence == 1 else 25)
            WarehouseVisit.objects.create(appointment=appointment, warehouse=warehouse, sequence=sequence,
                checked_in_at=start, checked_out_at=start+timedelta(minutes=15))
        data = self.call(OperationsV2View).data
        self.assertEqual(data["received_loads"], 1)
        self.assertEqual(data["departed_loads"], 1)
        self.assertEqual(data["average_gate_wait_minutes"], 10)
        self.assertEqual(data["average_total_stay_minutes"], 65)
        self.assertEqual(len(data["warehouse_stays"]), 2)
        self.assertTrue(all(row["average_minutes"] == 15 for row in data["warehouse_stays"]))
        appointment.gate_checked_in_at = appointment.gate_checked_out_at = None
        appointment.save()
        missing = self.call(OperationsV2View).data
        self.assertIsNone(missing["average_total_stay_minutes"])
        self.assertEqual(missing["received_loads"], 1)

    def test_scenario_constraints_reject_infeasibility_without_asserting_savings(self):
        bulletin = self.close_v2()
        response = self.call(StaffingScenarioV2View, {"bulletin": str(bulletin.pk), "equivalent_days": "10",
            "minimum_equivalent_days": "11", "required_equipment": 2, "available_equipment": 1}, post=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["feasibility"], "infeasible")
        self.assertEqual(len(response.data["constraint_failures"]), 2)
        self.assertTrue(response.data["conditional"])

    def test_presence_location_filter_does_not_reassign_financial_ownership(self):
        bulletin = self.close_v2()
        day = bulletin.allocations.first().worker_day
        LaborActivity.objects.create(worker_day=day, warehouse=self.other_warehouse, activity_type="INTERNAL",
                                     attendance_state="PRESENT", used=True, created_by=self.operator)
        owner = self.call(LaborCostsV2View, {**self.filters, "warehouse": str(self.warehouse.pk)}).data
        activity = self.call(LaborCostsV2View, {**self.filters, "warehouse": str(self.other_warehouse.pk)}).data
        self.assertEqual(owner["reconciliation"]["individual_display_total"], "991.90")
        self.assertEqual(owner["presence"]["present"], 0)
        self.assertEqual(activity["individuals"]["count"], 0)
        self.assertEqual(activity["presence"]["present"], 1)
        self.assertIsNone(activity["reconciliation"]["individual_display_total"])

    def test_warehouse_duration_uses_each_visit_exit_period_not_booking_or_gate_exit(self):
        supplier = Supplier.objects.create(code="V2-CROSS-DAY", name="Fornecedor sintético", origin="demo_sintetico")
        invoice = Invoice.objects.create(supplier=supplier, file="test.pdf", sha256="c"*64, created_by=self.operator)
        slot = GlobalSlot.objects.create(date=REFERENCE, time="08:00")
        at = datetime.combine(REFERENCE, datetime.min.time()).replace(hour=8, tzinfo=ZoneInfo("America/Sao_Paulo"))
        ap = Appointment.objects.create(supplier=supplier, invoice=invoice, slot=slot, packaging="paletizada",
            origin="demo_sintetico", operation_status="completed", gate_checked_in_at=at,
            gate_checked_out_at=at+timedelta(days=1), created_by=self.operator)
        WarehouseVisit.objects.create(appointment=ap, warehouse=self.warehouse, sequence=1,
            checked_in_at=at+timedelta(minutes=15), checked_out_at=at+timedelta(minutes=45))
        data = self.call(OperationsV2View).data
        self.assertEqual(data["departed_loads"], 0)
        self.assertIsNone(data["average_total_stay_minutes"])
        self.assertEqual(data["warehouse_stays"][0]["average_minutes"], 30)
