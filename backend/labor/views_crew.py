"""Equipe da descarga: o armazém direciona chapas e equipamentos para cada etapa (caminhão × armazém).

A norma sugere quantos chapas e qual empilhadeira; o responsável escolhe quem vai entre os escalados
do dia e confirma ou troca. Os nomes ficam em LaborActivity (RECEIVING); a quantidade e os
equipamentos confirmados continuam sendo gravados na saída do armazém (check-out da etapa).
"""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Equipment, Worker
from core.permissions import IsInternal, require_role
from labor.allocation import GAS_FORKLIFT, NORMS, requirement
from labor.allocation_service import load_estimate, observed_times
from labor.models import LaborActivity, RosterShift, WorkerDay
from receiving.models import WarehouseVisit

KIND_LABELS = dict(Equipment._meta.get_field("kind").choices)


def _crew_query(visit):
    return LaborActivity.objects.filter(appointment=visit.appointment, warehouse=visit.warehouse,
                                        activity_type="RECEIVING").select_related("worker_day__worker")


def _busy_elsewhere(visit, day, origin):
    """Pessoas e equipamentos em outra etapa em andamento no mesmo dia (entrou e ainda não saiu)."""
    running = list(WarehouseVisit.objects.filter(
        appointment__slot__date=day, appointment__origin=origin,
        checked_in_at__isnull=False, checked_out_at__isnull=True,
    ).exclude(pk=visit.pk).select_related("warehouse").prefetch_related("equipment"))
    stages = {(other.appointment_id, other.warehouse_id): other.warehouse.name for other in running}
    people = {
        activity.worker_day.worker_id: stages[(activity.appointment_id, activity.warehouse_id)]
        for activity in LaborActivity.objects.filter(
            activity_type="RECEIVING", used=True, worker_day__reference_date=day, worker_day__origin=origin,
        ).select_related("worker_day")
        if (activity.appointment_id, activity.warehouse_id) in stages
    }
    equipment = {item.pk: other.warehouse.name for other in running for item in other.equipment.all()}
    return people, equipment


def _allowed_equipment(visit):
    query = Equipment.objects.filter(is_active=True).select_related("warehouse")
    return [item for item in query if item.mobile or not item.warehouse_id or item.warehouse_id == visit.warehouse_id]


def crew_payload(visit):
    ap = visit.appointment
    day, origin = ap.slot.date, ap.origin
    weight, units = load_estimate(ap)
    observed, _ = observed_times(origin, day)
    req = requirement(ap.packaging, weight, units, observed.get(ap.packaging))
    busy_people, busy_equipment = _busy_elsewhere(visit, day, origin)
    crew = {activity.worker_day.worker_id for activity in _crew_query(visit) if activity.used}
    roster = {shift.worker_id: shift for shift in RosterShift.objects.filter(date=day, origin=origin).select_related("worker")}
    workers = Worker.objects.filter(is_active=True)
    workers = workers.filter(origin="demo_sintetico") if origin == "demo_sintetico" else workers.exclude(origin="demo_sintetico")
    people = []
    for worker in workers:
        shift = roster.get(worker.pk)
        if not shift and worker.pk not in crew:
            continue
        people.append({
            "id": str(worker.pk), "registration": worker.registration, "name": worker.name,
            "attendance": shift.attendance if shift else None, "in_crew": worker.pk in crew,
            "busy_at": busy_people.get(worker.pk),
        })
    people.sort(key=lambda p: (not p["in_crew"], p["attendance"] == "ABSENT", p["busy_at"] is not None, p["registration"]))
    others = [{"id": str(w.pk), "registration": w.registration, "name": w.name}
              for w in workers if w.pk not in roster and w.pk not in crew]
    planned = set(visit.equipment.values_list("id", flat=True))
    allowed = _allowed_equipment(visit)
    gas_own = [e for e in allowed if e.kind == GAS_FORKLIFT and e.warehouse_id == visit.warehouse_id and e.pk not in busy_equipment]
    gas_mobile = [e for e in allowed if e.kind == GAS_FORKLIFT and e.warehouse_id != visit.warehouse_id and e.mobile
                  and e.warehouse and e.warehouse.code != "MAQUINAS" and e.pk not in busy_equipment]
    suggested_equipment = (gas_own or gas_mobile)[:1] if req.gas_forklifts else []
    norm = NORMS[ap.packaging]
    needed = req.chapas + req.operators
    return {
        "visit": str(visit.pk), "appointment": str(ap.pk), "warehouse": str(visit.warehouse_id),
        "warehouse_name": visit.warehouse.name, "date": day.isoformat(), "origin": origin,
        "stage": "done" if visit.checked_out_at else "running" if visit.checked_in_at else "waiting",
        "suggestion": {
            "packaging": ap.packaging, "packaging_label": norm["label"], "chapas": req.chapas, "operators": req.operators,
            "people": needed, "gas_forklifts": req.gas_forklifts, "equipment_hint": norm["equipment"],
            "unload_minutes": format(req.unload_minutes, ".0f"), "cycle_minutes": format(req.cycle_minutes, ".0f"),
            "estimated": req.estimated, "light_load": req.light_load, "notes": list(req.notes),
            "equipment": [str(e.pk) for e in suggested_equipment],
            "text": ("Carga leve (abaixo de 500 kg): não exige chapas." if req.light_load else
                     f"{norm['label']}: {needed} {'pessoa' if needed == 1 else 'pessoas'}"
                     + (f" + {req.gas_forklifts} empilhadeira a gás" if req.gas_forklifts else "")
                     + f" · cerca de {format(req.cycle_minutes, '.0f')} min até guardar tudo"),
            "forklift_warning": ("Nenhuma empilhadeira a gás livre para este armazém agora." if req.gas_forklifts
                                 and not suggested_equipment else None),
            "borrowed": bool(suggested_equipment and suggested_equipment[0].warehouse_id != visit.warehouse_id),
        },
        "crew": [str(w) for w in crew],
        "people": people, "others": others,
        "equipment": [{"id": str(e.pk), "name": e.name, "kind": e.kind, "kind_label": KIND_LABELS.get(e.kind, ""),
                       "warehouse_name": e.warehouse.name if e.warehouse_id else None,
                       "own": e.warehouse_id == visit.warehouse_id, "planned": e.pk in planned,
                       "busy_at": busy_equipment.get(e.pk)} for e in allowed],
    }


class CrewInput(serializers.Serializer):
    worker_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True, max_length=40)
    equipment_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True, required=False, max_length=20)


class VisitCrewView(APIView):
    permission_classes = [IsInternal]

    def get(self, request, pk):
        visit = get_object_or_404(WarehouseVisit.objects.select_related("appointment__slot", "warehouse"), pk=pk)
        return Response(crew_payload(visit))

    @transaction.atomic
    def post(self, request, pk):
        require_role(request.user, "warehouse")
        visit = get_object_or_404(WarehouseVisit.objects.select_for_update().select_related("appointment__slot", "warehouse"), pk=pk)
        serializer = CrewInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        ap = visit.appointment
        day, origin = ap.slot.date, ap.origin
        ids = list(dict.fromkeys(data["worker_ids"]))
        workers = {w.pk: w for w in Worker.objects.select_for_update().filter(pk__in=ids)}
        if len(workers) != len(ids):
            raise ValidationError({"worker_ids": "Pessoa não encontrada no cadastro."})
        for worker in workers.values():
            if not worker.is_active:
                raise ValidationError({"worker_ids": f"{worker.name} está inativa."})
            if (worker.origin == "demo_sintetico") != (origin == "demo_sintetico"):
                raise ValidationError({"worker_ids": "Dados de demonstração nunca se misturam com a operação real."})
        absent = RosterShift.objects.filter(date=day, origin=origin, worker_id__in=ids, attendance="ABSENT")
        if absent.exists():
            raise ValidationError({"worker_ids": "Marcada como falta na escala: " + ", ".join(s.worker.name for s in absent)})
        if "equipment_ids" in data:
            if visit.checked_out_at:
                raise ValidationError({"equipment_ids": "A etapa já saiu do armazém; corrija os equipamentos na saída."})
            allowed = {e.pk for e in _allowed_equipment(visit)}
            if any(eid not in allowed for eid in data["equipment_ids"]):
                raise ValidationError({"equipment_ids": "Equipamento fixo de outro armazém ou inativo."})
            visit.equipment.set(data["equipment_ids"])
        current = {activity.worker_day.worker_id: activity for activity in _crew_query(visit)}
        for worker_id, activity in current.items():
            if worker_id not in workers and activity.used:
                if activity.history.exists():
                    activity.used, activity.notes = False, (activity.notes + " · Retirado da equipe da descarga").strip(" ·")
                    activity.save(update_fields=["used", "notes", "updated_at"])
                else:
                    activity.delete()
        for worker in workers.values():
            if worker.pk in current:
                if not current[worker.pk].used:
                    current[worker.pk].used = True
                    current[worker.pk].save(update_fields=["used", "updated_at"])
                continue
            worker_day, _ = WorkerDay.objects.get_or_create(worker=worker, reference_date=day, origin=origin)
            LaborActivity.objects.create(worker_day=worker_day, warehouse=visit.warehouse, appointment=ap,
                                         activity_type="RECEIVING", attendance_state="PRESENT", used=True,
                                         started_at=visit.checked_in_at, created_by=request.user)
            # Quem foi para a descarga veio trabalhar: a escala do dia reflete a presença.
            shift = RosterShift.objects.filter(worker=worker, date=day, origin=origin).first()
            if shift is None and day.weekday() != 6:
                RosterShift.objects.create(worker=worker, date=day, origin=origin, warehouse=visit.warehouse,
                                           attendance="PRESENT", created_by=request.user, updated_by=request.user)
            elif shift and shift.attendance == "PLANNED":
                shift.attendance, shift.updated_by = "PRESENT", request.user
                shift.save(update_fields=["attendance", "updated_by", "updated_at"])
        return Response(crew_payload(visit))
