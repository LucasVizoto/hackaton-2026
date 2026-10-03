from datetime import date

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from catalog.models import Equipment, Warehouse
from core.permissions import require_role

from .models import (
    Appointment,
    CapacityHold,
    GlobalSlot,
    Holiday,
    NonReceipt,
    ReceivingEvent,
    TIMES,
    WarehouseVisit,
)


class DomainConflict(APIException):
    status_code = 409
    default_code = "conflict"
    default_detail = "O registro foi alterado ou a operação não está disponível. Atualize a tela."


def validate_calendar(day, time):
    if isinstance(day, str):
        try:
            day = date.fromisoformat(day)
        except ValueError:
            raise ValidationError({"date": "Data inválida."}) from None
    if not isinstance(day, date):
        raise ValidationError({"date": "Informe a data."})
    if time not in dict(TIMES):
        raise ValidationError({"time": "Escolha 08:00, 10:00, 13:00 ou 15:00."})
    if day.weekday() >= 5:
        raise ValidationError({"date": "Recebimento somente de segunda a sexta."})
    if Holiday.objects.filter(date=day).exists():
        raise ValidationError({"date": "Não há recebimento em feriado configurado."})
    return day


def get_slot(day, time):
    day = validate_calendar(day, time)
    # UniqueConstraint protects creation; the savepoint keeps the outer transaction usable.
    try:
        with transaction.atomic():
            slot, _ = GlobalSlot.objects.get_or_create(date=day, time=time)
    except IntegrityError:
        slot = GlobalSlot.objects.get(date=day, time=time)
    return slot


def lock_slots(*slot_ids):
    return {
        str(slot.id): slot
        for slot in GlobalSlot.objects.select_for_update()
        .filter(id__in=set(slot_ids))
        .order_by("id")
    }


def _lock_appointment(appointment_id, extra_slots=()):
    snapshot = Appointment.objects.only("slot_id").get(id=appointment_id)
    slots = lock_slots(snapshot.slot_id, *extra_slots)
    appointment = Appointment.objects.select_for_update().get(id=appointment_id)
    if str(appointment.slot_id) not in slots:
        raise DomainConflict("O agendamento mudou de horário. Atualize e tente novamente.")
    return appointment


def _expected_revision(appointment, data):
    if (
        data.get("expected_revision") is not None
        and data["expected_revision"] != appointment.revision
    ):
        raise DomainConflict("Versão desatualizada do agendamento. Atualize a tela.")


def _editable(appointment):
    if appointment.operation_status not in {"waiting", "arrived"}:
        raise DomainConflict(
            "Cancelamento, reagendamento e alterações só são permitidos antes da entrada."
        )


def _event(appointment, user, kind, data=None, at=None):
    ReceivingEvent.objects.create(
        appointment=appointment,
        actor=user,
        kind=kind,
        data=data or {},
        occurred_at=at or timezone.now(),
    )
    appointment.revision += 1
    appointment.save()


def occupancy(slot, exclude_appointment=None, exclude_hold=None):
    appointments = Appointment.objects.filter(slot=slot, capacity_reserved=True)
    if exclude_appointment:
        appointments = appointments.exclude(id=exclude_appointment)
    holds = CapacityHold.objects.filter(slot=slot, active=True)
    if exclude_hold:
        holds = holds.exclude(id=exclude_hold)
    reserved_units = sum(
        2 if packaging == "batida" else 1
        for packaging in appointments.values_list("packaging", flat=True)
    )
    held_units = holds.aggregate(total=Sum("units"))["total"] or 0
    return {
        "reserved_units": reserved_units,
        "held_units": held_units,
        "occupied_units": reserved_units + held_units,
        "has_batida": appointments.filter(packaging="batida").exists()
        or holds.filter(exclusive=True).exists(),
    }


def validate_capacity(
    slot, packaging, *, exclude_appointment=None, exclude_hold=None, nature_exception=False
):
    state = occupancy(slot, exclude_appointment, exclude_hold)
    units = 2 if packaging == "batida" else 1
    if state["has_batida"] or (packaging == "batida" and state["occupied_units"] > 0):
        raise DomainConflict("Carga batida exige horário exclusivo para a cooperativa inteira.")
    if state["occupied_units"] + units > 2 and not nature_exception:
        raise DomainConflict(
            "Horário sem capacidade global disponível. Vagas retidas exigem atribuição do armazém."
        )


def _hold_capacity(appointment, user, reason):
    if not appointment.capacity_reserved:
        return
    CapacityHold.objects.create(
        slot_id=appointment.slot_id,
        source_appointment=appointment,
        units=appointment.units,
        exclusive=appointment.packaging == "batida",
        created_by=user,
        reason=reason,
    )
    appointment.capacity_reserved = False


def _reset_warehouse(appointment):
    appointment.warehouse_status = "pending"
    appointment.warehouse_reviewed_by = None
    appointment.warehouse_reviewed_at = None
    appointment.visits.all().delete()


@transaction.atomic
def create_appointment(
    user, *, supplier, invoice, day, time, packaging, vehicle_plate="", notes="", origin=None
):
    if invoice.supplier_id != supplier.id:
        raise ValidationError({"invoice": "Nota fiscal pertence a outro fornecedor."})
    actual_origin = (
        "demo_sintetico"
        if supplier.origin == "demo_sintetico" or invoice.origin == "demo_sintetico"
        else "operacional_registrado"
    )
    if origin and origin != actual_origin:
        raise ValidationError(
            {
                "origin": "Origem deve corresponder ao fornecedor: demonstrações sintéticas ficam separadas da operação real."
            }
        )
    slot = get_slot(day, time)
    lock_slots(slot.id)
    validate_capacity(slot, packaging)
    appointment = Appointment.objects.create(
        supplier=supplier,
        invoice=invoice,
        slot=slot,
        packaging=packaging,
        vehicle_plate=vehicle_plate,
        notes=notes,
        origin=actual_origin,
        created_by=user,
    )
    ReceivingEvent.objects.create(
        appointment=appointment,
        actor=user,
        kind="created",
        occurred_at=timezone.now(),
        data={
            "date": str(slot.date),
            "time": slot.time,
            "capacity_policy": "pending_reserves_global_capacity",
        },
    )
    return appointment


@transaction.atomic
def update_appointment(user, appointment_id, data):
    target = get_slot(data["date"], data["time"]) if "date" in data or "time" in data else None
    appointment = _lock_appointment(appointment_id, [target.id] if target else [])
    _expected_revision(appointment, data)
    _editable(appointment)
    if target and target.id != appointment.slot_id:
        raise ValidationError("Use a ação de reagendamento para trocar data e horário.")
    if "invoice" in data and data["invoice"].supplier_id != appointment.supplier_id:
        raise ValidationError({"invoice": "Nota fiscal pertence a outro fornecedor."})
    if "packaging" in data and appointment.capacity_reserved:
        validate_capacity(
            appointment.slot,
            data["packaging"],
            exclude_appointment=appointment.id,
            nature_exception=appointment.nature_exception,
        )
    if "packaging" in data and not appointment.capacity_reserved:
        raise DomainConflict(
            "A carga está sem reserva ativa. O armazém deve atribuir a capacidade antes de alterar o acondicionamento."
        )
    changed = False
    invalidate = False
    for name in ("invoice", "packaging", "vehicle_plate", "notes"):
        if name in data and getattr(appointment, name) != data[name]:
            setattr(appointment, name, data[name])
            changed = True
            invalidate = invalidate or name in {"invoice", "packaging"}
    if changed:
        if invalidate:
            appointment.purchase_status = "pending"
            appointment.purchase_reviewed_at = None
            appointment.purchase_reviewed_by = None
            _reset_warehouse(appointment)
        _event(appointment, user, "updated", {"approval_reset": invalidate})
    return appointment


@transaction.atomic
def purchase_review(user, appointment_id, data):
    require_role(user, "purchasing")
    appointment = _lock_appointment(appointment_id)
    _expected_revision(appointment, data)
    _editable(appointment)
    decision = data["decision"]
    reference = data.get("order_reference", "").strip()
    notes = data.get("comparison_notes", "").strip()
    if decision == "approved" and (not reference or not notes):
        raise ValidationError(
            "A aprovação exige pedido identificado e registro da comparação manual da nota/pedido."
        )
    if decision == "rejected" and not notes:
        raise ValidationError("Informe o motivo da divergência.")
    if (
        appointment.purchase_status == decision
        and appointment.order_reference == reference
        and appointment.comparison_notes == notes
        and appointment.purchase_reviewed_at
    ):
        return appointment
    appointment.purchase_status = decision
    appointment.order_reference = reference
    appointment.comparison_notes = notes
    appointment.purchase_reviewed_by = user
    appointment.purchase_reviewed_at = timezone.now()
    _reset_warehouse(appointment)
    if decision == "rejected":
        _hold_capacity(appointment, user, "Rejeição de Compras: " + notes)
    _event(
        appointment,
        user,
        "purchase_review",
        {"decision": decision, "order_reference": reference, "comparison_notes": notes},
    )
    return appointment


@transaction.atomic
def warehouse_review(user, appointment_id, data):
    require_role(user, "warehouse")
    appointment = _lock_appointment(appointment_id)
    _expected_revision(appointment, data)
    _editable(appointment)
    if appointment.purchase_status != "approved":
        raise DomainConflict(
            "Armazém deve verificar a aprovação de Compras antes de definir destinos."
        )
    warehouse_ids = data["warehouse_ids"]
    if not warehouse_ids or len(warehouse_ids) != len(set(warehouse_ids)):
        raise ValidationError("Escolha ao menos um destino, sem duplicação.")
    if Warehouse.objects.filter(id__in=warehouse_ids).count() != len(warehouse_ids):
        raise ValidationError("Destino desconhecido.")
    current = list(appointment.visits.order_by("sequence").values_list("warehouse_id", flat=True))
    if appointment.warehouse_status == "approved" and current == warehouse_ids:
        return appointment
    appointment.visits.all().delete()
    WarehouseVisit.objects.bulk_create(
        [
            WarehouseVisit(appointment=appointment, warehouse_id=warehouse_id, sequence=index)
            for index, warehouse_id in enumerate(warehouse_ids, 1)
        ]
    )
    appointment.warehouse_status = "approved"
    appointment.warehouse_reviewed_by = user
    appointment.warehouse_reviewed_at = timezone.now()
    _event(
        appointment,
        user,
        "warehouse_review",
        {"warehouse_ids": [str(x) for x in warehouse_ids], "notes": data.get("notes", "")},
    )
    return appointment


def _occurred_at(data):
    return data.get("occurred_at") or timezone.now()


def _same_day(started, finished):
    if timezone.localdate(started) != timezone.localdate(finished):
        raise ValidationError(
            "Descarga iniciada deve ser concluída no mesmo dia local. Não há corte automático às 17h."
        )


@transaction.atomic
def arrive(user, appointment_id, data):
    require_role(user, "warehouse")
    appointment = _lock_appointment(appointment_id)
    _expected_revision(appointment, data)
    if appointment.arrived_at and appointment.operation_status in {
        "arrived",
        "in_progress",
        "completed",
    }:
        if data.get("occurred_at") and data["occurred_at"] != appointment.arrived_at:
            raise DomainConflict("A chegada já foi registrada em outro horário.")
        return appointment
    if appointment.operation_status != "waiting":
        raise DomainConflict("Este agendamento não pode registrar chegada.")
    appointment.arrived_at = _occurred_at(data)
    appointment.operation_status = "arrived"
    _event(appointment, user, "arrived", at=appointment.arrived_at)
    return appointment


@transaction.atomic
def start(user, appointment_id, data):
    require_role(user, "warehouse")
    appointment = _lock_appointment(appointment_id)
    _expected_revision(appointment, data)
    if appointment.started_at:
        if data.get("occurred_at") and data["occurred_at"] != appointment.started_at:
            raise DomainConflict("A entrada já foi registrada em outro horário.")
        return appointment
    if appointment.operation_status != "arrived" or not appointment.arrived_at:
        raise DomainConflict("Registre a chegada antes da entrada.")
    if (
        appointment.purchase_status != "approved"
        or appointment.warehouse_status != "approved"
        or not appointment.visits.exists()
    ):
        raise DomainConflict(
            "A entrada exige Compras, verificação do armazém e destinos confirmados."
        )
    if not appointment.capacity_reserved:
        raise DomainConflict("O armazém deve atribuir uma reserva ativa antes da entrada.")
    at = _occurred_at(data)
    if at < appointment.arrived_at:
        raise ValidationError("Entrada não pode anteceder a chegada.")
    actual_day = timezone.localdate(at)
    validate_calendar(actual_day, appointment.slot.time)
    if actual_day != appointment.slot.date:
        raise ValidationError(
            "Entrada exige reserva na mesma data local. Reagende antes de iniciar em outra data."
        )
    appointment.started_at = at
    appointment.operation_status = "in_progress"
    visits = list(appointment.visits.all())
    if len(visits) == 1:
        visits[0].started_at = at
        visits[0].save(update_fields=["started_at"])
    _event(appointment, user, "started", at=at)
    return appointment


def _resource_ids(data):
    if not data.get("resources_confirmed"):
        raise ValidationError(
            "Confirme explicitamente chapas e equipamentos utilizados, inclusive zero/nenhum."
        )
    worker_count = data.get("worker_count")
    if worker_count is None or worker_count < 0 or worker_count > 100:
        raise ValidationError("Informe a quantidade de chapas entre 0 e 100.")
    equipment_ids = data.get("equipment_ids", [])
    if len(equipment_ids) != len(set(equipment_ids)) or Equipment.objects.filter(
        id__in=equipment_ids
    ).count() != len(equipment_ids):
        raise ValidationError("Equipamentos desconhecidos ou repetidos.")
    return worker_count, equipment_ids


@transaction.atomic
def finish(user, appointment_id, data):
    require_role(user, "warehouse")
    appointment = _lock_appointment(appointment_id)
    _expected_revision(appointment, data)
    workers, equipment_ids = _resource_ids(data)
    if appointment.operation_status == "completed":
        if (
            appointment.worker_count == workers
            and set(appointment.equipment.values_list("id", flat=True)) == set(equipment_ids)
            and (not data.get("occurred_at") or data["occurred_at"] == appointment.finished_at)
        ):
            return appointment
        raise DomainConflict(
            "Descarga já concluída; a repetição não pode alterar seus recursos ou horário."
        )
    if appointment.operation_status != "in_progress" or not appointment.started_at:
        raise DomainConflict("Registre a entrada antes da saída.")
    at = _occurred_at(data)
    if at < appointment.started_at:
        raise ValidationError("Saída não pode anteceder a entrada.")
    _same_day(appointment.started_at, at)
    visits = list(appointment.visits.all())
    if len(visits) == 1:
        visit = visits[0]
        if visit.finished_at is None:
            visit.finished_at = at
            visit.worker_count = workers
            visit.resources_confirmed = True
            visit.save()
            visit.equipment.set(equipment_ids)
        elif visit.finished_at > at:
            raise ValidationError("Saída não pode anteceder a conclusão da etapa.")
    elif any(not visit.finished_at or not visit.resources_confirmed for visit in visits):
        raise DomainConflict("Conclua todas as etapas por armazém antes da saída global.")
    if any(visit.finished_at and visit.finished_at > at for visit in visits):
        raise ValidationError("Saída não pode anteceder a conclusão das etapas.")
    if len(visits) > 1:
        visit_equipment = set().union(
            *(set(visit.equipment.values_list("id", flat=True)) for visit in visits)
        )
        if set(equipment_ids) != visit_equipment:
            raise ValidationError(
                "Os equipamentos globais devem corresponder aos registrados nas etapas."
            )
        if workers < max(visit.worker_count or 0 for visit in visits):
            raise ValidationError(
                "Quantidade global confirmada não pode ser menor que a usada em uma etapa."
            )
    appointment.finished_at = at
    appointment.operation_status = "completed"
    # Global number is confirmed by operator: never sum teams of sequential visits.
    appointment.worker_count = workers
    appointment.resources_confirmed = True
    appointment.equipment.set(equipment_ids)
    _event(
        appointment,
        user,
        "finished",
        {"worker_count": workers, "equipment_ids": [str(x) for x in equipment_ids]},
        at=at,
    )
    return appointment


@transaction.atomic
def visit_action(user, visit_id, data, action):
    require_role(user, "warehouse")
    snapshot = WarehouseVisit.objects.get(id=visit_id)
    appointment = _lock_appointment(snapshot.appointment_id)
    _expected_revision(appointment, data)
    visit = WarehouseVisit.objects.select_for_update().get(id=visit_id)
    if appointment.operation_status != "in_progress":
        raise DomainConflict("Etapas exigem descarga global em andamento.")
    at = _occurred_at(data)
    if action == "start":
        if visit.started_at:
            if data.get("occurred_at") and data["occurred_at"] != visit.started_at:
                raise DomainConflict("Etapa já iniciada em outro horário.")
            return visit
        earlier = appointment.visits.filter(sequence__lt=visit.sequence)
        if (
            earlier.filter(finished_at__isnull=True).exists()
            or appointment.visits.filter(started_at__isnull=False, finished_at__isnull=True)
            .exclude(id=visit.id)
            .exists()
        ):
            raise DomainConflict(
                "Os destinos devem ser atendidos em sequência, sem etapas simultâneas."
            )
        latest = earlier.order_by("-finished_at").first()
        if at < appointment.started_at or (
            latest and latest.finished_at and at < latest.finished_at
        ):
            raise ValidationError("Início da etapa viola a ordem cronológica.")
        _same_day(appointment.started_at, at)
        visit.started_at = at
    else:
        workers, equipment_ids = _resource_ids(data)
        if visit.finished_at:
            if (
                visit.worker_count == workers
                and set(visit.equipment.values_list("id", flat=True)) == set(equipment_ids)
                and (not data.get("occurred_at") or data["occurred_at"] == visit.finished_at)
            ):
                return visit
            raise DomainConflict("Etapa já concluída; recursos/horário não podem ser substituídos.")
        if not visit.started_at or at < visit.started_at:
            raise ValidationError("Registre o início da etapa e respeite a ordem cronológica.")
        _same_day(appointment.started_at, at)
        visit.finished_at = at
        visit.worker_count = workers
        visit.resources_confirmed = True
        visit.equipment.set(equipment_ids)
    visit.save()
    _event(
        appointment,
        user,
        "visit_" + action,
        {"visit_id": str(visit.id), "warehouse_id": str(visit.warehouse_id)},
        at=at,
    )
    return visit


@transaction.atomic
def cancel(user, appointment_id, data):
    require_role(user, "warehouse", "supplier")
    appointment = _lock_appointment(appointment_id)
    _expected_revision(appointment, data)
    reason = data["reason"].strip()
    if not reason:
        raise ValidationError("Informe o motivo do cancelamento.")
    if appointment.operation_status == "cancelled":
        return appointment
    _editable(appointment)
    _hold_capacity(appointment, user, "Cancelamento: " + reason)
    appointment.operation_status = "cancelled"
    _event(
        appointment,
        user,
        "cancelled",
        {"reason": reason, "capacity": "held_for_named_warehouse_assignment"},
    )
    return appointment


@transaction.atomic
def reschedule(user, appointment_id, data):
    require_role(user, "warehouse")
    target = get_slot(data["date"], data["time"])
    appointment = _lock_appointment(appointment_id, [target.id])
    _expected_revision(appointment, data)
    _editable(appointment)
    reason = data["reason"].strip()
    if not reason:
        raise ValidationError("Reagendamento exige justificativa.")
    nature = data.get("nature_exception", False)
    if not nature:
        raise ValidationError("Este fluxo é para caso fortuito de natureza; confirme a ocorrência.")
    if appointment.slot_id == target.id:
        if appointment.events.filter(
            kind="rescheduled", data__target_slot_id=str(target.id), data__reason=reason
        ).exists():
            return appointment
        raise ValidationError("Escolha outra data ou horário.")
    validate_capacity(
        target, appointment.packaging, exclude_appointment=appointment.id, nature_exception=nature
    )
    target_occupied_before = occupancy(target, exclude_appointment=appointment.id)["occupied_units"]
    source = appointment.slot
    # The reservation moves: the source slot is released, not held, so it is bookable again.
    appointment.slot = target
    appointment.capacity_reserved = True
    appointment.nature_exception = nature
    appointment.arrived_at = None
    appointment.operation_status = "waiting"
    _event(
        appointment,
        user,
        "rescheduled",
        {
            "reason": reason,
            "nature_exception": nature,
            "source_date": str(source.date),
            "source_time": source.time,
            "target_date": str(target.date),
            "target_time": target.time,
            "source_slot_id": str(source.id),
            "target_slot_id": str(target.id),
            "global_capacity": 2,
            "target_occupied_units_before": target_occupied_before,
            "target_occupied_units_after": target_occupied_before + appointment.units,
            "capacity_exceeded": target_occupied_before + appointment.units > 2,
        },
    )
    return appointment


@transaction.atomic
def assign_cancelled_capacity(user, *, hold_id, appointment_id, expected_revision=None):
    require_role(user, "warehouse")
    hold_snapshot = CapacityHold.objects.get(id=hold_id)
    appointment = _lock_appointment(appointment_id, [hold_snapshot.slot_id])
    _expected_revision(appointment, {"expected_revision": expected_revision})
    hold = CapacityHold.objects.select_for_update().get(id=hold_id)
    if not hold.active:
        if hold.assigned_to_id == appointment.id:
            return appointment
        raise DomainConflict("Esta capacidade já foi atribuída.")
    _editable(appointment)
    if appointment.slot_id == hold.slot_id and appointment.capacity_reserved:
        raise DomainConflict(
            "Este destinatário já tem reserva no horário. Escolha agendamento sem reserva ou de outro horário."
        )
    if appointment.units > hold.units:
        raise DomainConflict("A carga não cabe na capacidade retida.")
    validate_capacity(
        hold.slot, appointment.packaging, exclude_appointment=appointment.id, exclude_hold=hold.id
    )
    # The appointment moves into the held slot; its previous slot is released, not held.
    appointment.slot_id = hold.slot_id
    appointment.capacity_reserved = True
    appointment.nature_exception = False
    hold.units -= appointment.units
    hold.active = hold.units > 0
    hold.exclusive = False
    hold.assigned_to = appointment
    hold.save()
    _event(
        appointment,
        user,
        "capacity_assigned",
        {
            "hold_id": str(hold.id),
            "source_appointment_id": str(hold.source_appointment_id),
            "assigned_by": user.id,
        },
    )
    return appointment


@transaction.atomic
def create_non_receipt(user, data):
    require_role(user, "warehouse")
    appointment = None
    if data.get("appointment"):
        appointment = _lock_appointment(data["appointment"].id)
        _expected_revision(appointment, data)
        existing = NonReceipt.objects.filter(appointment=appointment).first()
        if existing:
            if existing.reason == data["reason"] and existing.description == data.get(
                "description", ""
            ):
                return existing
            raise DomainConflict("Não recebimento já registrado com outro motivo.")
        _editable(appointment)
        if data["reason"] == "unscheduled_no_capacity":
            raise ValidationError(
                "Sem agendamento e sem vaga deve ser uma ocorrência avulsa, sem agendamento associado."
            )
        supplier = appointment.supplier
        origin = appointment.origin
        at = _occurred_at(data)
        if appointment.arrived_at and at < appointment.arrived_at:
            raise ValidationError("Não recebimento não pode anteceder a chegada registrada.")
        _hold_capacity(appointment, user, "Não recebimento: " + data["reason"])
        appointment.operation_status = "not_received"
        _event(
            appointment,
            user,
            "not_received",
            {"reason": data["reason"], "description": data.get("description", "")},
            at=at,
        )
    else:
        supplier = data.get("supplier")
        origin = (
            "demo_sintetico"
            if supplier and supplier.origin == "demo_sintetico"
            else data.get("origin", "operacional_registrado")
        )
        if origin == "demo_sintetico" and supplier and supplier.origin != "demo_sintetico":
            raise ValidationError(
                {
                    "origin": "Demonstração exige fornecedor sintético ou ocorrência avulsa sem fornecedor."
                }
            )
        if origin not in {"demo_sintetico", "operacional_registrado"}:
            raise ValidationError({"origin": "Origem inválida para registro manual."})
        at = _occurred_at(data)
    if data["reason"] == "other" and not data.get("description", "").strip():
        raise ValidationError("O motivo 'outro' exige descrição.")
    return NonReceipt.objects.create(
        appointment=appointment,
        supplier=supplier,
        reason=data["reason"],
        description=data.get("description", ""),
        vehicle_plate=data.get("vehicle_plate", ""),
        occurred_at=at,
        origin=origin,
        created_by=user,
    )
