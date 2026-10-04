"""Escala dos chapas: planejar quem trabalha, confirmar presença e alimentar a equipe do boletim.

A escala responde "quantos teremos"; o plano da agenda responde "quantos a agenda exige ao mesmo tempo";
o boletim responde "quantos foram pagos". Sobra só se conclui com o boletim (complemento), porque o
carregamento ao cooperado não aparece na agenda.
"""
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Warehouse, Worker
from core.models import ORIGIN_CHOICES
from core.permissions import IsInternal, require_role
from labor.allocation import season_target
from labor.allocation_service import day_plan
from labor.models import DailyBulletin, RosterShift
from receiving.models import Holiday

MAX_TEAM = 20


def shift_values(item):
    return {"id": str(item.pk), "worker": str(item.worker_id), "registration": item.worker.registration,
            "name": item.worker.name, "contract_type": item.worker.contract_type, "date": item.date.isoformat(),
            "origin": item.origin, "warehouse": str(item.warehouse_id) if item.warehouse_id else None,
            "warehouse_name": item.warehouse.name if item.warehouse_id else None, "period": item.period,
            "activity": item.activity, "attendance": item.attendance, "fraction": str(item.fraction),
            "notes": item.notes, "updated_at": item.updated_at.isoformat()}


def day_balance(plan, scheduled, target):
    """Sinal do dia, sem concluir sobra (a agenda não mostra o carregamento ao cooperado)."""
    required = plan["peak_chapas"]
    if plan["day_type"] in ("sunday", "holiday"):
        return {"status": "closed", "message": "Sem expediente."}
    if plan["day_type"] == "saturday":
        return {"status": "info", "message": "Sábado: organização interna, paga pelo piso das pessoas presentes."}
    if scheduled < required:
        return {"status": "shortage", "message": f"Falta: a agenda exige {required} chapas ao mesmo tempo e há "
                                                 f"{format(scheduled, 'f')} diárias escaladas."}
    if scheduled < target["min"]:
        return {"status": "attention", "message": f"Cobre o pico da agenda ({required}), mas está abaixo do quadro de "
                                                  f"referência da temporada ({target['min']}) para atender o cooperado."}
    if scheduled > target["max"] + 2 and required < scheduled / 2:
        return {"status": "watch", "message": "Escala bem acima do pico da agenda e do quadro de referência: "
                                              "acompanhe o complemento do boletim (sinal de sobra)."}
    return {"status": "ok", "message": "Escala cobre o pico da agenda e o quadro de referência."}


class RosterFilters(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")

    def validate(self, data):
        today = timezone.localdate()
        start = data.get("date_from") or today - timedelta(days=today.weekday())
        end = data.get("date_to") or start + timedelta(days=6)
        if start > end or (end - start).days > 31:
            raise serializers.ValidationError("Informe um período de até 31 dias, com início antes do fim.")
        data.update(date_from=start, date_to=end)
        return data


class ShiftInput(serializers.Serializer):
    worker = serializers.PrimaryKeyRelatedField(queryset=Worker.objects.all())
    date = serializers.DateField()
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.all(), allow_null=True, required=False)
    period = serializers.ChoiceField(choices=RosterShift.PERIODS, default="FULL")
    activity = serializers.ChoiceField(choices=RosterShift.ACTIVITIES, required=False)
    notes = serializers.CharField(max_length=500, allow_blank=True, required=False)

    def validate(self, data):
        day, worker = data["date"], data["worker"]
        if not worker.is_active:
            raise serializers.ValidationError({"worker": "Pessoa inativa não pode ser escalada."})
        if data["origin"] == "historico_importado":
            raise serializers.ValidationError({"origin": "Escala é planejamento; histórico não se escala."})
        if (worker.origin == "demo_sintetico") != (data["origin"] == "demo_sintetico"):
            raise serializers.ValidationError({"origin": "Dados de demonstração nunca se misturam com a operação real."})
        if day.weekday() == 6 or Holiday.objects.filter(date=day).exists():
            raise serializers.ValidationError({"date": "Domingo e feriado não têm expediente."})
        if day.weekday() == 5:
            data["activity"] = "ORGANIZATION"
        data.setdefault("activity", "OPERATION")
        return data


def guard_team_size(day, origin, exclude=None):
    query = RosterShift.objects.filter(date=day, origin=origin).exclude(attendance="ABSENT")
    if exclude:
        query = query.exclude(pk=exclude)
    if query.count() >= MAX_TEAM:
        raise ValidationError({"worker": f"O boletim do dia aceita até {MAX_TEAM} pessoas; a escala já tem {MAX_TEAM}."})


class RosterView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        filters = RosterFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        shifts = list(RosterShift.objects.filter(date__range=(data["date_from"], data["date_to"]), origin=data["origin"])
                      .select_related("worker", "warehouse"))
        bulletins = {b.reference_date: b for b in DailyBulletin.objects.filter(
            reference_date__range=(data["date_from"], data["date_to"]), origin=data["origin"], warehouse__isnull=True)}
        days = []
        current = data["date_from"]
        while current <= data["date_to"]:
            entries = [shift_values(s) for s in shifts if s.date == current]
            scheduled = sum((s.fraction for s in shifts if s.date == current), Decimal(0))
            present = sum((s.fraction for s in shifts if s.date == current and s.attendance == "PRESENT"), Decimal(0))
            plan = day_plan(current, data["origin"])
            target = season_target(current)
            bulletin = bulletins.get(current)
            days.append({
                "date": current.isoformat(), "day_type": plan["day_type"], "holiday": plan["holiday"],
                "entries": entries, "scheduled_equivalents": format(scheduled, "f"),
                "present_equivalents": format(present, "f"),
                "absences": sum(1 for s in shifts if s.date == current and s.attendance == "ABSENT"),
                "plan": {key: plan[key] for key in ("peak_chapas", "peak_gas_forklifts", "loads", "person_hours",
                                                    "after_hours_loads", "forklift_conflicts")},
                "slots": [{"time": slot["time"], "chapas": slot["chapas"], "gas_forklifts": slot["gas_forklifts"],
                           "after_hours": slot["after_hours"], "warnings": slot["warnings"]} for slot in plan["slots"]],
                "season_target": target, "balance": day_balance(plan, scheduled, target),
                "bulletin": {"id": str(bulletin.pk), "status": bulletin.status,
                             "equivalent_days": (bulletin.calculation or {}).get("equivalent_days")
                             if bulletin.status == "CLOSED" else None} if bulletin else None,
            })
            current += timedelta(days=1)
        workers = Worker.objects.filter(is_active=True)
        workers = workers.filter(origin="demo_sintetico") if data["origin"] == "demo_sintetico" else \
            workers.exclude(origin="demo_sintetico")
        return Response({
            "period": {"date_from": data["date_from"].isoformat(), "date_to": data["date_to"].isoformat()},
            "origin": data["origin"], "days": days,
            "workers": [{"id": str(w.pk), "registration": w.registration, "name": w.name,
                         "contract_type": w.contract_type} for w in workers],
            "rules": ["Até 20 pessoas por dia, cada uma uma vez (o boletim é único por dia).",
                      "Integral vale 1 diária; manhã ou tarde valem meia diária.",
                      "Descarga iniciada não para: quem está na carga das 15h fica até o fim.",
                      "Sábado é organização interna; domingo e feriado não têm expediente."],
        })

    @transaction.atomic
    def post(self, request):
        """Inclui ou altera a escala de uma pessoa num dia (uma linha por pessoa/dia)."""
        require_role(request.user, "warehouse")
        serializer = ShiftInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        existing = RosterShift.objects.select_for_update().filter(
            worker=data["worker"], date=data["date"], origin=data["origin"]).first()
        if existing is None:
            guard_team_size(data["date"], data["origin"])
        fields = {key: data.get(key) for key in ("warehouse", "period", "activity")}
        fields["notes"] = data.get("notes", "")
        try:
            item, created = RosterShift.objects.update_or_create(
                worker=data["worker"], date=data["date"], origin=data["origin"],
                defaults={**fields, "updated_by": request.user}, create_defaults={
                    **fields, "created_by": request.user, "updated_by": request.user})
        except IntegrityError:
            raise ValidationError("A escala desta pessoa foi alterada por outro operador; recarregue.") from None
        return Response(shift_values(item), status=201 if created else 200)


class AttendanceInput(serializers.Serializer):
    attendance = serializers.ChoiceField(choices=RosterShift.ATTENDANCE)
    period = serializers.ChoiceField(choices=RosterShift.PERIODS, required=False)


class RosterShiftDetailView(APIView):
    permission_classes = [IsInternal]

    @transaction.atomic
    def patch(self, request, pk):
        """Confirma presença, falta ou meia diária no dia."""
        require_role(request.user, "warehouse")
        item = get_object_or_404(RosterShift.objects.select_for_update(), pk=pk)
        serializer = AttendanceInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if item.attendance == "ABSENT" and data["attendance"] != "ABSENT":
            guard_team_size(item.date, item.origin, exclude=item.pk)
        item.attendance = data["attendance"]
        item.period = data.get("period", item.period)
        item.updated_by = request.user
        item.save(update_fields=["attendance", "period", "updated_by", "updated_at"])
        return Response(shift_values(item))

    @transaction.atomic
    def delete(self, request, pk):
        require_role(request.user, "warehouse")
        item = get_object_or_404(RosterShift, pk=pk)
        item.delete()
        return Response(status=204)


class CopyWeekInput(serializers.Serializer):
    source_week_start = serializers.DateField()
    target_week_start = serializers.DateField()
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default="operacional_registrado")

    def validate(self, data):
        if data["source_week_start"] == data["target_week_start"]:
            raise serializers.ValidationError("Escolha semanas diferentes.")
        return data


class RosterCopyWeekView(APIView):
    permission_classes = [IsInternal]

    @transaction.atomic
    def post(self, request):
        """Repete a escala de uma semana em outra, sem sobrescrever o que já foi escalado."""
        require_role(request.user, "warehouse")
        serializer = CopyWeekInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        offset = data["target_week_start"] - data["source_week_start"]
        source = RosterShift.objects.filter(
            origin=data["origin"], date__range=(data["source_week_start"], data["source_week_start"] + timedelta(days=6)),
        ).select_related("worker")
        holidays = set(Holiday.objects.filter(
            date__range=(data["target_week_start"], data["target_week_start"] + timedelta(days=6))
        ).values_list("date", flat=True))
        created, skipped = 0, 0
        for item in source:
            day = item.date + offset
            exists = RosterShift.objects.filter(worker=item.worker, date=day, origin=item.origin).exists()
            full = RosterShift.objects.filter(date=day, origin=item.origin).exclude(attendance="ABSENT").count() >= MAX_TEAM
            if exists or full or not item.worker.is_active or day.weekday() == 6 or day in holidays:
                skipped += 1
                continue
            RosterShift.objects.create(worker=item.worker, date=day, origin=item.origin, warehouse=item.warehouse,
                                       period=item.period, activity="ORGANIZATION" if day.weekday() == 5 else item.activity,
                                       notes=item.notes, created_by=request.user, updated_by=request.user)
            created += 1
        return Response({"created": created, "skipped": skipped})


class RosterTeamView(APIView):
    """Equipe sugerida para o boletim do dia: cada matrícula uma vez, com 1 ou 0,5 diária."""
    permission_classes = [IsInternal]

    def get(self, request):
        day = serializers.DateField().run_validation(request.query_params.get("date"))
        origin = serializers.ChoiceField(choices=ORIGIN_CHOICES).run_validation(
            request.query_params.get("origin", "operacional_registrado"))
        shifts = RosterShift.objects.filter(date=day, origin=origin).exclude(attendance="ABSENT").select_related("worker")
        participants = [{"worker": str(s.worker_id), "registration": s.worker.registration, "name": s.worker.name,
                         "fraction": "1.0" if s.period == "FULL" else "0.5", "confirmed": s.attendance == "PRESENT"}
                        for s in shifts]
        return Response({
            "date": day.isoformat(), "origin": origin, "participants": participants,
            "unconfirmed": sum(1 for p in participants if not p["confirmed"]),
            "absences": RosterShift.objects.filter(date=day, origin=origin, attendance="ABSENT").count(),
            "note": "Confira a equipe antes de fechar: pessoas ainda não confirmadas aparecem como escaladas.",
        })
