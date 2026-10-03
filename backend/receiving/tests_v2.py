import hashlib
import tempfile
import threading
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from unittest import skipUnless

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient

from core.models import UserProfile
from . import services, workflow
from .models import (Appointment, Invoice, InvoiceItem, InternalNotification, PurchaseOrder,
                     PurchaseOrderLine, ReceivingException)
from .tests import fixtures, DAY, AT, XML, RESOURCES


@override_settings(ROOT_URLCONF="receiving.test_urls_v2")
class ReceivingV2Tests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        self.override = override_settings(MEDIA_ROOT=self.media.name)
        self.override.enable()
        self.addCleanup(self.override.disable)
        fixtures(self)
        self.invoice.number = "9001"
        self.invoice.save()
        self.item = InvoiceItem.objects.create(invoice=self.invoice, position=1, description="Item sintético",
                    unit="UN", quantity=Decimal("10"), unit_value=Decimal("1"))
        self.gate = User.objects.create_user("gate-v2")
        UserProfile.objects.create(user=self.gate, role="gatehouse")
        self.client = APIClient()

    def second_invoice(self, supplier=None, number="9002"):
        return Invoice.objects.create(supplier=supplier or self.supplier, number=number,
                file=ContentFile(b"%PDF-synthetic", name=f"{number}.pdf"),
                original_name=f"{number}.pdf", media_type="application/pdf",
                sha256=hashlib.sha256(number.encode()).hexdigest(), created_by=self.operator,
                origin="demo_sintetico")

    def create(self, **changes):
        return workflow.create(self.external, {"invoice_ids": [self.invoice], "date": DAY,
                    "time": "08:00", "packaging": "paletizada", "vehicle_plate": "TEST123",
                    **changes})

    def command(self, ap, code, data=None, user=None):
        ap.refresh_from_db()
        return workflow.perform(user or self.operator, ap.pk, code,
                   {"expected_revision": ap.revision, **(data or {})})

    def approve(self, ap, warehouses=None):
        self.command(ap, "purchase-review", {"decision": "approved", "order_reference": "SYN-PO",
                     "comparison_notes": "Conferência sintética"}, self.purchaser)
        return self.command(ap, "warehouse-review", {"warehouse_ids": warehouses or [self.warehouse.pk]})

    def arrive(self, ap):
        return self.command(ap, "gate-check-in", {"occurred_at": AT}, self.gate)

    def line(self, ap, **changes):
        self.command(ap, "receipt-lines", {"invoice": self.invoice.pk, "invoice_item": self.item.pk,
                     "observed_quantity": Decimal("10"), "accepted_quantity": Decimal("10"),
                     "rejected_quantity": Decimal("0"), **changes})
        return ap.receipt_lines.get(invoice_item=self.item)

    def test_multi_invoice_one_slot_unit_and_same_supplier_only(self):
        second = self.second_invoice()
        ap = self.create(invoice_ids=[self.invoice, second])
        self.assertEqual(ap.invoice_links.count(), 2)
        self.assertEqual(services.occupancy(ap.slot)["occupied_units"], 1)
        self.assertFalse(ap.assisted)
        with self.assertRaises(ValidationError):
            self.create(invoice_ids=[self.second_invoice(self.other_supplier)], time="10:00")
        with self.assertRaises(ValidationError):
            self.create(invoice_ids=[self.invoice, self.invoice], time="10:00")

    def test_only_supplier_can_create_through_either_api_including_admin(self):
        admin = User.objects.create_superuser("admin-booking", password="synthetic-only")
        payload = {"supplier": str(self.supplier.pk), "invoice": str(self.invoice.pk),
                   "invoice_ids": [str(self.invoice.pk)], "date": str(DAY), "time": "08:00",
                   "packaging": "paletizada", "vehicle_plate": "TEST123"}
        for user in [self.operator, self.purchaser, self.gate, admin]:
            self.client.force_authenticate(user)
            for version in [1, 2]:
                result = self.client.post(f"/api/v{version}/appointments/", payload, format="json")
                self.assertEqual(result.status_code, 403, (user.username, version, result.data))
        self.assertFalse(Appointment.objects.exists())

    def test_machine_alias_is_canonical_and_range_matches_each_day(self):
        self.client.force_authenticate(self.external)
        result = self.client.post("/api/v2/appointments/", {
            "invoice_ids": [str(self.invoice.pk)], "date": str(DAY), "time": "08:00",
            "packaging": "maquina_implemento", "vehicle_plate": "TEST123"}, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["packaging"], "machine_implement")
        url = "/api/v2/slots/availability/"
        end = DAY + timedelta(days=6)
        result = self.client.get(f"{url}?date_from={DAY}&date_to={end}&packaging=maquina_implemento")
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(len(result.data["days"]), 7)
        for day in result.data["days"]:
            single = self.client.get(f"{url}?date={day['date']}&packaging=machine_implement")
            self.assertEqual(day, single.data)
        self.assertTrue(result.data["days"][0]["slots"][0]["eligible"])
        self.assertFalse(result.data["days"][-1]["calendar_open"])
        for query in [f"date_from={end}&date_to={DAY}", f"date_from={DAY}",
                      f"date_from={DAY}&date_to={DAY + timedelta(days=62)}",
                      f"date={DAY}&date_from={DAY}&date_to={end}"]:
            self.assertEqual(self.client.get(f"{url}?{query}").status_code, 400)

    def test_forward_preserves_arrival_visits_and_reservation_then_requires_both_reviews(self):
        ap = self.create(invoice_ids=[self.invoice, self.second_invoice()])
        self.approve(ap)
        self.arrive(ap)
        visit_id = ap.visits.get().pk
        ap.refresh_from_db()
        command = {"reason": "Documento exige nova conferência", "expected_revision": ap.revision,
                   "idempotency_key": str(uuid.uuid4())}
        self.client.force_authenticate(self.operator)
        url = f"/api/v2/appointments/{ap.pk}/forward-to-purchasing/"
        first = self.client.post(url, command, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(self.client.post(url, command, format="json").status_code, 200)
        ap.refresh_from_db()
        self.assertEqual((ap.purchase_status, ap.warehouse_status), ("pending", "pending"))
        self.assertTrue(ap.capacity_reserved)
        self.assertEqual(ap.gate_checked_in_at, AT)
        self.assertEqual(ap.visits.get().pk, visit_id)
        self.assertEqual(ap.events.filter(kind="forwarded_to_purchasing").count(), 1)
        self.assertEqual(InternalNotification.objects.filter(appointment=ap, kind="invoice_divergence").count(), 1)
        with self.assertRaises(services.DomainConflict):
            self.command(ap, "check-in", {"visit_id": visit_id, "occurred_at": AT})
        self.client.force_authenticate(self.gate)
        details = self.client.get(f"/api/v2/appointments/{ap.pk}/").data
        self.assertNotIn("divergence_notes", details)
        self.assertEqual(self.client.post(url, command, format="json").status_code, 403)
        self.approve(ap)
        self.assertEqual(ap.visits.get().pk, visit_id)
        self.command(ap, "check-in", {"visit_id": visit_id, "occurred_at": AT + timedelta(minutes=10)})
        with self.assertRaises(services.DomainConflict):
            self.command(ap, "forward-to-purchasing", {"reason": "Tarde demais"})
        self.assertEqual(ap.visits.get().checked_in_at, AT + timedelta(minutes=10))

    def test_optional_key_and_manual_number_remain_required_and_consistent(self):
        self.client.force_authenticate(self.external)
        for number, key, expected in [("", "", 400), ("9001", "", 201),
                ("9001", "35261000000000000000550010000090011000000019", 201),
                ("9002", "35261000000000000000550010000090011000000019", 400),
                ("9001", "35261000000000000000550010000090011000000010", 400)]:
            result = self.client.post("/api/v2/invoices/upload/", {
                "file": SimpleUploadedFile("manual.pdf", b"%PDF-synthetic-" + uuid.uuid4().bytes),
                "number": number, "access_key": key}, format="multipart")
            self.assertEqual(result.status_code, expected, result.data)

    def test_machine_shares_and_held_unit_does_not_become_exclusive(self):
        ap = self.create(packaging="machine_implement")
        self.assertEqual(services.occupancy(ap.slot)["occupied_units"], 1)
        self.create(packaging="big_bag")
        with self.assertRaises(services.DomainConflict):
            self.create()
        self.command(ap, "cancel", {"reason": "Teste"})
        hold = ap.capacity_holds.get()
        self.assertFalse(hold.exclusive)
        self.assertEqual(hold.units, 1)
        with self.assertRaises(services.DomainConflict):
            self.create()

    def test_origin_is_derived_and_api_rejects_relabelling(self):
        self.client.force_authenticate(self.external)
        payload = {"invoice_ids": [str(self.invoice.pk)], "date": str(DAY), "time": "08:00",
                   "packaging": "paletizada", "vehicle_plate": "TEST", "origin": "operacional_registrado"}
        response = self.client.post("/api/v2/appointments/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.invoice.origin = "operacional_registrado"
        self.invoice.save()
        with self.assertRaises(ValidationError):
            self.create()

    def test_supplier_booking_and_articulated_validation(self):
        self.client.force_authenticate(self.external)
        payload = {"supplier": str(self.supplier.pk), "invoice_ids": [str(self.invoice.pk)],
                   "date": str(DAY), "time": "08:00", "packaging": "machine_implement",
                   "vehicle_plate": "CARRETA", "articulated": True, "booking_kind": "spontaneous"}
        self.assertEqual(self.client.post("/api/v2/appointments/", payload, format="json").status_code, 400)
        response = self.client.post("/api/v2/appointments/", {**payload, "tractor_plate": "CAVALO",
                   "carrier_name": "Transportadora sintética"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["assisted"])
        self.assertEqual(response.data["booking_kind"], "spontaneous")

    def test_create_and_command_idempotence_replays_stale_revision_without_duplicate(self):
        key = uuid.uuid4()
        ap = self.create(idempotency_key=key)
        self.assertEqual(self.create(idempotency_key=key).pk, ap.pk)
        with self.assertRaises(services.DomainConflict):
            self.create(idempotency_key=key, time="10:00")
        command = {"expected_revision": ap.revision, "occurred_at": AT, "idempotency_key": uuid.uuid4()}
        workflow.perform(self.gate, ap.pk, "gate-check-in", command)
        workflow.perform(self.gate, ap.pk, "gate-check-in", command)
        self.assertEqual(ap.events.filter(kind="gate_check_in").count(), 1)
        self.assertEqual(InternalNotification.objects.filter(appointment=ap, kind="gate_check_in").count(), 1)
        with self.assertRaises(services.DomainConflict):
            workflow.perform(self.gate, ap.pk, "gate-check-in", {**command, "occurred_at": AT + timedelta(minutes=1)})

    def test_four_distinct_marks_and_final_warehouse_requires_receipt(self):
        ap = self.create()
        self.approve(ap)
        self.arrive(ap)
        visit = ap.visits.get()
        self.command(ap, "check-in", {"visit_id": visit.pk, "occurred_at": AT + timedelta(minutes=10)})
        with self.assertRaises(services.DomainConflict):
            self.command(ap, "check-out", {"visit_id": visit.pk, "occurred_at": AT + timedelta(minutes=30), **RESOURCES})
        self.line(ap)
        self.command(ap, "check-out", {"visit_id": visit.pk, "occurred_at": AT + timedelta(minutes=30), **RESOURCES})
        ap.refresh_from_db()
        self.assertEqual(ap.operation_status, "completed")
        self.assertIsNone(ap.gate_checked_out_at)
        self.command(ap, "gate-check-out", {"occurred_at": AT + timedelta(minutes=40)}, self.gate)
        ap.refresh_from_db()
        visit.refresh_from_db()
        self.assertEqual(ap.gate_checked_in_at, AT)
        self.assertEqual(visit.checked_in_at, AT + timedelta(minutes=10))
        self.assertEqual(visit.checked_out_at, AT + timedelta(minutes=30))
        self.assertEqual(ap.gate_checked_out_at, AT + timedelta(minutes=40))

    def test_multiple_warehouses_sequential_and_no_invented_gate_checkout(self):
        ap = self.create()
        self.approve(ap, [self.warehouse.pk, self.second_warehouse.pk])
        self.arrive(ap)
        first, second = list(ap.visits.all())
        with self.assertRaises(services.DomainConflict):
            self.command(ap, "check-in", {"visit_id": second.pk, "occurred_at": AT})
        self.command(ap, "check-in", {"visit_id": first.pk, "occurred_at": AT})
        self.command(ap, "check-out", {"visit_id": first.pk, "occurred_at": AT + timedelta(minutes=10), **RESOURCES})
        self.command(ap, "check-in", {"visit_id": second.pk, "occurred_at": AT + timedelta(minutes=20)})
        ap.refresh_from_db()
        self.assertEqual(ap.operation_status, "in_progress")
        self.assertIsNone(ap.gate_checked_out_at)
        self.assertIsNone(ap.finished_at)

    def test_partial_requires_purchasing_and_invoice_balance_prevents_duplicate_acceptance(self):
        ap = self.create()
        self.arrive(ap)
        line = self.line(ap, observed_quantity=Decimal("6"), accepted_quantity=Decimal("6"),
                         discrepancy_reason="Entrega parcial")
        self.assertEqual(line.decision, "pending")
        self.assertFalse(workflow.receipt_ready(ap)[0])
        with self.assertRaises(PermissionDenied):
            self.command(ap, "receipt-review", {"line_id": line.pk, "decision": "approved", "decision_notes": "Ok"})
        self.command(ap, "receipt-review", {"line_id": line.pk, "decision": "approved", "decision_notes": "Parcial autorizada"}, self.purchaser)
        second = self.create(time="10:00")
        self.arrive(second)
        second_line = self.line(second, observed_quantity=Decimal("5"), accepted_quantity=Decimal("5"),
                                discrepancy_reason="Complemento")
        with self.assertRaises(ValidationError):
            self.command(second, "receipt-review", {"line_id": second_line.pk, "decision": "approved", "decision_notes": "Ok"}, self.purchaser)

    def test_confirmed_order_balance_is_separate_and_complement_reference(self):
        order = PurchaseOrder.objects.create(supplier=self.supplier, reference="P-1",
                    confirmation_notes="Pedido real conferido", confirmed_by=self.purchaser)
        order_line = PurchaseOrderLine.objects.create(order=order, position=1, description="Item",
                    unit="UN", ordered_quantity=Decimal("8"))
        ap = self.create()
        self.arrive(ap)
        line = self.line(ap, observed_quantity=Decimal("6"), accepted_quantity=Decimal("6"),
                         discrepancy_reason="Parcial", purchase_order_line=order_line.pk)
        self.command(ap, "receipt-review", {"line_id": line.pk, "decision": "approved", "decision_notes": "Ok"}, self.purchaser)
        second = self.create(time="10:00")
        self.arrive(second)
        other = self.line(second, observed_quantity=Decimal("3"), accepted_quantity=Decimal("3"),
                         discrepancy_reason="Complemento", purchase_order_line=order_line.pk, previous_receipt_line=line.pk)
        with self.assertRaises(ValidationError):
            self.command(second, "receipt-review", {"line_id": other.pk, "decision": "approved", "decision_notes": "Ok"}, self.purchaser)

    def test_receipt_edit_resets_authorization_and_audits_before(self):
        ap = self.create()
        self.arrive(ap)
        line = self.line(ap)
        self.command(ap, "receipt-lines", {"line_id": line.pk, "invoice": self.invoice.pk,
                     "invoice_item": self.item.pk, "observed_quantity": Decimal("8"),
                     "accepted_quantity": Decimal("8"), "rejected_quantity": Decimal("0"),
                     "discrepancy_reason": "Contagem corrigida"})
        line.refresh_from_db()
        self.assertEqual(line.decision, "pending")
        self.assertEqual(ap.events.filter(kind="receipt_line_recorded").last().data["before"]["accepted_quantity"], "10.000000")

    def test_time_correction_checks_full_sequence_and_audits_original(self):
        ap = self.create()
        self.approve(ap)
        self.arrive(ap)
        visit = ap.visits.get()
        self.command(ap, "check-in", {"visit_id": visit.pk, "occurred_at": AT + timedelta(minutes=10)})
        with self.assertRaises(ValidationError):
            self.command(ap, "correct-time", {"target": "gate_check_in", "occurred_at": AT + timedelta(hours=1),
                         "reason": "Correção inválida"}, self.gate)
        self.command(ap, "correct-time", {"target": "gate_check_in", "occurred_at": AT - timedelta(minutes=2),
                     "reason": "Relógio conferido"}, self.gate)
        event = ap.events.get(kind="timestamp_corrected")
        self.assertEqual(datetime.fromisoformat(event.data["old"]), AT)
        self.assertEqual(event.data["reason"], "Relógio conferido")
        with self.assertRaises(ValidationError):
            self.command(ap, "correct-time", {"target": "gate_check_out", "occurred_at": AT, "reason": "Sem marco"}, self.gate)

    def test_nature_reschedule_preserves_observed_arrival(self):
        ap = self.create()
        self.arrive(ap)
        self.command(ap, "reschedule", {"date": DAY + timedelta(days=1), "time": "10:00",
                     "reason": "Chuva", "nature_exception": True})
        ap.refresh_from_db()
        self.assertEqual(ap.gate_checked_in_at, AT)
        self.assertEqual(ap.arrived_at, AT)
        self.assertEqual(ap.operation_status, "arrived")
        self.assertEqual(ap.slot.date, DAY + timedelta(days=1))

    def test_legacy_guard_and_no_invented_v2_fields(self):
        old = services.create_appointment(self.external, supplier=self.supplier, invoice=self.invoice,
                    day=DAY, time="10:00", packaging="paletizada")
        self.client.force_authenticate(self.operator)
        detail = self.client.get(f"/api/v2/appointments/{old.pk}/")
        self.assertEqual(detail.status_code, 200)
        self.assertIsNone(detail.data["gate_checked_in_at"])
        self.assertIn("arrive", [x["code"] for x in detail.data["available_actions"]])
        ap = self.create()
        self.assertEqual(self.client.get(f"/api/v1/appointments/{ap.pk}/").status_code, 409)
        self.assertEqual(self.client.post(f"/api/v2/appointments/{ap.pk}/arrive/",
                    {"expected_revision": ap.revision}, format="json").status_code, 409)

    def test_gatehouse_can_read_linked_invoice_but_not_unlinked_or_decide(self):
        ap = self.create()
        other = self.second_invoice()
        self.client.force_authenticate(self.gate)
        self.assertEqual(self.client.get(f"/api/v2/invoices/{self.invoice.pk}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/v2/invoices/{other.pk}/").status_code, 404)
        download = self.client.get(f"/api/v2/attachments/{self.invoice.pk}/download/")
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b"".join(download.streaming_content), XML)
        self.assertEqual(self.client.get(f"/api/v2/attachments/{other.pk}/download/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/v2/appointments/{ap.pk}/purchase-review/",
                    {"expected_revision": ap.revision, "decision": "approved"}, format="json").status_code, 403)

    def test_gatehouse_receiving_projection_hides_purchase_analysis_and_order_references(self):
        ap = self.create(notes="INTERNAL-NOTES-MARKER")
        self.command(ap, "purchase-review", {"decision": "approved", "order_reference": "PRIVATE-PO-MARKER",
                     "comparison_notes": "PRIVATE-ANALYSIS-MARKER"}, self.purchaser)
        self.arrive(ap)
        line = self.line(ap, observed_quantity=Decimal("6"), accepted_quantity=Decimal("6"),
                         discrepancy_reason="PRIVATE-CONFERENCE-MARKER")
        self.command(ap, "receipt-review", {"line_id": line.pk, "decision": "approved",
                     "decision_notes": "PRIVATE-DECISION-MARKER"}, self.purchaser)
        self.client.force_authenticate(self.gate)
        result = self.client.get(f"/api/v2/appointments/{ap.pk}/")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data["purchase_status"], "approved")
        self.assertEqual(result.data["invoices"][0]["number"], "9001")
        for field in ("order_reference", "comparison_notes", "notes", "purchase_reviewed_at"):
            self.assertNotIn(field, result.data)
        self.assertEqual(result.data["receipt_lines"], [])
        self.assertNotIn("purchase_review", [event["kind"] for event in result.data["events"]])
        self.assertNotIn("PRIVATE-", str(result.data))
        self.assertNotIn("INTERNAL-NOTES-MARKER", str(result.data))
        listing = self.client.get("/api/v1/appointments/")
        self.assertNotIn("PRIVATE-", str(listing.data))
        self.assertEqual(self.client.get("/api/v2/purchase-orders/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/v2/appointments/{ap.pk}/receipt-review/", {
            "expected_revision": ap.revision, "line_id": str(line.pk), "decision": "approved", "decision_notes": "No"}, format="json").status_code, 403)
        self.client.force_authenticate(self.purchaser)
        internal = self.client.get(f"/api/v2/appointments/{ap.pk}/")
        self.assertEqual(internal.data["order_reference"], "PRIVATE-PO-MARKER")
        self.assertTrue(internal.data["receipt_lines"])

    def test_notification_ack_is_persistent_idempotent_and_scoped(self):
        ap = self.create()
        self.arrive(ap)
        item = InternalNotification.objects.get(appointment=ap)
        self.client.force_authenticate(self.gate)
        self.assertEqual(self.client.post(f"/api/v2/notifications/{item.pk}/acknowledge/", {}).status_code, 404)
        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.post(f"/api/v2/notifications/{item.pk}/acknowledge/", {}).status_code, 200)
        item.refresh_from_db()
        timestamp = item.acknowledged_at
        self.client.post(f"/api/v2/notifications/{item.pk}/acknowledge/", {})
        item.refresh_from_db()
        self.assertEqual(item.acknowledged_at, timestamp)

    def test_availability_machine_and_nature_respect_exclusivity(self):
        ap = self.create()
        self.client.force_authenticate(self.operator)
        result = self.client.get(f"/api/v2/slots/availability/?date={DAY}&packaging=machine_implement")
        self.assertTrue(result.data["slots"][0]["eligible"])
        result = self.client.get(f"/api/v2/slots/availability/?date={DAY}&packaging=machine_implement&exclude_appointment={ap.pk}")
        self.assertTrue(result.data["slots"][0]["eligible"])
        self.client.force_authenticate(self.external)
        self.assertEqual(self.client.get(f"/api/v2/slots/availability/?date={DAY}&nature_exception=true&exclude_appointment={ap.pk}").status_code, 403)

    def test_nf_identity_errors_and_duplicate_cache_mismatch(self):
        self.client.force_authenticate(self.external)
        for number in ["0", "0123", "ABC", "1234567890"]:
            response = self.client.post("/api/v2/invoices/upload/", {
                "file": SimpleUploadedFile("nf.pdf", b"%PDF-synthetic"), "number": number}, format="multipart")
            self.assertEqual(response.status_code, 400, number)
        response = self.client.post("/api/v2/invoices/upload/", {
            "file": SimpleUploadedFile("nf.xml", XML), "number": "9002"}, format="multipart")
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/v2/invoices/upload/", {
            "file": SimpleUploadedFile("nf.pdf", b"%PDF-numeric-test"), "number": "123"}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        response = self.client.post("/api/v2/invoices/upload/", {
            "file": SimpleUploadedFile("nf.pdf", b"%PDF-numeric-test"), "number": "124"}, format="multipart")
        self.assertEqual(response.status_code, 400)

    def test_no_show_incident_does_not_release_capacity(self):
        ap = self.create()
        self.command(ap, "exceptions", {"kind": "no_show", "description": "Ausência conferida",
                     "occurred_at": AT + timedelta(hours=1)}, self.gate)
        self.assertEqual(ReceivingException.objects.filter(appointment=ap).count(), 1)
        self.assertEqual(services.occupancy(ap.slot)["occupied_units"], 1)
        self.arrive(ap)
        with self.assertRaises(ValidationError):
            self.command(ap, "exceptions", {"kind": "no_show", "description": "Indevido"}, self.gate)

    def test_unauthorized_supplier_cannot_read_other_appointments(self):
        ap = self.create()
        self.client.force_authenticate(self.other_external)
        self.assertEqual(self.client.get(f"/api/v2/appointments/{ap.pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/v2/invoices/{self.invoice.pk}/").status_code, 404)

    def test_available_actions_do_not_enable_gate_entry_or_unapproved_start_for_warehouse(self):
        ap = self.create()
        actions = {x["code"]: x for x in workflow.available_actions(ap, self.operator)}
        self.assertFalse(actions["gate-check-in"]["allowed"])
        self.assertFalse(actions["warehouse-review"]["allowed"])
        self.approve(ap)
        visit = ap.visits.get()
        self.assertFalse(workflow.visit_actions(visit, self.operator)[0]["allowed"])

    def test_rejected_item_requires_zero_accepted_for_completion(self):
        ap = self.create()
        self.arrive(ap)
        line = self.line(ap, accepted_quantity=Decimal("0"), rejected_quantity=Decimal("10"),
                         discrepancy_reason="Item recusado por avaria")
        self.command(ap, "receipt-review", {"line_id": line.pk, "decision": "rejected",
                     "decision_notes": "Recusa integral confirmada"}, self.purchaser)
        self.assertTrue(workflow.receipt_ready(ap)[0])
        self.command(ap, "receipt-lines", {"line_id": line.pk, "invoice": self.invoice.pk,
                     "invoice_item": self.item.pk, "observed_quantity": Decimal("10"),
                     "accepted_quantity": Decimal("1"), "rejected_quantity": Decimal("9"),
                     "discrepancy_reason": "Recontagem"})
        self.command(ap, "receipt-review", {"line_id": line.pk, "decision": "rejected",
                     "decision_notes": "Aceite não autorizado"}, self.purchaser)
        self.assertFalse(workflow.receipt_ready(ap)[0])

    def test_time_correction_cannot_move_warehouse_to_other_reservation_date(self):
        ap = self.create()
        self.approve(ap)
        self.arrive(ap)
        visit = ap.visits.get()
        self.command(ap, "check-in", {"visit_id": visit.pk, "occurred_at": AT})
        with self.assertRaises(ValidationError):
            self.command(ap, "correct-time", {"target": "warehouse_check_in", "visit_id": visit.pk,
                         "occurred_at": AT + timedelta(days=1), "reason": "Data incompatível"})
        visit.refresh_from_db()
        self.assertEqual(visit.checked_in_at, AT)

    def test_v1_cannot_turn_legacy_record_into_machine_load(self):
        old = services.create_appointment(self.external, supplier=self.supplier, invoice=self.invoice,
                    day=DAY, time="10:00", packaging="paletizada")
        self.client.force_authenticate(self.operator)
        response = self.client.patch(f"/api/v1/appointments/{old.pk}/",
                    {"packaging": "machine_implement"}, format="json")
        self.assertEqual(response.status_code, 409)
        old.refresh_from_db()
        self.assertEqual(old.packaging, "paletizada")

    def test_nf_access_key_cannot_silently_override_xml_or_cache(self):
        self.client.force_authenticate(self.external)
        response = self.client.post("/api/v2/invoices/upload/", {"file": SimpleUploadedFile("nf.xml", XML),
                    "access_key": "2" * 44}, format="multipart")
        self.assertEqual(response.status_code, 400)
        payload = {"number": "123", "file": SimpleUploadedFile("nf.pdf", b"%PDF-key-test")}
        self.assertEqual(self.client.post("/api/v2/invoices/upload/", payload, format="multipart").status_code, 201)
        payload = {"number": "123", "access_key": "2" * 44,
                   "file": SimpleUploadedFile("nf.pdf", b"%PDF-key-test")}
        self.assertEqual(self.client.post("/api/v2/invoices/upload/", payload, format="multipart").status_code, 400)

    def test_transport_only_edit_keeps_conference_and_current_approvals(self):
        ap = self.create()
        self.approve(ap)
        self.arrive(ap)
        self.line(ap)
        self.command(ap, "edit", {"invoice_ids": [self.invoice], "packaging": ap.packaging,
                     "carrier_name": "Transportadora corrigida"})
        ap.refresh_from_db()
        self.assertEqual(ap.carrier_name, "Transportadora corrigida")
        self.assertEqual(ap.purchase_status, "approved")
        self.assertEqual(ap.warehouse_status, "approved")
        self.assertEqual(ap.receipt_lines.count(), 1)

    def test_new_request_references_rejection_without_resetting_original(self):
        original = self.create()
        with self.assertRaises(ValidationError):
            self.create(time="10:00", previous_appointment=original, resubmission_reason="Nova tentativa")
        self.command(original, "cancel", {"reason": "Documentação incorreta"})
        with self.assertRaises(ValidationError):
            self.create(time="10:00", previous_appointment=original)
        replacement = self.create(time="10:00", previous_appointment=original, resubmission_reason="Documentação corrigida")
        original.refresh_from_db()
        self.assertEqual(replacement.previous_appointment_id, original.pk)
        self.assertEqual(replacement.resubmission_reason, "Documentação corrigida")
        self.assertEqual(original.operation_status, "cancelled")
        self.assertEqual(original.capacity_holds.filter(active=True).count(), 1)
        self.assertEqual(replacement.purchase_status, "pending")

    def test_new_request_reference_cannot_cross_supplier_boundary(self):
        original = self.create()
        self.command(original, "cancel", {"reason": "Cancelado"})
        with self.assertRaises(ValidationError):
            workflow.create(self.other_external, {"invoice_ids": [self.second_invoice(self.other_supplier)],
                "date": DAY, "time": "10:00", "packaging": "paletizada", "vehicle_plate": "OTHER",
                "previous_appointment": original, "resubmission_reason": "Referência de outro fornecedor"})

    def test_cancelled_conference_releases_invoice_and_confirmed_order_balance(self):
        order = PurchaseOrder.objects.create(supplier=self.supplier, reference="CONFIRMED-CANCEL",
                    confirmation_notes="Conferido", confirmed_by=self.purchaser)
        order_line = PurchaseOrderLine.objects.create(order=order, position=1, description="Pedido",
                    unit="UN", ordered_quantity=Decimal("10"))
        first = self.create()
        self.arrive(first)
        self.line(first, purchase_order_line=order_line.pk)
        self.command(first, "cancel", {"reason": "Descarga cancelada antes do início"})
        second = self.create(time="10:00")
        self.arrive(second)
        self.line(second, purchase_order_line=order_line.pk)
        from .serializers_v2 import OrderLineSerializer
        result = OrderLineSerializer(order_line).data
        self.assertEqual(Decimal(result["accepted_quantity"]), Decimal("10"))
        self.assertEqual(Decimal(result["remaining_quantity"]), Decimal("0"))


@skipUnless(connection.vendor == "postgresql", "Concorrência exige PostgreSQL real.")
class ReceivingV2ConcurrencyTests(TransactionTestCase):
    setUp = ReceivingV2Tests.setUp
    create = ReceivingV2Tests.create
    command = ReceivingV2Tests.command
    arrive = ReceivingV2Tests.arrive
    line = ReceivingV2Tests.line
    second_invoice = ReceivingV2Tests.second_invoice

    def race(self, callbacks):
        barrier = threading.Barrier(len(callbacks))
        results = []
        guard = threading.Lock()

        def run(callback):
            close_old_connections()
            try:
                barrier.wait(timeout=15)
                result = ("accepted", str(callback().pk))
            except (services.DomainConflict, ValidationError):
                result = ("refused", None)
            except Exception as exc:
                result = ("unexpected", repr(exc))
            finally:
                close_old_connections()
            with guard:
                results.append(result)

        threads = [threading.Thread(target=run, args=(callback,)) for callback in callbacks]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive(), "Transação concorrente não concluiu.")
        self.assertFalse([r for r in results if r[0] == "unexpected"], results)
        return results

    def test_simultaneous_create_retry_does_not_double_reserve(self):
        key = uuid.uuid4()
        results = self.race([lambda: self.create(idempotency_key=key)] * 2)
        self.assertEqual({r[0] for r in results}, {"accepted"})
        self.assertEqual(len({r[1] for r in results}), 1)
        self.assertEqual(Appointment.objects.count(), 1)
        self.assertEqual(services.occupancy(Appointment.objects.get().slot)["occupied_units"], 1)

    def test_simultaneous_conflicting_global_creation_key_is_domain_conflict(self):
        key = uuid.uuid4()
        invoice = self.second_invoice(self.other_supplier)
        results = self.race([
            lambda: self.create(idempotency_key=key),
            lambda: workflow.create(self.other_external, {"invoice_ids": [invoice], "date": DAY,
                "time": "10:00", "packaging": "paletizada", "vehicle_plate": "TEST2", "idempotency_key": key}),
        ])
        self.assertCountEqual([r[0] for r in results], ["accepted", "refused"])
        self.assertEqual(Appointment.objects.count(), 1)

    def test_concurrent_approvals_cannot_overconsume_same_invoice_item(self):
        first, second = self.create(), self.create(time="10:00")
        for ap in (first, second):
            self.arrive(ap)
        lines = [self.line(ap, observed_quantity=Decimal("6"), accepted_quantity=Decimal("6"),
                           discrepancy_reason="Parcial") for ap in (first, second)]
        def approve(ap, line):
            return workflow.perform(self.purchaser, ap.pk, "receipt-review", {
                "expected_revision": Appointment.objects.get(pk=ap.pk).revision,
                "line_id": line.pk, "decision": "approved", "decision_notes": "Parcial autorizada"})
        results = self.race([lambda: approve(first, lines[0]), lambda: approve(second, lines[1])])
        self.assertCountEqual([r[0] for r in results], ["accepted", "refused"])
        self.assertEqual(self.item.receiptline_set.filter(decision="approved").count(), 1)

    def test_opposing_v2_reschedules_do_not_deadlock(self):
        first, second = self.create(), self.create(time="10:00")
        def move(ap, target):
            return workflow.perform(self.operator, ap.pk, "reschedule", {"expected_revision": ap.revision,
                "date": DAY, "time": target, "nature_exception": True, "reason": "Chuva sintética"})
        results = self.race([lambda: move(first, "10:00"), lambda: move(second, "08:00")])
        self.assertEqual([r[0] for r in results], ["accepted", "accepted"])
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.slot.time, second.slot.time), ("10:00", "08:00"))

    def test_concurrent_different_invoices_cannot_overconsume_confirmed_order(self):
        other_invoice = self.second_invoice()
        other_item = InvoiceItem.objects.create(invoice=other_invoice, position=1, description="Outro item",
                    unit="UN", quantity=Decimal("10"))
        order = PurchaseOrder.objects.create(supplier=self.supplier, reference="CONFIRMED-RACE",
                    confirmation_notes="Pedido confirmado localmente", confirmed_by=self.purchaser)
        order_line = PurchaseOrderLine.objects.create(order=order, position=1, description="Pedido sintético",
                    unit="UN", ordered_quantity=Decimal("10"))
        first = self.create()
        second = self.create(time="10:00", invoice_ids=[other_invoice])
        for ap, invoice, item in ((first, self.invoice, self.item), (second, other_invoice, other_item)):
            self.arrive(ap)
            self.command(ap, "receipt-lines", {"invoice": invoice.pk, "invoice_item": item.pk,
                         "purchase_order_line": order_line.pk, "observed_quantity": Decimal("6"),
                         "accepted_quantity": Decimal("6"), "rejected_quantity": Decimal("0"),
                         "discrepancy_reason": "Entrega parcial do pedido"})
        def approve(ap):
            return workflow.perform(self.purchaser, ap.pk, "receipt-review", {
                "expected_revision": Appointment.objects.get(pk=ap.pk).revision,
                "line_id": ap.receipt_lines.get().pk, "decision": "approved", "decision_notes": "Parcial autorizada"})
        results = self.race([lambda: approve(first), lambda: approve(second)])
        self.assertCountEqual([r[0] for r in results], ["accepted", "refused"])
        self.assertEqual(order_line.receipts.filter(decision="approved").count(), 1)
