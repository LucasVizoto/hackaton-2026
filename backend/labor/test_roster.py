from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from catalog.models import Supplier
from labor.models import RosterShift
from labor.tests import labor_fixtures
from receiving.models import Appointment, GlobalSlot, Holiday, Invoice, WarehouseVisit

MONDAY = date(2026, 10, 5)


class RosterTests(TestCase):
    def setUp(self):
        labor_fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.operator)

    def schedule(self, worker, day=MONDAY, **extra):
        return self.client.post("/api/v2/roster/", {"worker": str(worker.pk), "date": str(day), "origin": "demo_sintetico",
                                                    "warehouse": str(self.warehouse.pk), **extra}, format="json")

    def week(self):
        return self.client.get("/api/v2/roster/", {"date_from": "2026-10-05", "date_to": "2026-10-11",
                                                   "origin": "demo_sintetico"}).data

    def batida(self):
        supplier = Supplier.objects.create(code="S", name="Fornecedor")
        invoice = Invoice.objects.create(supplier=supplier, file="x.pdf", original_name="x.pdf", media_type="application/pdf",
                                         sha256="0" * 64, created_by=self.operator, origin="demo_sintetico",
                                         extracted={"volumes": [{"quantity": "200", "gross_weight": "10000"}]})
        slot = GlobalSlot.objects.create(date=MONDAY, time="08:00")
        appointment = Appointment.objects.create(supplier=supplier, invoice=invoice, slot=slot, packaging="batida",
                                                 created_by=self.operator, origin="demo_sintetico")
        WarehouseVisit.objects.create(appointment=appointment, warehouse=self.warehouse, sequence=1)

    def test_shortage_against_agenda_peak_then_ok(self):
        self.batida()
        for worker in self.workers[:3]:
            self.assertEqual(self.schedule(worker).status_code, 201)
        monday = self.week()["days"][0]
        self.assertEqual(monday["plan"]["peak_chapas"], 5)
        self.assertEqual(monday["balance"]["status"], "shortage")
        for worker in self.workers[3:14]:
            self.schedule(worker)
        self.assertEqual(self.week()["days"][0]["balance"]["status"], "ok")

    def test_one_line_per_person_day_and_half_period(self):
        self.assertEqual(self.schedule(self.workers[0]).status_code, 201)
        response = self.schedule(self.workers[0], period="MORNING")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["fraction"], "0.5")
        self.assertEqual(RosterShift.objects.count(), 1)

    def test_sunday_holiday_inactive_and_demo_mixing_refused(self):
        self.assertEqual(self.schedule(self.workers[0], day=date(2026, 10, 11)).status_code, 400)
        Holiday.objects.create(date=date(2026, 10, 12), description="Feriado")
        self.assertEqual(self.schedule(self.workers[0], day=date(2026, 10, 12)).status_code, 400)
        self.workers[1].is_active = False
        self.workers[1].save()
        self.assertEqual(self.schedule(self.workers[1]).status_code, 400)
        response = self.client.post("/api/v2/roster/", {"worker": str(self.workers[2].pk), "date": str(MONDAY)}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_saturday_is_internal_organization(self):
        response = self.schedule(self.workers[0], day=date(2026, 10, 10))
        self.assertEqual(response.data["activity"], "ORGANIZATION")
        self.assertEqual(self.week()["days"][5]["day_type"], "saturday")

    def test_max_twenty_per_day(self):
        for worker in self.workers[:20]:
            self.schedule(worker)
        self.assertEqual(self.schedule(self.workers[20]).status_code, 400)

    def test_attendance_feeds_bulletin_team(self):
        first = self.schedule(self.workers[0]).data
        second = self.schedule(self.workers[1]).data
        third = self.schedule(self.workers[2]).data
        self.client.patch(f"/api/v2/roster/{first['id']}/", {"attendance": "PRESENT"}, format="json")
        self.client.patch(f"/api/v2/roster/{second['id']}/", {"attendance": "PRESENT", "period": "AFTERNOON"}, format="json")
        self.client.patch(f"/api/v2/roster/{third['id']}/", {"attendance": "ABSENT"}, format="json")
        team = self.client.get("/api/v2/roster/team/", {"date": str(MONDAY), "origin": "demo_sintetico"}).data
        self.assertEqual(sorted(p["fraction"] for p in team["participants"]), ["0.5", "1.0"])
        self.assertEqual(team["absences"], 1)
        monday = self.week()["days"][0]
        self.assertEqual((monday["scheduled_equivalents"], monday["present_equivalents"]), ("1.5", "1.5"))

    def test_copy_week_skips_existing_and_management_is_read_only(self):
        self.schedule(self.workers[0])
        self.schedule(self.workers[1], day=date(2026, 10, 10))
        self.schedule(self.workers[2], day=date(2026, 10, 12))
        response = self.client.post("/api/v2/roster/copy-week/", {"source_week_start": "2026-10-05",
                                                                   "target_week_start": "2026-10-12",
                                                                   "origin": "demo_sintetico"}, format="json")
        self.assertEqual(response.data, {"created": 2, "skipped": 0})
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.get("/api/v2/roster/", {"origin": "demo_sintetico"}).status_code, 200)
        self.assertEqual(self.schedule(self.workers[3]).status_code, 403)
        self.client.force_authenticate(self.external)
        self.assertEqual(self.client.get("/api/v2/roster/").status_code, 403)
