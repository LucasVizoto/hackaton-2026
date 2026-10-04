import tempfile
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.models import UserProfile

from . import services, workflow
from .models import GateArrival
from .tests import AT, DAY, fixtures


class GateArrivalLinkTests(TestCase):
    """Aceitar a chegada vinculada a uma reserva registra a entrada; é isso que a agenda enxerga."""

    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings = override_settings(MEDIA_ROOT=media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        fixtures(self)
        self.gate = User.objects.create_user("gate-link")
        UserProfile.objects.create(user=self.gate, role="portaria")
        self.client = APIClient()
        self.client.force_authenticate(self.operator)

    def arrival(self, at=AT, plate="TEST123", invoice="9001"):
        arrival = GateArrival.objects.create(vehicle_plate=plate, tractor_plate=plate, driver_name="Motorista sintético",
                                             invoice_number=invoice, file="synthetic.png", created_by=self.gate)
        GateArrival.objects.filter(pk=arrival.pk).update(created_at=at)
        arrival.refresh_from_db()
        return arrival

    def v2(self, time="08:00", plate="TEST123"):
        return workflow.create(self.external, {"invoice_ids": [self.invoice], "date": DAY, "time": time,
                               "packaging": "paletizada", "vehicle_plate": plate, "driver_name": ""})

    def decide(self, arrival, **payload):
        return self.client.post(f"/api/v2/gate-arrivals/{arrival.pk}/decision/",
                                {"decision": "authorized", **payload}, format="json")

    def test_candidates_are_waiting_reservations_of_the_arrival_day_with_matches_first(self):
        other = self.v2(time="08:00", plate="OTHER99")
        match = self.v2(time="10:00", plate="TES-T123")
        arrival = self.arrival(invoice="777")  # só a placa (com hífen) identifica a reserva
        rows = self.client.get(f"/api/v2/gate-arrivals/{arrival.pk}/candidates/").data["results"]
        self.assertEqual([row["id"] for row in rows], [str(match.pk), str(other.pk)])
        self.assertTrue(rows[0]["matches"])
        # Chegada em outro dia não oferece a reserva: a entrada precisa ser na data reservada.
        late = self.arrival(at=AT + timedelta(days=1))
        self.assertEqual(self.client.get(f"/api/v2/gate-arrivals/{late.pk}/candidates/").data["results"], [])
        self.client.force_authenticate(self.purchaser)
        self.assertEqual(self.client.get(f"/api/v2/gate-arrivals/{arrival.pk}/candidates/").status_code, 403)

    def test_authorizing_with_v2_reservation_records_gate_entry_by_the_gatehouse(self):
        ap = self.v2()
        arrival = self.arrival()
        response = self.decide(arrival, appointment=str(ap.pk))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["appointment"], ap.pk)
        ap.refresh_from_db()
        self.assertEqual(ap.operation_status, "arrived")
        self.assertEqual(ap.gate_checked_in_at, AT)
        self.assertEqual(ap.driver_name, "Motorista sintético")
        self.assertEqual(ap.events.get(kind="gate_check_in").actor, self.gate)
        # A mesma reserva não recebe uma segunda chegada.
        again = self.decide(self.arrival(), appointment=str(ap.pk))
        self.assertEqual(again.status_code, 400)

    def test_authorizing_with_legacy_reservation_records_arrival(self):
        ap = services.create_appointment(self.external, supplier=self.supplier, invoice=self.invoice,
                                         day=DAY, time="08:00", packaging="paletizada")
        self.assertEqual(self.decide(self.arrival(), appointment=str(ap.pk)).status_code, 200)
        ap.refresh_from_db()
        self.assertEqual((ap.operation_status, ap.arrived_at), ("arrived", AT))

    def test_invalid_link_keeps_arrival_pending_and_reservation_untouched(self):
        ap = self.v2()
        arrival = self.arrival(at=AT + timedelta(days=1))
        self.assertEqual(self.decide(arrival, appointment=str(ap.pk)).status_code, 400)
        rejected = self.decide(self.arrival(), decision="rejected", appointment=str(ap.pk))
        self.assertEqual(rejected.status_code, 400)
        arrival.refresh_from_db()
        ap.refresh_from_db()
        self.assertEqual((arrival.decision, arrival.appointment_id), ("pending", None))
        self.assertEqual(ap.operation_status, "waiting")
        # Sem reserva escolhida, aceitar continua possível, como antes.
        plain = self.decide(self.arrival())
        self.assertEqual((plain.status_code, plain.data["appointment"]), (200, None))
