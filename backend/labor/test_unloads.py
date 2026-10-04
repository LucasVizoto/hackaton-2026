from datetime import timedelta

from django.test import TestCase

from catalog.models import Equipment, Worker
from receiving.tests import AT, DAY, RESOURCES
from receiving import tests_v2

URL = f"/api/v2/allocation/unloads/?date={DAY.isoformat()}&origin=demo_sintetico"


class UnloadBoardTests(TestCase):
    """Painel da descarga: cada etapa do dia com situação, equipe, equipamentos e próxima ação."""
    setUp = tests_v2.ReceivingV2Tests.setUp
    create = tests_v2.ReceivingV2Tests.create
    command = tests_v2.ReceivingV2Tests.command
    approve = tests_v2.ReceivingV2Tests.approve
    arrive = tests_v2.ReceivingV2Tests.arrive
    line = tests_v2.ReceivingV2Tests.line

    def board(self, user=None):
        self.client.force_authenticate(user or self.operator)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_stages_follow_the_unload_from_gate_to_exit(self):
        ap = self.create()
        self.assertEqual(self.board()["items"], [], "Sem destinos confirmados ainda não há etapa.")
        self.approve(ap)
        item = self.board()["items"][0]
        self.assertEqual((item["stage"], item["waiting_reason"]), ("waiting", "Aguardando chegada na portaria."))
        self.assertGreater(item["needed_chapas"], 0)
        self.arrive(ap)
        data = self.board()
        item = data["items"][0]
        self.assertEqual(item["stage"], "ready")
        self.assertTrue(item["actions"]["check-in"]["allowed"])
        self.assertEqual(data["summary"]["without_crew"], 1)
        visit = ap.visits.get()
        self.command(ap, "check-in", {"visit_id": visit.pk, "occurred_at": AT})
        self.assertEqual(self.board()["items"][0]["stage"], "running")
        self.line(ap)
        self.command(ap, "check-out", {"visit_id": visit.pk, "occurred_at": AT + timedelta(minutes=30), **RESOURCES})
        data = self.board()
        self.assertEqual((data["items"][0]["stage"], data["items"][0]["worker_count"]), ("done", 2))
        self.assertEqual(data["summary"]["done"], 1)

    def test_crew_and_equipment_belong_to_their_own_stage(self):
        ap = self.create()
        self.approve(ap, [self.warehouse.pk, self.second_warehouse.pk])
        self.arrive(ap)
        first, second = list(ap.visits.all())
        person = Worker.objects.create(registration="UNL-1", name="Chapa sintético", origin="demo_sintetico")
        machine = Equipment.objects.create(code="UNL-E", name="Paleteira sintética", mobile=True)
        self.client.force_authenticate(self.operator)
        response = self.client.post(f"/api/v2/allocation/visits/{first.pk}/crew/",
                                    {"worker_ids": [str(person.pk)], "equipment_ids": [str(machine.pk)]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        items = {item["visit"]: item for item in self.board()["items"]}
        self.assertEqual([p["name"] for p in items[str(first.pk)]["crew"]], ["Chapa sintético"])
        self.assertEqual([e["name"] for e in items[str(first.pk)]["equipment"]], ["Paleteira sintética"])
        self.assertEqual(items[str(second.pk)]["crew"], [])
        self.assertEqual(items[str(second.pk)]["stage"], "waiting")
        self.assertIn(self.warehouse.name, items[str(second.pk)]["waiting_reason"])

    def test_management_reads_without_actions_and_other_origin_is_separate(self):
        self.approve(self.create())
        data = self.board(self.purchaser)
        self.assertFalse(any(action["allowed"] for action in data["items"][0]["actions"].values()))
        self.client.force_authenticate(self.operator)
        other = self.client.get(f"/api/v2/allocation/unloads/?date={DAY.isoformat()}")
        self.assertEqual(other.data["items"], [])
