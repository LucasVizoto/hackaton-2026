import hashlib
import tempfile
import threading
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest import skipUnless
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from catalog.models import Equipment, Supplier, Warehouse
from core.models import UserProfile

from . import services
from .models import Appointment, CapacityHold, GlobalSlot, Holiday, Invoice, NonReceipt
from .xml_parser import parse_invoice_xml

XML = b"""<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35261000000000000000550010000090011000000019"><ide><nNF>9001</nNF><dhEmi>2026-10-05T08:00:00-03:00</dhEmi></ide><emit><xNome>Fornecedor sintetico</xNome><CNPJ>00000000000000</CNPJ></emit><det nItem="1"><prod><cProd>EXTERNAL</cProd><xProd>Item demonstracao</xProd><uCom>UN</uCom><qCom>10</qCom><vUnCom>1.25</vUnCom></prod></det><transp><vol><qVol>2</qVol><esp>Volumes declarados</esp><pesoB>100</pesoB></vol><vol><qVol>3</qVol><esp>Outra especie</esp></vol></transp></infNFe></NFe></nfeProc>"""
DAY = date(2026, 10, 5)
AT = datetime(2026, 10, 5, 8, 0, tzinfo=ZoneInfo("America/Sao_Paulo"))
RESOURCES = {"worker_count": 2, "equipment_ids": [], "resources_confirmed": True}


def fixtures(instance):
    instance.supplier = Supplier.objects.create(
        code="SYN-001", name="Fornecedor sintético", origin="demo_sintetico"
    )
    instance.other_supplier = Supplier.objects.create(
        code="SYN-002", name="Outro fornecedor sintético", origin="demo_sintetico"
    )
    instance.operator = User.objects.create_user("warehouse-test")
    UserProfile.objects.create(user=instance.operator, role="warehouse")
    instance.purchaser = User.objects.create_user("purchasing-test")
    UserProfile.objects.create(user=instance.purchaser, role="purchasing")
    instance.external = User.objects.create_user("supplier-test")
    UserProfile.objects.create(user=instance.external, role="supplier", supplier=instance.supplier)
    instance.other_external = User.objects.create_user("other-supplier-test")
    UserProfile.objects.create(
        user=instance.other_external, role="supplier", supplier=instance.other_supplier
    )
    instance.warehouse = Warehouse.objects.create(code="SYN-A", name="Armazém sintético A")
    instance.second_warehouse = Warehouse.objects.create(code="SYN-B", name="Armazém sintético B")
    instance.equipment = Equipment.objects.create(
        code="SYN-E", name="Equipamento sintético", warehouse=instance.warehouse
    )
    instance.invoice = Invoice.objects.create(
        supplier=instance.supplier,
        file=ContentFile(XML, name="synthetic.xml"),
        original_name="synthetic.xml",
        media_type="application/xml",
        sha256=hashlib.sha256(XML).hexdigest(),
        created_by=instance.external,
        origin="demo_sintetico",
    )


class ReceivingTests(TestCase):
    def test_entry_requires_current_local_reservation_and_open_calendar(self):
        appointment = self.appointment()
        self.approve(appointment)
        services.arrive(self.operator, appointment.id, {"occurred_at": AT})
        for wrong_day in [AT + timedelta(days=1), AT + timedelta(days=5)]:
            with self.assertRaises(ValidationError):
                services.start(self.operator, appointment.id, {"occurred_at": wrong_day})
        Holiday.objects.create(date=DAY, description="Feriado sintético configurado após a reserva")
        with self.assertRaises(ValidationError):
            services.start(self.operator, appointment.id, {"occurred_at": AT})
        appointment.refresh_from_db()
        self.assertIsNone(appointment.started_at)
        self.assertEqual(appointment.operation_status, "arrived")

    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media.cleanup)
        fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.operator)

    def appointment(self, packaging="paletizada", time="08:00", day=DAY):
        return services.create_appointment(
            self.external,
            supplier=self.supplier,
            invoice=self.invoice,
            day=day,
            time=time,
            packaging=packaging,
        )

    def approve(self, appointment, warehouses=None):
        services.purchase_review(
            self.purchaser,
            appointment.id,
            {
                "decision": "approved",
                "order_reference": "DEMO-ORDER",
                "comparison_notes": "Conferência manual sintética de itens, quantidades e nota.",
            },
        )
        return services.warehouse_review(
            self.operator, appointment.id, {"warehouse_ids": warehouses or [self.warehouse.id]}
        )

    def test_two_mechanized_third_refused_global_not_per_warehouse(self):
        first = self.appointment()
        second = self.appointment("big_bag")
        self.approve(first)
        self.approve(second, [self.second_warehouse.id])
        with self.assertRaises(services.DomainConflict):
            self.appointment()
        state = services.occupancy(first.slot)
        self.assertEqual(state["occupied_units"], 2)

    def test_batida_exclusive_in_both_directions(self):
        first = self.appointment("batida")
        with self.assertRaises(services.DomainConflict):
            self.appointment("big_bag")
        self.appointment(time="10:00")
        with self.assertRaises(services.DomainConflict):
            self.appointment("batida", time="10:00")
        self.assertEqual(services.occupancy(first.slot)["occupied_units"], 2)

    def test_weekends_holidays_and_only_four_times(self):
        Holiday.objects.create(date=DAY, description="Feriado configurado sintético")
        for day, time in [
            (DAY, "08:00"),
            (date(2026, 10, 3), "08:00"),
            (date(2026, 10, 4), "08:00"),
            (date(2026, 10, 6), "09:00"),
        ]:
            with self.assertRaises(ValidationError):
                self.appointment(day=day, time=time)

    def test_arrival_independent_of_approvals_and_start_requires_both(self):
        appointment = self.appointment()
        services.arrive(self.operator, appointment.id, {"occurred_at": AT})
        with self.assertRaises(services.DomainConflict):
            services.start(self.operator, appointment.id, {"occurred_at": AT})
        with self.assertRaises(services.DomainConflict):
            services.warehouse_review(
                self.operator, appointment.id, {"warehouse_ids": [self.warehouse.id]}
            )
        self.approve(appointment)
        started = services.start(
            self.operator, appointment.id, {"occurred_at": AT + timedelta(minutes=15)}
        )
        self.assertEqual(started.operation_status, "in_progress")

    def test_purchase_reference_comparison_and_missing_order_pending(self):
        appointment = self.appointment()
        with self.assertRaises(ValidationError):
            services.purchase_review(self.purchaser, appointment.id, {"decision": "approved"})
        pending = services.purchase_review(
            self.purchaser,
            appointment.id,
            {
                "decision": "pending",
                "comparison_notes": "Pedido ainda não existe: aguardando Compras.",
            },
        )
        self.assertEqual(pending.purchase_status, "pending")
        self.assertTrue(pending.capacity_reserved)

    def test_completed_persists_chronology_resources_and_safe_repeat(self):
        appointment = self.approve(self.appointment())
        services.arrive(self.operator, appointment.id, {"occurred_at": AT})
        services.start(self.operator, appointment.id, {"occurred_at": AT + timedelta(minutes=10)})
        finish_data = {
            **RESOURCES,
            "equipment_ids": [self.equipment.id],
            "occurred_at": AT + timedelta(minutes=50),
        }
        finished = services.finish(self.operator, appointment.id, finish_data)
        events = finished.events.count()
        services.finish(self.operator, appointment.id, finish_data)
        appointment.refresh_from_db()
        self.assertEqual(appointment.operation_status, "completed")
        self.assertEqual(appointment.worker_count, 2)
        self.assertEqual(appointment.events.count(), events)
        visit = appointment.visits.get()
        self.assertEqual(visit.finished_at, appointment.finished_at)
        self.assertEqual(list(visit.equipment.values_list("id", flat=True)), [self.equipment.id])
        with self.assertRaises(services.DomainConflict):
            services.finish(self.operator, appointment.id, {**finish_data, "worker_count": 3})

    def test_zero_workers_and_no_equipment_need_explicit_confirmation(self):
        appointment = self.approve(self.appointment())
        services.arrive(self.operator, appointment.id, {"occurred_at": AT})
        services.start(self.operator, appointment.id, {"occurred_at": AT})
        with self.assertRaises(ValidationError):
            services.finish(
                self.operator,
                appointment.id,
                {"worker_count": 0, "equipment_ids": [], "occurred_at": AT},
            )
        result = services.finish(
            self.operator,
            appointment.id,
            {
                "worker_count": 0,
                "equipment_ids": [],
                "resources_confirmed": True,
                "occurred_at": AT,
            },
        )
        self.assertEqual(result.worker_count, 0)

    def test_start_finish_order_and_same_day_beyond_17_allowed(self):
        appointment = self.approve(self.appointment())
        services.arrive(self.operator, appointment.id, {"occurred_at": AT})
        with self.assertRaises(ValidationError):
            services.start(
                self.operator, appointment.id, {"occurred_at": AT - timedelta(minutes=1)}
            )
        services.start(self.operator, appointment.id, {"occurred_at": AT + timedelta(hours=7)})
        with self.assertRaises(ValidationError):
            services.finish(
                self.operator, appointment.id, {**RESOURCES, "occurred_at": AT + timedelta(days=1)}
            )
        finished = services.finish(
            self.operator, appointment.id, {**RESOURCES, "occurred_at": AT + timedelta(hours=11)}
        )
        self.assertEqual(finished.finished_at.astimezone(AT.tzinfo).hour, 19)

    def test_started_cannot_cancel_reschedule_edit_document(self):
        appointment = self.approve(self.appointment())
        services.arrive(self.operator, appointment.id, {"occurred_at": AT})
        services.start(self.operator, appointment.id, {"occurred_at": AT})
        for function, data in [
            (services.cancel, {"reason": "tentativa"}),
            (
                services.reschedule,
                {
                    "date": date(2026, 10, 6),
                    "time": "08:00",
                    "reason": "Chuva",
                    "nature_exception": True,
                },
            ),
            (services.update_appointment, {"notes": "modificada"}),
        ]:
            with self.assertRaises(services.DomainConflict):
                function(self.operator, appointment.id, data)

    def test_multiple_warehouses_sequential_and_global_not_summed(self):
        appointment = self.approve(
            self.appointment(), [self.warehouse.id, self.second_warehouse.id]
        )
        services.arrive(self.operator, appointment.id, {"occurred_at": AT})
        services.start(self.operator, appointment.id, {"occurred_at": AT + timedelta(minutes=10)})
        first, second = list(appointment.visits.all())
        with self.assertRaises(services.DomainConflict):
            services.visit_action(
                self.operator, second.id, {"occurred_at": AT + timedelta(minutes=10)}, "start"
            )
        services.visit_action(
            self.operator, first.id, {"occurred_at": AT + timedelta(minutes=10)}, "start"
        )
        with self.assertRaises(services.DomainConflict):
            services.finish(
                self.operator,
                appointment.id,
                {**RESOURCES, "occurred_at": AT + timedelta(minutes=30)},
            )
        services.visit_action(
            self.operator,
            first.id,
            {**RESOURCES, "occurred_at": AT + timedelta(minutes=25)},
            "finish",
        )
        services.visit_action(
            self.operator, second.id, {"occurred_at": AT + timedelta(minutes=25)}, "start"
        )
        services.visit_action(
            self.operator,
            second.id,
            {**RESOURCES, "occurred_at": AT + timedelta(minutes=40)},
            "finish",
        )
        result = services.finish(
            self.operator, appointment.id, {**RESOURCES, "occurred_at": AT + timedelta(minutes=40)}
        )
        self.assertEqual(result.worker_count, 2)
        self.assertEqual(result.visits.count(), 2)
        self.assertEqual(Appointment.objects.filter(operation_status="completed").count(), 1)

    def test_cancel_holds_capacity_until_named_assignment(self):
        cancelled = self.appointment("batida")
        services.cancel(self.external, cancelled.id, {"reason": "Fornecedor cancelou"})
        with self.assertRaises(services.DomainConflict):
            self.appointment()
        replacement = self.appointment("batida", time="10:00")
        hold = CapacityHold.objects.get(source_appointment=cancelled)
        assigned = services.assign_cancelled_capacity(
            self.operator, hold_id=hold.id, appointment_id=replacement.id
        )
        self.assertEqual(assigned.slot_id, cancelled.slot_id)
        hold.refresh_from_db()
        self.assertFalse(hold.active)
        self.assertEqual(hold.assigned_to_id, replacement.id)
        # Moving into the held slot releases the replacement's previous slot.
        self.assertFalse(
            CapacityHold.objects.filter(source_appointment=replacement, active=True).exists()
        )
        self.appointment("batida", time="10:00")

    def test_nature_reagendamento_exceeds_numeric_capacity_but_not_batida(self):
        old = self.appointment(time="08:00")
        self.appointment(time="10:00")
        self.appointment("big_bag", time="10:00")
        moved = services.reschedule(
            self.operator,
            old.id,
            {"date": DAY, "time": "10:00", "reason": "Chuva registrada", "nature_exception": True},
        )
        self.assertEqual(services.occupancy(moved.slot)["occupied_units"], 3)
        self.assertTrue(moved.nature_exception)
        audit = moved.events.get(kind="rescheduled").data
        self.assertEqual(audit["global_capacity"], 2)
        self.assertEqual(audit["target_occupied_units_before"], 2)
        self.assertEqual(audit["target_occupied_units_after"], 3)
        self.assertTrue(audit["capacity_exceeded"])
        batida = self.appointment("batida", time="13:00")
        with self.assertRaises(services.DomainConflict):
            services.reschedule(
                self.operator,
                batida.id,
                {"date": DAY, "time": "10:00", "reason": "Chuva", "nature_exception": True},
            )

    def test_rejection_and_nonreceipt_retention_no_ghost_reservation(self):
        appointment = self.appointment()
        reviewed = services.purchase_review(
            self.purchaser,
            appointment.id,
            {"decision": "rejected", "comparison_notes": "Divergência identificada"},
        )
        self.assertFalse(reviewed.capacity_reserved)
        self.assertEqual(services.occupancy(reviewed.slot)["occupied_units"], 1)
        result = services.create_non_receipt(
            self.operator,
            {
                "appointment": appointment,
                "reason": "invoice_mismatch",
                "description": "Divergência identificada",
                "occurred_at": AT,
            },
        )
        self.assertEqual(result.appointment_id, appointment.id)
        self.assertEqual(
            CapacityHold.objects.filter(source_appointment=appointment, active=True).count(), 1
        )
        appointment.refresh_from_db()
        self.assertEqual(appointment.operation_status, "not_received")

    def test_avulso_nonreceipt_and_other_requires_description(self):
        result = services.create_non_receipt(
            self.operator,
            {
                "reason": "unscheduled_no_capacity",
                "description": "Sem agenda e sem capacidade disponível",
                "occurred_at": AT,
            },
        )
        self.assertIsNone(result.appointment_id)
        self.assertEqual(NonReceipt.objects.count(), 1)
        with self.assertRaises(ValidationError):
            services.create_non_receipt(self.operator, {"reason": "other"})

    def test_supplier_isolation_on_appointments_files_and_catalog(self):
        appointment = self.appointment()
        self.client.force_authenticate(self.other_external)
        self.assertEqual(
            self.client.get(f"/api/v1/appointments/{appointment.id}/").status_code, 404
        )
        self.assertEqual(
            self.client.get(f"/api/v1/attachments/{self.invoice.id}/download/").status_code, 404
        )
        self.assertEqual(self.client.get("/api/v1/catalog/suppliers/").data["count"], 1)
        self.assertEqual(self.client.get("/api/v1/catalog/workers/").data["count"], 0)
        self.assertEqual(
            self.client.post(
                f"/api/v1/appointments/{appointment.id}/purchase-review/", {"decision": "approved"}
            ).status_code,
            404,
        )

    def test_direct_state_patch_and_stale_revision_cannot_bypass_domain(self):
        appointment = self.appointment()
        response = self.client.patch(
            f"/api/v1/appointments/{appointment.id}/",
            {"operation_status": "completed"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        with self.assertRaises(services.DomainConflict):
            services.arrive(self.operator, appointment.id, {"expected_revision": 999})

    def test_api_real_roundtrip_upload_appointments_and_reload(self):
        self.client.force_authenticate(self.external)
        response = self.client.post(
            "/api/v1/invoices/upload/",
            {"file": SimpleUploadedFile("demo.xml", XML)},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200)  # same bytes -> same supplier document
        self.assertEqual(str(response.data["id"]), str(self.invoice.id))
        response = self.client.post(
            "/api/v1/appointments/",
            {
                "invoice": str(self.invoice.id),
                "date": str(DAY),
                "time": "08:00",
                "packaging": "paletizada",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        appointment_id = response.data["id"]
        self.client = APIClient()
        self.client.force_authenticate(self.external)
        read = self.client.get(f"/api/v1/appointments/{appointment_id}/")
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.data["date"], str(DAY))
        self.assertEqual(read.data["operation_status"], "waiting")
        self.assertEqual(read.data["origin"], "demo_sintetico")
        self.assertEqual(read.data["events"][0]["kind"], "created")

    def test_xml_upload_parses_and_pdf_remains_manual_private(self):
        self.client.force_authenticate(self.other_external)
        xml_response = self.client.post(
            "/api/v1/invoices/upload/",
            {"file": SimpleUploadedFile("demo.xml", XML)},
            format="multipart",
        )
        self.assertEqual(xml_response.status_code, 201)
        self.assertEqual(xml_response.data["extraction_status"], "extracted_unverified")
        self.assertEqual(xml_response.data["origin"], "demo_sintetico")
        self.assertEqual(len(xml_response.data["items"]), 1)
        self.assertEqual(len(xml_response.data["extracted"]["volumes"]), 2)
        pdf_response = self.client.post(
            "/api/v1/invoices/upload/",
            {
                "file": SimpleUploadedFile(
                    "manual.pdf", b"%PDF-1.4\nsynthetic demonstration\n%%EOF"
                ),
                "number": "DEMO-PDF",
            },
            format="multipart",
        )
        self.assertEqual(pdf_response.status_code, 201)
        self.assertEqual(pdf_response.data["extraction_status"], "manual")
        self.assertEqual(pdf_response.data["number"], "DEMO-PDF")
        self.assertNotIn("file", pdf_response.data)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(pdf_response.data["download_url"]).status_code, 401)

    def test_xml_unit_value_ten_places_survives_database_and_api_reload(self):
        self.client.force_authenticate(self.other_external)
        content = XML.replace(b"<vUnCom>1.25</vUnCom>", b"<vUnCom>1.1234567890</vUnCom>")
        response = self.client.post(
            "/api/v1/invoices/upload/",
            {"file": SimpleUploadedFile("precision-synthetic.xml", content)},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)
        invoice = Invoice.objects.get(id=response.data["id"])
        self.assertEqual(invoice.items.get().unit_value, Decimal("1.1234567890"))
        loaded = self.client.get(f"/api/v1/invoices/{invoice.id}/")
        self.assertEqual(loaded.data["items"][0]["unit_value"], "1.1234567890")
        self.assertEqual(loaded.data["extracted"]["items"][0]["unit_value"], "1.1234567890")
        self.assertEqual(loaded.data["items"][0]["supplier_code"], "EXTERNAL")
        self.assertNotIn("internal_code", loaded.data["items"][0])
        self.assertNotIn("packaging", loaded.data)
        self.assertNotIn("warehouse", loaded.data)

    def test_invalid_upload_does_not_create_invoice_or_file(self):
        self.client.force_authenticate(self.other_external)
        before = Invoice.objects.count()
        for filename, content in [
            ("broken.xml", b"<broken>"),
            ("invalid.pdf", b"This is not a PDF"),
            ("unsafe.xml", b'<!DOCTYPE n [<!ENTITY x SYSTEM "file:///private">]><n>&x;</n>'),
            ("empty.xml", b""),
        ]:
            response = self.client.post(
                "/api/v1/invoices/upload/",
                {"file": SimpleUploadedFile(filename, content)},
                format="multipart",
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(Invoice.objects.count(), before)

    def test_availability_exposes_holds_only_to_warehouse(self):
        appointment = self.appointment("batida")
        services.cancel(self.external, appointment.id, {"reason": "Cancelado"})
        operator = self.client.get("/api/v1/slots/availability/", {"date": str(DAY)}).data
        self.assertEqual(operator["slots"][0]["available_units"], 0)
        self.assertEqual(len(operator["slots"][0]["holds"]), 1)
        self.client.force_authenticate(self.external)
        supplier = self.client.get("/api/v1/slots/availability/", {"date": str(DAY)}).data
        self.assertEqual(supplier["slots"][0]["holds"], [])

    def test_availability_range_matches_single_day(self):
        self.appointment("batida", time="10:00")
        response = self.client.get(
            "/api/v1/slots/availability/",
            {"date_from": str(DAY), "date_to": str(DAY + timedelta(days=6))},
        )
        self.assertEqual(response.status_code, 200)
        days = response.data["days"]
        self.assertEqual([d["date"] for d in days][:2], [str(DAY), str(DAY + timedelta(days=1))])
        self.assertEqual(len(days), 7)
        self.assertEqual(days[0]["slots"][1]["available_units"], 0)
        self.assertEqual(days[1]["slots"][1]["available_units"], 2)
        self.assertFalse(days[5]["calendar_open"])  # Saturday
        too_long = self.client.get(
            "/api/v1/slots/availability/",
            {"date_from": str(DAY), "date_to": str(DAY + timedelta(days=90))},
        )
        self.assertEqual(too_long.status_code, 400)

    def test_reschedule_releases_source_slot(self):
        moved = self.appointment("batida", time="10:00")
        services.reschedule(
            self.operator,
            moved.id,
            {
                "date": DAY + timedelta(days=1),
                "time": "10:00",
                "reason": "Chuva registrada",
                "nature_exception": True,
            },
        )
        self.assertFalse(CapacityHold.objects.filter(active=True).exists())
        # The source slot is free again for any supplier, including an exclusive load.
        self.appointment("batida", time="10:00")
        with self.assertRaises(services.DomainConflict):
            self.appointment(time="10:00", day=DAY + timedelta(days=1))

    def test_machine_or_implement_occupies_one_unit(self):
        self.appointment("maquina_implemento")
        self.assertEqual(services.occupancy(GlobalSlot.objects.get())["occupied_units"], 1)
        self.appointment("paletizada")
        with self.assertRaises(services.DomainConflict):
            self.appointment("maquina_implemento")

    def test_upload_rejects_number_that_differs_from_access_key(self):
        self.client.force_authenticate(self.other_external)
        before = Invoice.objects.count()
        mismatched_xml = XML.replace(b"<nNF>9001</nNF>", b"<nNF>9002</nNF>")
        bad_digit = XML.replace(b"0000090011000000019", b"0000090011000000018")
        pdf = b"%PDF-1.4\nsynthetic demonstration\n%%EOF"
        key = "35261000000000000000550010000090011000000019"
        cases = [
            ({"file": SimpleUploadedFile("mismatch.xml", mismatched_xml)}, "number"),
            ({"file": SimpleUploadedFile("digit.xml", bad_digit)}, "access_key"),
            ({"file": SimpleUploadedFile("typed.xml", XML), "number": "9002"}, "number"),
            (
                {"file": SimpleUploadedFile("m.pdf", pdf), "number": "9002", "access_key": key},
                "number",
            ),
            (
                {"file": SimpleUploadedFile("s.pdf", pdf), "number": "9001", "access_key": "123"},
                "access_key",
            ),
        ]
        for payload, field in cases:
            response = self.client.post("/api/v1/invoices/upload/", payload, format="multipart")
            self.assertEqual(response.status_code, 400, payload)
            self.assertIn(field, str(response.data))
        self.assertEqual(Invoice.objects.count(), before)
        formatted_key = " ".join(key[i : i + 4] for i in range(0, 44, 4))
        response = self.client.post(
            "/api/v1/invoices/upload/",
            {
                "file": SimpleUploadedFile("ok.pdf", pdf),
                "number": "000009001",
                "access_key": formatted_key,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["access_key"], key)

    def test_synthetic_origin_cannot_be_relabelled_operational_or_historical(self):
        with self.assertRaises(ValidationError):
            services.create_appointment(
                self.external,
                supplier=self.supplier,
                invoice=self.invoice,
                day=DAY,
                time="08:00",
                packaging="paletizada",
                origin="operacional_registrado",
            )
        self.client.force_authenticate(self.external)
        response = self.client.post(
            "/api/v1/appointments/",
            {
                "invoice": str(self.invoice.id),
                "date": str(DAY),
                "time": "08:00",
                "packaging": "paletizada",
                "origin": "historico_importado",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)


class XmlTests(TestCase):
    def test_sparse_non_namespaced_xml_preserves_absent_values(self):
        result = parse_invoice_xml(
            b"<infNFe><ide><nNF>DEMO-SPARSE</nNF></ide>"
            b"<det><prod><cProd>SUPPLIER-ONLY</cProd></prod></det>"
            b"<transp><vol><esp>Declared by supplier</esp></vol></transp></infNFe>"
        )
        self.assertEqual(result["access_key"], "")
        self.assertEqual(result["issuer"], {"name": "", "document": ""})
        self.assertIsNone(result["items"][0]["quantity"])
        self.assertIsNone(result["items"][0]["unit_value"])
        self.assertIsNone(result["volumes"][0]["quantity"])
        self.assertIsNone(result["volumes"][0]["net_weight"])
        self.assertNotIn("packaging", result)
        self.assertNotIn("internal_code", result["items"][0])

    def test_unit_value_precision_is_preserved_and_bounded(self):
        for value in [b"1.1234567890", b"123.0000000000", b"0.0000000001"]:
            result = parse_invoice_xml(
                XML.replace(b"<vUnCom>1.25</vUnCom>", b"<vUnCom>" + value + b"</vUnCom>")
            )
            self.assertEqual(Decimal(result["items"][0]["unit_value"]), Decimal(value.decode()))
        with self.assertRaises(ValidationError):
            parse_invoice_xml(
                XML.replace(b"<vUnCom>1.25</vUnCom>", b"<vUnCom>0.00000000001</vUnCom>")
            )

    def test_namespace_multiple_volumes_and_missing_volume(self):
        result = parse_invoice_xml(XML)
        self.assertEqual(result["number"], "9001")
        self.assertEqual(result["items"][0]["supplier_code"], "EXTERNAL")
        self.assertEqual(len(result["volumes"]), 2)
        without = XML.replace(
            XML[XML.index(b"<transp>") : XML.index(b"</transp>") + len(b"</transp>")], b""
        )
        self.assertEqual(parse_invoice_xml(without)["volumes"], [])

    def test_external_entities_dtd_malformed_oversized_refused(self):
        for data in [
            b"<broken>",
            b'<!DOCTYPE n [<!ENTITY x SYSTEM "file:///private">]><n>&x;</n>',
            b"<!DOCTYPE n><n/>",
            b"x" * (5 * 1024 * 1024 + 1),
        ]:
            with self.assertRaises(ValidationError):
                parse_invoice_xml(data)

    def test_non_finite_and_negative_quantity_refused(self):
        for number in [b"NaN", b"-1", b"1e999"]:
            with self.assertRaises(ValidationError):
                parse_invoice_xml(XML.replace(b"<qCom>10</qCom>", b"<qCom>" + number + b"</qCom>"))


@skipUnless(connection.vendor == "postgresql", "Concorrência exige PostgreSQL real.")
class PostgreSQLConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media.cleanup)
        fixtures(self)

    def _race(self, packaging_list):
        barrier = threading.Barrier(len(packaging_list))
        results = []
        guard = threading.Lock()

        def reserve(packaging):
            close_old_connections()
            try:
                user = User.objects.get(id=self.external.id)
                supplier = Supplier.objects.get(id=self.supplier.id)
                invoice = Invoice.objects.get(id=self.invoice.id)
                barrier.wait(timeout=15)
                appointment = services.create_appointment(
                    user,
                    supplier=supplier,
                    invoice=invoice,
                    day=DAY,
                    time="08:00",
                    packaging=packaging,
                )
                result = ("accepted", str(appointment.id))
            except services.DomainConflict:
                result = ("refused", None)
            except Exception as exc:
                result = ("unexpected", repr(exc))
            finally:
                close_old_connections()
            with guard:
                results.append(result)

        threads = [
            threading.Thread(target=reserve, args=(packaging,)) for packaging in packaging_list
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive(), "Transação concorrente não concluiu.")
        self.assertFalse([result for result in results if result[0] == "unexpected"], results)
        return results

    def test_three_simultaneous_reservations_only_two_commit_in_new_slot(self):
        results = self._race(["paletizada", "big_bag", "paletizada"])
        self.assertEqual(sum(result[0] == "accepted" for result in results), 2)
        self.assertEqual(sum(result[0] == "refused" for result in results), 1)
        self.assertEqual(GlobalSlot.objects.count(), 1)
        self.assertEqual(Appointment.objects.count(), 2)
        self.assertEqual(services.occupancy(GlobalSlot.objects.get())["occupied_units"], 2)

    def test_batida_and_mechanized_race_preserves_exclusivity(self):
        results = self._race(["batida", "big_bag"])
        self.assertEqual(sum(result[0] == "accepted" for result in results), 1)
        self.assertEqual(Appointment.objects.count(), 1)

    def test_two_simultaneous_reservations_for_last_unit_only_one_commits(self):
        services.create_appointment(
            self.external,
            supplier=self.supplier,
            invoice=self.invoice,
            day=DAY,
            time="08:00",
            packaging="paletizada",
        )
        results = self._race(["paletizada", "big_bag"])
        self.assertEqual(sum(result[0] == "accepted" for result in results), 1)
        self.assertEqual(sum(result[0] == "refused" for result in results), 1)
        self.assertEqual(services.occupancy(GlobalSlot.objects.get())["occupied_units"], 2)

    def test_reciprocal_reschedules_lock_source_and_destination_without_deadlock(self):
        appointments = [
            services.create_appointment(
                self.external,
                supplier=self.supplier,
                invoice=self.invoice,
                day=DAY,
                time=time,
                packaging="paletizada",
            )
            for time in ["08:00", "10:00"]
        ]
        barrier = threading.Barrier(2)
        results = []
        guard = threading.Lock()

        def move(appointment_id, target_time):
            close_old_connections()
            try:
                actor = User.objects.get(id=self.operator.id)
                barrier.wait(timeout=15)
                services.reschedule(
                    actor,
                    appointment_id,
                    {
                        "date": DAY,
                        "time": target_time,
                        "reason": "Chuva sintética para validação concorrente",
                        "nature_exception": True,
                    },
                )
                result = "rescheduled"
            except Exception as exc:
                result = repr(exc)
            finally:
                close_old_connections()
            with guard:
                results.append(result)

        threads = [
            threading.Thread(target=move, args=(appointment.id, target_time))
            for appointment, target_time in zip(appointments, ["10:00", "08:00"], strict=True)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive(), "Reagendamento ficou bloqueado.")
        self.assertEqual(results, ["rescheduled", "rescheduled"])
        for appointment, time in zip(appointments, ["10:00", "08:00"], strict=True):
            appointment.refresh_from_db()
            self.assertEqual(appointment.slot.time, time)
            self.assertEqual(appointment.events.filter(kind="rescheduled").count(), 1)
        self.assertEqual(CapacityHold.objects.filter(active=True).count(), 0)
