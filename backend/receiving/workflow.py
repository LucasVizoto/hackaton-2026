"""Versioned receiving workflow. All mutations are locked and recorded, including retries."""
import hashlib
import json
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from catalog.models import Supplier
from core.permissions import require_role, user_role, require_supplier_booking
from . import services as legacy
from .models import (Appointment, AppointmentInvoice, InternalNotification, Invoice, InvoiceItem,
                     ReceiptLine, ReceivingCommand, WarehouseVisit, ReceivingException, PurchaseOrderLine)
from .xml_parser import validate_invoice_number


def fingerprint(data):
    def serialize(value):
        if hasattr(value, "pk"):
            return str(value.pk)
        return str(value)
    clean = {k: v for k, v in data.items() if k not in {"expected_revision", "idempotency_key"}}
    return hashlib.sha256(json.dumps(clean, sort_keys=True, default=serialize).encode()).hexdigest()


def notification(appointment, role, kind, message, suffix=""):
    item, created = InternalNotification.objects.get_or_create(
        dedupe_key=f"{appointment.pk}:{kind}:{suffix}",
        defaults={"appointment": appointment, "recipient_role": role, "kind": kind, "message": message},
    )
    if created:
        from .realtime import notify_internal
        notify_internal(item)


def documents(supplier, invoices):
    if not invoices or len(invoices) > 30 or len({i.pk for i in invoices}) != len(invoices):
        raise ValidationError({"invoice_ids": "Informe de 1 a 30 notas distintas."})
    demo = supplier.origin == "demo_sintetico"
    for invoice in invoices:
        if invoice.supplier_id != supplier.pk:
            raise ValidationError({"invoice_ids": "Todas as notas devem pertencer ao fornecedor da carga."})
        if (invoice.origin == "demo_sintetico") != demo:
            raise ValidationError({"invoice_ids": "Não misture notas sintéticas e operacionais."})
        validate_invoice_number(invoice.number)
    return "demo_sintetico" if demo else "operacional_registrado"


@transaction.atomic
def create(user, data):
    require_supplier_booking(user)
    supplier = data.get("supplier")
    if user_role(user) == "supplier":
        own = user.profile.supplier
        if not own or (supplier and supplier.pk != own.pk):
            raise PermissionDenied("Você só pode agendar para seu fornecedor.")
        supplier = own
    if not supplier:
        raise ValidationError({"supplier": "Informe o fornecedor."})
    Supplier.objects.select_for_update().get(pk=supplier.pk)
    key = data.get("idempotency_key")
    digest = fingerprint({**data, "supplier": supplier})
    if key:
        existing = Appointment.objects.filter(creation_key=key).first()
        if existing:
            if existing.created_by_id != user.pk or existing.creation_fingerprint != digest:
                raise legacy.DomainConflict("Chave de repetição usada para outra solicitação.")
            return existing
    invoices = data["invoice_ids"]
    origin = documents(supplier, invoices)
    previous = data.get("previous_appointment")
    if previous:
        previous = Appointment.objects.get(pk=previous.pk)
        if previous.supplier_id != supplier.pk:
            raise ValidationError({"previous_appointment": "A referência deve pertencer ao mesmo fornecedor."})
        if previous.operation_status not in {"cancelled", "not_received"} and previous.purchase_status != "rejected":
            raise ValidationError({"previous_appointment": "Nova solicitação referencia uma carga rejeitada, não recebida ou cancelada."})
        if not data.get("resubmission_reason", "").strip():
            raise ValidationError({"resubmission_reason": "Explique o motivo da nova solicitação."})
    elif data.get("resubmission_reason", "").strip():
        raise ValidationError({"previous_appointment": "Selecione o recebimento anterior para justificar nova solicitação."})
    try:
        return _create_new(user, data, supplier, invoices, origin, key, digest)
    except IntegrityError:
        # The global unique key also protects conflicting requests from different
        # suppliers, which do not share the supplier row lock above.
        existing = Appointment.objects.filter(creation_key=key).first() if key else None
        if not existing:
            raise
        if existing.created_by_id != user.pk or existing.creation_fingerprint != digest:
            raise legacy.DomainConflict("Chave de repetição usada para outra solicitação.") from None
        return existing


@transaction.atomic
def _create_new(user, data, supplier, invoices, origin, key, digest):
    ap = legacy.create_appointment(
        user, supplier=supplier, invoice=invoices[0], day=data["date"], time=data["time"],
        packaging=data["packaging"], vehicle_plate=data["vehicle_plate"], notes=data.get("notes", ""),
        origin=origin,
    )
    ap.workflow_version = 2
    ap.creation_key = key
    ap.creation_fingerprint = digest
    ap.previous_appointment = data.get("previous_appointment")
    ap.resubmission_reason = data.get("resubmission_reason", "").strip()
    ap.articulated = data.get("articulated", False)
    ap.assisted = user_role(user) != "supplier"
    ap.booking_kind = data.get("booking_kind", "scheduled")
    for field in ("tractor_plate", "carrier_name", "driver_name"):
        setattr(ap, field, data.get(field, ""))
    ap.save()
    AppointmentInvoice.objects.bulk_create([
        AppointmentInvoice(appointment=ap, invoice=invoice, position=index)
        for index, invoice in enumerate(invoices[1:], 2)
    ])
    return ap


def receipt_ready(ap):
    links = list(ap.invoice_links.select_related("invoice"))
    lines = list(ap.receipt_lines.all())
    if not links:
        return False, "Recebimento exige documentos vinculados antes da conferência."
    for link in links:
        ids = set(link.invoice.items.values_list("id", flat=True))
        found = {line.invoice_item_id for line in lines if line.invoice_id == link.invoice_id}
        if ids and not ids.issubset(found):
            return False, "Confira todos os itens de todas as notas antes da conclusão."
        if not ids and not any(line.invoice_id == link.invoice_id for line in lines):
            return False, "Nota manual exige ao menos uma linha de conferência."
    if any(line.decision == "pending" or (line.decision == "rejected" and line.accepted_quantity > 0) for line in lines):
        return False, "Compras deve resolver as divergências dos itens antes da conclusão."
    return True, ""


def action(code, allowed, reason=""):
    return {"code": code, "allowed": bool(allowed), "reason": "" if allowed else reason}


def available_actions(ap, user):
    role = user_role(user)
    admin = role == "admin"
    warehouse = role == "warehouse" or admin
    purchaser = role == "purchasing" or admin
    gate = role == "gatehouse" or admin
    editable = ap.operation_status in {"waiting", "arrived"}
    result = [
        action("edit", ap.workflow_version == 2 and editable and (warehouse or purchaser or role == "supplier"), "Alteração v2 somente antes da descarga, pelo fornecedor, Compras ou Armazém; legado conserva o contrato v1."),
        action("forward-to-purchasing", warehouse and editable, "Somente Armazém antes da descarga."),
        action("purchase-review", purchaser and editable, "Somente Compras, antes da descarga."),
        action("warehouse-review", warehouse and editable and ap.purchase_status == "approved", "Exige Compras aprovada, antes da descarga."),
        action("cancel", (warehouse or role == "supplier") and editable, "Cancelamento somente antes da descarga."),
        action("reschedule", warehouse and editable, "Reagendamento por natureza somente antes da descarga; chegada observada é preservada."),
        action("assign-cancelled", warehouse and ap.operation_status == "cancelled", "Disponível para vaga cancelada."),
        action("non-receipt", warehouse and editable, "Não recebimento somente antes da descarga."),
    ]
    if ap.workflow_version < 2:
        result.extend([
            action("arrive", warehouse and ap.operation_status == "waiting", "Chegada já registrada ou operação encerrada."),
            action("start", warehouse and ap.operation_status == "arrived" and ap.purchase_status == "approved" and ap.warehouse_status == "approved" and ap.capacity_reserved and ap.visits.exists(), "Exige chegada, aprovações, destinos e reserva ativa."),
            action("finish", warehouse and ap.operation_status == "in_progress", "Exige descarga em andamento e recursos confirmados."),
        ])
        return result
    result.extend([
        action("gate-check-in", gate and ap.operation_status == "waiting" and not ap.gate_checked_in_at, "Somente Portaria, antes da chegada."),
        action("gate-check-out", gate and ap.gate_checked_in_at and not ap.gate_checked_out_at and ap.operation_status in {"completed", "cancelled", "not_received"}, "Exige chegada e descarga concluída ou não recebimento/cancelamento."),
        action("receipt-lines", warehouse and ap.operation_status in {"arrived", "in_progress"}, "Somente Armazém durante a conferência."),
        action("receipt-review", purchaser and ap.operation_status in {"arrived", "in_progress"}, "Somente Compras durante a conferência."),
        action("correct-time", (warehouse or gate) and bool(ap.gate_checked_in_at), "Exige marco existente e justificativa; cada perfil corrige seus marcos."),
        action("exceptions", (warehouse or gate or purchaser), "Somente usuários internos da operação."),
    ])
    return result


def visit_actions(visit, user):
    ap = visit.appointment
    permitted = user_role(user) in {"warehouse", "admin"}
    if ap.workflow_version < 2:
        return [
            action("start", permitted and ap.operation_status == "in_progress" and not visit.started_at, "Etapa indisponível."),
            action("finish", permitted and ap.operation_status == "in_progress" and visit.started_at and not visit.finished_at, "Etapa indisponível."),
        ]
    ready = ap.gate_checked_in_at and ap.purchase_status == "approved" and ap.warehouse_status == "approved" and ap.capacity_reserved
    preceding = ap.visits.filter(sequence__lt=visit.sequence, checked_out_at__isnull=True).exists()
    other_active = ap.visits.exclude(pk=visit.pk).filter(checked_in_at__isnull=False, checked_out_at__isnull=True).exists()
    can_finish = permitted and ap.operation_status == "in_progress" and visit.checked_in_at and not visit.checked_out_at
    reason = "Exige check-in desta etapa."
    if can_finish and not ap.visits.filter(sequence__gt=visit.sequence).exists():
        can_finish, reason = receipt_ready(ap)
    return [
        action("check-in", permitted and ready and not preceding and not other_active and not visit.checked_in_at and ap.operation_status in {"arrived", "in_progress"}, "Exige chegada, aprovações, reserva e etapas anteriores concluídas."),
        action("check-out", can_finish, reason),
    ]


def temporal_order(ap):
    """Only observed v2 marks participate. No legacy timestamps are imputed."""
    previous = ap.gate_checked_in_at
    if not previous:
        raise ValidationError("Check-in da portaria é obrigatório.")
    visits = list(ap.visits.order_by("sequence"))
    for visit in visits:
        if visit.checked_out_at and not visit.checked_in_at:
            raise ValidationError("Check-out do armazém exige seu check-in.")
        if visit.checked_in_at:
            if timezone.localdate(visit.checked_in_at) != ap.slot.date:
                raise ValidationError("Check-in do armazém exige reserva na mesma data local.")
            if visit.checked_in_at < previous:
                raise ValidationError("Horários violam a sequência de portaria/armazéns.")
            previous = visit.checked_in_at
        if visit.checked_out_at:
            legacy._same_day(visit.checked_in_at, visit.checked_out_at)
            if visit.checked_out_at < previous:
                raise ValidationError("Check-out não pode anteceder check-in.")
            previous = visit.checked_out_at
    if ap.gate_checked_out_at and ap.gate_checked_out_at < previous:
        raise ValidationError("Saída da portaria não pode anteceder os marcos anteriores.")


def _resource_values(data):
    workers, equipment = legacy._resource_ids(data)
    # Keep inactive assets in history while forbidding new allocations.
    from catalog.models import Equipment
    if any(field.name == "is_active" for field in Equipment._meta.fields):
        if Equipment.objects.filter(pk__in=equipment, is_active=False).exists():
            raise ValidationError({"equipment_ids": "Equipamento inativo não pode ser alocado."})
    return workers, equipment


CLOCK_TOLERANCE = timedelta(minutes=5)


def current_time():
    """Relógio do servidor para validar marcos informados; isolado para os testes fixarem a data."""
    return timezone.now()


def not_in_future(at):
    if at > current_time() + CLOCK_TOLERANCE:
        raise ValidationError({"occurred_at": "Horário no futuro. Registre o horário em que o fato aconteceu."})


def gate_entry_on_slot_date(ap, at):
    # Sem esta regra, um dia digitado errado vira horas de "espera" e domina a média.
    if timezone.localdate(at) != ap.slot.date:
        raise ValidationError({"occurred_at": f"A entrada na portaria deve ser na data da reserva "
                                              f"({ap.slot.date:%d/%m/%Y}). Se o caminhão veio em outro dia, "
                                              f"reagende antes de registrar."})


def _gate(ap, user, data, entering):
    require_role(user, "gatehouse")
    at = data.get("occurred_at") or timezone.now()
    field = "gate_checked_in_at" if entering else "gate_checked_out_at"
    if getattr(ap, field):
        if data.get("occurred_at") and getattr(ap, field) != at:
            raise legacy.DomainConflict("Marco já registrado; use correção com justificativa.")
        return
    not_in_future(at)
    if entering:
        gate_entry_on_slot_date(ap, at)
        if ap.operation_status != "waiting":
            raise legacy.DomainConflict("Recebimento não está aguardando chegada.")
        driver_name = " ".join(data.get("driver_name", ap.driver_name).split())
        if not driver_name or len(driver_name) > 160:
            raise ValidationError({"driver_name": "Informe o nome do motorista, com até 160 caracteres."})
        ap.driver_name = driver_name
        ap.gate_checked_in_at = at
        ap.arrived_at = at  # New observed event supplies the legacy projection, never the reverse.
        ap.operation_status = "arrived"
        notification(ap, "warehouse", "gate_check_in", "Carga chegou à portaria; confira o recebimento.")
    else:
        if not ap.gate_checked_in_at or ap.operation_status not in {"completed", "cancelled", "not_received"}:
            raise legacy.DomainConflict("Conclua o recebimento ou registre a recusa antes da saída.")
        ap.gate_checked_out_at = at
    temporal_order(ap)
    legacy._event(ap, user, "gate_check_in" if entering else "gate_check_out",
                  data={"driver_name": ap.driver_name} if entering else None, at=at)


def _visit(ap, user, data, entering):
    require_role(user, "warehouse")
    visit = get_object_or_404(WarehouseVisit.objects.select_for_update(), pk=data["visit_id"], appointment=ap)
    field = "checked_in_at" if entering else "checked_out_at"
    at = data.get("occurred_at") or timezone.now()
    if getattr(visit, field):
        if data.get("occurred_at") and getattr(visit, field) != at:
            raise legacy.DomainConflict("Marco já registrado; use correção com justificativa.")
        return
    not_in_future(at)
    available = next(x for x in visit_actions(visit, user) if x["code"] == ("check-in" if entering else "check-out"))
    if not available["allowed"]:
        raise legacy.DomainConflict(available["reason"])
    if entering:
        legacy.validate_calendar(timezone.localdate(at), ap.slot.time)
        if timezone.localdate(at) != ap.slot.date:
            raise ValidationError("Check-in do armazém exige reserva na mesma data local.")
        visit.checked_in_at = at
        visit.started_at = at
        if not ap.started_at:
            ap.started_at = at
        ap.operation_status = "in_progress"
    else:
        workers, equipment = _resource_values(data)
        from catalog.models import Equipment
        foreign = Equipment.objects.filter(pk__in=equipment, mobile=False, warehouse__isnull=False).exclude(
            warehouse_id=visit.warehouse_id)
        if foreign.exists():
            raise ValidationError({"equipment_ids": "Equipamento fixo de outro armazém não pode ser usado nesta etapa: "
                                                    + ", ".join(foreign.values_list("name", flat=True))})
        legacy._same_day(visit.checked_in_at, at)
        visit.checked_out_at = at
        visit.finished_at = at
        visit.worker_count = workers
        visit.resources_confirmed = True
        visit.equipment.set(equipment)
    visit.save()
    temporal_order(ap)
    if not entering and not ap.visits.filter(checked_out_at__isnull=True).exists():
        ready, reason = receipt_ready(ap)
        if not ready:
            raise legacy.DomainConflict(reason)
        ap.finished_at = at
        ap.operation_status = "completed"
        # Etapas são sequenciais e a mesma equipe circula: o caminhão usa a maior equipe, sem somar etapas.
        ap.worker_count = max(v.worker_count or 0 for v in ap.visits.all())
        ap.resources_confirmed = True
        used = {eid for v in ap.visits.all() for eid in v.equipment.values_list("id", flat=True)}
        ap.equipment.set(used)
        notification(ap, "gatehouse", "warehouse_complete", "Descarga concluída; registrar saída na portaria.")
    legacy._event(ap, user, "warehouse_check_in" if entering else "warehouse_check_out",
                  {"visit_id": str(visit.pk), "warehouse_id": str(visit.warehouse_id)}, at=at)


def _correct(ap, user, data):
    target = data["target"]
    gate = target.startswith("gate_")
    require_role(user, "gatehouse" if gate else "warehouse")
    reason = data["reason"].strip()
    if not reason:
        raise ValidationError({"reason": "Justifique a correção."})
    if gate:
        obj = ap
        field = "gate_checked_in_at" if target == "gate_check_in" else "gate_checked_out_at"
    else:
        obj = get_object_or_404(WarehouseVisit.objects.select_for_update(), pk=data.get("visit_id"), appointment=ap)
        field = "checked_in_at" if target == "warehouse_check_in" else "checked_out_at"
    old = getattr(obj, field)
    if not old:
        raise ValidationError("Correção exige um marco previamente registrado; não crie horários ausentes.")
    not_in_future(data["occurred_at"])
    if field == "gate_checked_in_at":
        gate_entry_on_slot_date(ap, data["occurred_at"])
    setattr(obj, field, data["occurred_at"])
    if not gate:
        setattr(obj, "started_at" if field == "checked_in_at" else "finished_at", data["occurred_at"])
        obj.save()
    temporal_order(ap)
    ap.arrived_at = ap.gate_checked_in_at
    entered = list(ap.visits.filter(checked_in_at__isnull=False).order_by("sequence"))
    ap.started_at = entered[0].checked_in_at if entered else None
    if ap.operation_status == "completed":
        ap.finished_at = ap.visits.order_by("-sequence").first().checked_out_at
    legacy._event(ap, user, "timestamp_corrected", {"target": target, "visit_id": str(obj.pk) if not gate else None,
                  "old": old.isoformat(), "new": data["occurred_at"].isoformat(), "reason": reason})


def _remaining_check(item, accepted, exclude=None):
    query = ReceiptLine.objects.filter(invoice_item=item, decision="approved").exclude(
        appointment__operation_status__in=["cancelled", "not_received"])
    if exclude:
        query = query.exclude(pk=exclude)
    used = query.aggregate(total=Sum("accepted_quantity"))["total"] or Decimal(0)
    if item.quantity is not None and used + accepted > item.quantity:
        raise ValidationError({"accepted_quantity": "O total aceito nas entregas excede a quantidade declarada da NF. Saldo de pedido não é inferido."})


def _order_remaining_check(order_line, accepted, exclude=None):
    query = order_line.receipts.filter(decision="approved").exclude(
        appointment__operation_status__in=["cancelled", "not_received"])
    if exclude:
        query = query.exclude(pk=exclude)
    used = query.aggregate(total=Sum("accepted_quantity"))["total"] or Decimal(0)
    if used + accepted > order_line.ordered_quantity:
        raise ValidationError({"accepted_quantity": "Quantidade aceita excede o saldo do pedido confirmado."})


def _receipt(ap, user, data):
    require_role(user, "warehouse")
    if ap.operation_status not in {"arrived", "in_progress"}:
        raise legacy.DomainConflict("Conferência somente após chegada e antes da conclusão.")
    invoice = get_object_or_404(Invoice, pk=data["invoice"], load_links__appointment=ap)
    item = None
    if data.get("invoice_item"):
        item = get_object_or_404(InvoiceItem.objects.select_for_update(), pk=data["invoice_item"], invoice=invoice)
        if item.quantity is None or not item.unit:
            raise ValidationError("Item sem quantidade/unidade declarada exige conferência documental antes do lançamento.")
        declared, description, unit = item.quantity, item.description, item.unit
        if "declared_quantity" in data and data["declared_quantity"] != declared:
            raise ValidationError({"declared_quantity": "Não altere a quantidade declarada no XML."})
        if data.get("unit") and data["unit"] != unit:
            raise ValidationError({"unit": "Conversão de unidade não é automática."})
    else:
        if invoice.items.exists():
            raise ValidationError({"invoice_item": "Selecione o item declarado na NF."})
        for field in ("declared_quantity", "description", "unit"):
            if field not in data or data[field] in (None, ""):
                raise ValidationError({field: "Obrigatório para conferência manual."})
        declared, description, unit = data["declared_quantity"], data["description"], data["unit"]
    observed, accepted, rejected = (data[key] for key in ("observed_quantity", "accepted_quantity", "rejected_quantity"))
    if accepted + rejected != observed:
        raise ValidationError("Quantidade observada deve ser igual à aceita mais a recusada.")
    discrepancy = observed != declared or rejected > 0
    reason = data.get("discrepancy_reason", "").strip()
    if discrepancy and not reason:
        raise ValidationError({"discrepancy_reason": "Descreva a diferença para autorização de Compras."})
    line = None
    if data.get("line_id"):
        line = get_object_or_404(ReceiptLine.objects.select_for_update(), pk=data["line_id"], appointment=ap)
        if line.invoice_id != invoice.pk or line.invoice_item_id != (item.pk if item else None):
            raise ValidationError("A identidade do item não muda; corrija somente sua conferência.")
    elif item and ap.receipt_lines.filter(invoice_item=item).exists():
        raise ValidationError({"line_id": "Item já conferido; informe sua linha para corrigir."})
    order_line = None
    order_id = data.get("purchase_order_line", line.purchase_order_line_id if line else None)
    if order_id:
        order_line = get_object_or_404(PurchaseOrderLine.objects.select_for_update(), pk=order_id, order__supplier_id=ap.supplier_id)
        if order_line.unit != unit:
            raise ValidationError({"purchase_order_line": "Unidade do pedido difere da conferência; conversão não é automática."})
        if not discrepancy:
            _order_remaining_check(order_line, accepted, line.pk if line else None)
    previous = None
    previous_id = data.get("previous_receipt_line", line.previous_receipt_line_id if line else None)
    if previous_id:
        previous = get_object_or_404(ReceiptLine, pk=previous_id, appointment__supplier_id=ap.supplier_id)
        if (line and previous.pk == line.pk) or previous.appointment_id == ap.pk:
            raise ValidationError({"previous_receipt_line": "Entrega complementar deve referenciar outra carga anterior."})
        if previous.decision != "approved" or previous.unit != unit:
            raise ValidationError({"previous_receipt_line": "Referência exige item aceito e a mesma unidade."})
        if order_line and previous.purchase_order_line_id != order_line.pk:
            raise ValidationError({"previous_receipt_line": "Complemento deve referenciar o mesmo item do pedido confirmado."})
    if not discrepancy and item:
        _remaining_check(item, accepted, line.pk if line else None)
    values = dict(invoice=invoice, invoice_item=item, purchase_order_line=order_line,
                  previous_receipt_line=previous, description=description, unit=unit,
                  declared_quantity=declared, observed_quantity=observed, accepted_quantity=accepted,
                  rejected_quantity=rejected, discrepancy_reason=reason,
                  decision="pending" if discrepancy else "approved", decision_notes="",
                  reviewed_by=None, reviewed_at=None)
    before = None
    if line:
        before = {k: str(getattr(line, k)) for k in ("observed_quantity", "accepted_quantity", "rejected_quantity", "decision")}
        for key, value in values.items():
            setattr(line, key, value)
        line.save()
    else:
        line = ReceiptLine.objects.create(appointment=ap, recorded_by=user, **values)
    legacy._event(ap, user, "receipt_line_recorded", {"line_id": str(line.pk), "before": before,
                  "observed": str(observed), "accepted": str(accepted), "rejected": str(rejected),
                  "decision": line.decision, "reason": reason})
    if discrepancy:
        notification(ap, "purchasing", "receipt_discrepancy", "Diferença de recebimento exige decisão de Compras.", f"{line.pk}:{ap.revision}")


def _review_receipt(ap, user, data):
    require_role(user, "purchasing")
    if ap.operation_status not in {"arrived", "in_progress"}:
        raise legacy.DomainConflict("Decisão dos itens somente antes da conclusão.")
    line = get_object_or_404(ReceiptLine.objects.select_for_update(), pk=data["line_id"], appointment=ap)
    if line.invoice_item_id:
        item = InvoiceItem.objects.select_for_update().get(pk=line.invoice_item_id)
        if data["decision"] == "approved":
            _remaining_check(item, line.accepted_quantity, line.pk)
    if line.purchase_order_line_id:
        order_line = PurchaseOrderLine.objects.select_for_update().get(pk=line.purchase_order_line_id)
        if data["decision"] == "approved":
            _order_remaining_check(order_line, line.accepted_quantity, line.pk)
    line.decision = data["decision"]
    line.decision_notes = data["decision_notes"].strip()
    if not line.decision_notes:
        raise ValidationError({"decision_notes": "Descreva a autorização ou recusa."})
    line.reviewed_by = user
    line.reviewed_at = timezone.now()
    line.save()
    legacy._event(ap, user, "receipt_line_reviewed", {"line_id": str(line.pk), "decision": line.decision, "notes": line.decision_notes})
    notification(ap, "warehouse", "receipt_reviewed", "Compras registrou decisão sobre a divergência.", f"{line.pk}:{ap.revision}")


ROLES = {
    "gate-check-in": ("gatehouse",), "gate-check-out": ("gatehouse",),
    "check-in": ("warehouse",), "check-out": ("warehouse",),
    "receipt-lines": ("warehouse",), "receipt-review": ("purchasing",),
    "forward-to-purchasing": ("warehouse",),
    "purchase-review": ("purchasing",), "warehouse-review": ("warehouse",),
    "cancel": ("warehouse", "supplier"), "reschedule": ("warehouse",),
    "edit": ("warehouse", "purchasing", "supplier"), "correct-time": ("warehouse", "gatehouse"),
    "exceptions": ("warehouse", "gatehouse", "purchasing"),
}


@transaction.atomic
def perform(user, appointment_id, code, data):
    require_role(user, *ROLES[code])
    # Acquire both source and target slots in the shared global order before locking
    # the appointment. Locking only the source here would deadlock opposing moves.
    extra_slots = ()
    if code == "reschedule":
        extra_slots = (legacy.get_slot(data["date"], data["time"]).pk,)
    ap = legacy._lock_appointment(appointment_id, extra_slots)
    if ap.workflow_version != 2:
        raise legacy.DomainConflict("Registro legado: os quatro marcos não podem ser inventados. Use as ações legadas.")
    if user_role(user) == "supplier" and ap.supplier_id != user.profile.supplier_id:
        raise PermissionDenied("Recebimento de outro fornecedor.")
    key = data.get("idempotency_key")
    digest = fingerprint(data)
    if key:
        previous = ReceivingCommand.objects.filter(appointment=ap, key=key).first()
        if previous:
            if previous.action != code or previous.fingerprint != digest or previous.actor_id != user.pk:
                raise legacy.DomainConflict("Chave de repetição usada para outra ação ou conteúdo.")
            return ap
    legacy._expected_revision(ap, data)
    if code == "gate-check-in":
        _gate(ap, user, data, True)
    elif code == "gate-check-out":
        _gate(ap, user, data, False)
    elif code in {"check-in", "check-out"}:
        _visit(ap, user, data, code == "check-in")
    elif code == "correct-time":
        _correct(ap, user, data)
    elif code == "receipt-lines":
        _receipt(ap, user, data)
    elif code == "receipt-review":
        _review_receipt(ap, user, data)
    elif code == "exceptions":
        if user_role(user) == "gatehouse" and data["kind"] not in {"late", "no_show", "other"}:
            raise PermissionDenied("Portaria registra atraso, não comparecimento ou ocorrência de acesso.")
        if data["kind"] == "no_show" and (ap.gate_checked_in_at or ap.operation_status != "waiting"):
            raise ValidationError("Não comparecimento exige agendamento ainda sem chegada.")
        when = data.get("occurred_at") or timezone.now()
        if data["kind"] == "no_show":
            local = timezone.localtime(when)
            if local.date() < ap.slot.date or (local.date() == ap.slot.date and local.strftime("%H:%M") < ap.slot.time):
                raise ValidationError("Não registre não comparecimento antes do horário reservado.")
        incident = ReceivingException.objects.create(appointment=ap, kind=data["kind"],
                    description=data["description"], occurred_at=when, actor=user)
        legacy._event(ap, user, "exception_recorded", {"exception_id": str(incident.pk),
                      "kind": incident.kind, "description": incident.description}, at=when)
    elif code == "edit":
        legacy._editable(ap)
        if "invoice_ids" in data and [x.pk for x in data["invoice_ids"]] != list(ap.invoice_links.order_by("position").values_list("invoice_id", flat=True)):
            documents(ap.supplier, data["invoice_ids"])
            if ap.receipt_lines.exists():
                raise legacy.DomainConflict("Notas com conferência registrada não podem ser substituídas.")
            ap.invoice_links.all().delete()
            AppointmentInvoice.objects.bulk_create([
                AppointmentInvoice(appointment=ap, invoice=invoice, position=i)
                for i, invoice in enumerate(data["invoice_ids"], 1)])
            ap.invoice = data["invoice_ids"][0]
            ap.purchase_status = "pending"
            ap.purchase_reviewed_at = None
            ap.purchase_reviewed_by = None
            legacy._reset_warehouse(ap)
        if "packaging" in data and data["packaging"] != ap.packaging:
            legacy.validate_capacity(ap.slot, data["packaging"], exclude_appointment=ap.pk)
            ap.purchase_status = "pending"
            ap.purchase_reviewed_at = None
            ap.purchase_reviewed_by = None
            legacy._reset_warehouse(ap)
        if data.get("articulated", ap.articulated) and not data.get("tractor_plate", ap.tractor_plate).strip():
            raise ValidationError({"tractor_plate": "Veículo articulado exige placa do cavalo."})
        for field in ("packaging", "vehicle_plate", "tractor_plate", "carrier_name", "driver_name", "notes", "articulated"):
            if field in data:
                setattr(ap, field, data[field])
        legacy._event(ap, user, "updated", {"fields": sorted(k for k in data if k not in {"idempotency_key", "expected_revision"})})
    else:
        functions = {"forward-to-purchasing": legacy.forward_to_purchasing, "purchase-review": legacy.purchase_review, "warehouse-review": legacy.warehouse_review,
                     "cancel": legacy.cancel, "reschedule": legacy.reschedule}
        ap = functions[code](user, ap.pk, data)
        if code == "reschedule" and ap.gate_checked_in_at:
            ap.arrived_at = ap.gate_checked_in_at
            ap.operation_status = "arrived"
            ap.save(update_fields=["arrived_at", "operation_status"])
    if key:
        ReceivingCommand.objects.create(appointment=ap, key=key, action=code, fingerprint=digest, actor=user)
    return ap
