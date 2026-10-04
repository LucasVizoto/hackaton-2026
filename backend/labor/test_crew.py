from datetime import timedelta

from django.test import TestCase
from rest_framework.exceptions import ValidationError

from catalog.models import Equipment, Worker
from labor.models import LaborActivity, RosterShift
from receiving.tests import AT, DAY, RESOURCES
from receiving import tests_v2


class CrewTests(TestCase):
    """Equipe da descarga: nomes por etapa, equipamentos do armazém e registro na saída."""
    setUp = tests_v2.ReceivingV2Tests.setUp
    create = tests_v2.ReceivingV2Tests.create
    command = tests_v2.ReceivingV2Tests.command
    approve = tests_v2.ReceivingV2Tests.approve
    arrive = tests_v2.ReceivingV2Tests.arrive
    line = tests_v2.ReceivingV2Tests.line

    def started(self, warehouses=None):
        ap = self.create()
        self.approve(ap, warehouses)
        self.arrive(ap)
        return ap

    def workers(self, count=3):
        return [Worker.objects.create(registration=f"CREW-{i}", name=f"Chapa sintético {i}", origin="demo_sintetico")
                for i in range(count)]

    def test_suggestion_crew_names_and_roster_presence(self):
        ap = self.started()
        visit = ap.visits.get()
        people = self.workers()
        RosterShift.objects.create(worker=people[0], date=DAY, origin="demo_sintetico", created_by=self.operator,
                                   updated_by=self.operator)
        self.client.force_authenticate(self.operator)
        url = f"/api/v2/allocation/visits/{visit.pk}/crew/"
        data = self.client.get(url).data
        self.assertNotIn("suggestion", data)
        self.assertEqual([p["id"] for p in data["people"]], [str(people[0].pk)])
        self.assertEqual(len(data["others"]), 2)
        response = self.client.post(url, {"worker_ids": [str(people[0].pk), str(people[1].pk)], "equipment_ids": []},
                                    format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["crew"]), 2)
        self.assertEqual(LaborActivity.objects.filter(appointment=ap, activity_type="RECEIVING", used=True).count(), 2)
        self.assertEqual(set(RosterShift.objects.filter(date=DAY).values_list("attendance", flat=True)), {"PRESENT"})
        response = self.client.post(url, {"worker_ids": [str(people[1].pk)]}, format="json")
        self.assertEqual(response.data["crew"], [str(people[1].pk)])

    def test_absent_and_foreign_fixed_equipment_refused(self):
        ap = self.started([self.second_warehouse.pk])
        visit = ap.visits.get()
        person = self.workers(1)[0]
        RosterShift.objects.create(worker=person, date=DAY, origin="demo_sintetico", attendance="ABSENT",
                                   created_by=self.operator, updated_by=self.operator)
        self.client.force_authenticate(self.operator)
        url = f"/api/v2/allocation/visits/{visit.pk}/crew/"
        self.assertEqual(self.client.post(url, {"worker_ids": [str(person.pk)]}, format="json").status_code, 400)
        fixed = Equipment.objects.create(code="FIX-A", name="Fixa do A", warehouse=self.warehouse, mobile=False)
        self.assertEqual(self.client.post(url, {"worker_ids": [], "equipment_ids": [str(fixed.pk)]},
                                          format="json").status_code, 400)
        self.assertNotIn(str(fixed.pk), [e["id"] for e in self.client.get(url).data["equipment"]])
        self.command(ap, "check-in", {"visit_id": visit.pk, "occurred_at": AT})
        self.line(ap)
        with self.assertRaises(ValidationError):
            self.command(ap, "check-out", {"visit_id": visit.pk, "occurred_at": AT + timedelta(minutes=30),
                                           **RESOURCES, "equipment_ids": [fixed.pk]})
        self.client.force_authenticate(self.manager if hasattr(self, "manager") else self.purchaser)
        self.assertEqual(self.client.post(url, {"worker_ids": []}, format="json").status_code, 403)

    def test_second_warehouse_with_smaller_crew_completes(self):
        ap = self.started([self.warehouse.pk, self.second_warehouse.pk])
        first, second = list(ap.visits.all())
        self.command(ap, "check-in", {"visit_id": first.pk, "occurred_at": AT})
        self.command(ap, "check-out", {"visit_id": first.pk, "occurred_at": AT + timedelta(minutes=10),
                                       **RESOURCES, "worker_count": 5})
        self.command(ap, "check-in", {"visit_id": second.pk, "occurred_at": AT + timedelta(minutes=20)})
        self.line(ap)
        self.command(ap, "check-out", {"visit_id": second.pk, "occurred_at": AT + timedelta(minutes=30),
                                       **RESOURCES, "worker_count": 2})
        ap.refresh_from_db()
        self.assertEqual((ap.operation_status, ap.worker_count), ("completed", 5))
