"""Painel da descarga: as etapas do dia (caminhão × armazém) com a equipe e os equipamentos de cada uma.

Só leitura. Escalar a equipe continua em ``allocation/visits/<id>/crew/`` e a entrada/saída do armazém
continua nos comandos da etapa (``warehouse-visits/<id>/check-in|check-out/``); este painel junta tudo
para o armazém conduzir o dia sem abrir agendamento por agendamento.
"""
from collections import defaultdict

from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import ORIGIN_CHOICES
from core.permissions import IsInternal
from labor.allocation import NORMS, requirement
from labor.allocation_service import INACTIVE_OPERATION, load_estimate, observed_times
from labor.models import LaborActivity
from receiving.models import WarehouseVisit
from receiving.workflow import visit_actions

STAGE_ORDER = {"running": 0, "ready": 1, "waiting": 2, "done": 3}


class UnloadFilters(serializers.Serializer):
    date = serializers.DateField(required=False)
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")


def _waiting_reason(ap, visit, visits):
    """O que falta para a etapa poder entrar no armazém, na ordem em que acontece."""
    if not ap.gate_checked_in_at:
        return "Aguardando chegada na portaria."
    if ap.purchase_status != "approved":
        return "Aguardando conferência de Compras."
    if ap.warehouse_status != "approved":
        return "Aguardando confirmação dos destinos."
    if not ap.capacity_reserved:
        return "Sem reserva de vaga ativa."
    previous = next((v for v in visits if v.sequence < visit.sequence and not v.checked_out_at), None)
    if previous:
        return f"Aguardando a etapa no {previous.warehouse.name}."
    return ""


def _stage(ap, visit, visits):
    if visit.checked_out_at:
        return "done", ""
    if visit.checked_in_at:
        return "running", ""
    reason = _waiting_reason(ap, visit, visits)
    if not reason and ap.operation_status not in {"arrived", "in_progress"}:
        reason = "Recebimento fora da etapa de descarga."
    return ("waiting", reason) if reason else ("ready", "")


def unloads_payload(day, origin, user, today=None):
    visits = list(
        WarehouseVisit.objects.filter(appointment__slot__date=day, appointment__origin=origin,
                                      appointment__workflow_version=2)
        .exclude(appointment__operation_status__in=INACTIVE_OPERATION)
        .exclude(appointment__purchase_status="rejected")
        .select_related("warehouse", "appointment__slot", "appointment__supplier", "appointment__invoice")
        .prefetch_related("equipment", "appointment__visits__warehouse")
    )
    crews = defaultdict(list)
    for activity in (LaborActivity.objects.filter(activity_type="RECEIVING", used=True,
                                                  appointment__in={v.appointment_id for v in visits})
                     .select_related("worker_day__worker")):
        worker = activity.worker_day.worker
        crews[(activity.appointment_id, activity.warehouse_id)].append(
            {"id": str(worker.pk), "name": worker.name, "registration": worker.registration})
    observed, _ = observed_times(origin, day)
    needs = {}
    items = []
    for visit in visits:
        ap = visit.appointment
        siblings = list(ap.visits.all())
        if ap.pk not in needs:
            weight, units = load_estimate(ap)
            needs[ap.pk] = requirement(ap.packaging, weight, units, observed.get(ap.packaging))
        need = needs[ap.pk]
        stage, reason = _stage(ap, visit, siblings)
        crew = sorted(crews[(ap.pk, visit.warehouse_id)], key=lambda person: person["name"])
        actions = {item["code"]: {"allowed": item["allowed"], "reason": item["reason"]}
                   for item in visit_actions(visit, user)}
        # O servidor só aceita a entrada na data local da reserva; o painel avisa antes do clique.
        if actions.get("check-in", {}).get("allowed") and today and today != day:
            actions["check-in"] = {"allowed": False, "reason": (
                f"A entrada no armazém só pode ser registrada no dia da descarga ({day:%d/%m})."
            )}
        items.append({
            "visit": str(visit.pk), "appointment": str(ap.pk), "revision": ap.revision,
            "sequence": visit.sequence, "stages": len(siblings),
            "warehouse": str(visit.warehouse_id), "warehouse_name": visit.warehouse.name,
            "slot": ap.slot.time, "supplier": ap.supplier.name, "vehicle_plate": ap.vehicle_plate,
            "packaging": ap.packaging, "packaging_label": NORMS.get(ap.packaging, {}).get("label", ap.packaging),
            "stage": stage, "waiting_reason": reason,
            "checked_in_at": visit.checked_in_at, "checked_out_at": visit.checked_out_at,
            "worker_count": visit.worker_count,
            "needed_chapas": need.chapas, "needed_gas_forklifts": need.gas_forklifts, "estimated": need.estimated,
            "crew": crew,
            "equipment": sorted(({"id": str(e.pk), "name": e.name} for e in visit.equipment.all()),
                                key=lambda item: item["name"]),
            "actions": actions,
        })
    items.sort(key=lambda item: (STAGE_ORDER[item["stage"]], item["slot"], item["supplier"], item["sequence"]))
    active = [item for item in items if item["stage"] != "done"]
    return {
        "date": day.isoformat(), "origin": origin,
        "summary": {
            "running": sum(1 for item in items if item["stage"] == "running"),
            "ready": sum(1 for item in items if item["stage"] == "ready"),
            "waiting": sum(1 for item in items if item["stage"] == "waiting"),
            "done": sum(1 for item in items if item["stage"] == "done"),
            "chapas_now": sum(len(item["crew"]) for item in items if item["stage"] == "running"),
            "without_crew": sum(1 for item in active if not item["crew"]),
        },
        "items": items,
    }


class UnloadBoardView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        filters = UnloadFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        today = timezone.localdate()
        return Response(unloads_payload(data.get("date") or today, data["origin"], request.user, today))
