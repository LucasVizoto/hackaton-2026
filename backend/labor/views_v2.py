from datetime import timedelta
from decimal import Decimal
from collections import defaultdict

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from catalog.models import Worker
from core.permissions import IsInternal, require_role, user_role
from imports.models import HistoricalWorkerDay
from labor.calculation import DAILY_SERVICE_PRICES, allocate_individuals, calculate_v2
from labor.models import (DailyBulletin, BulletinParticipant, BulletinRevision, WorkerDay,
                          LaborActivity, LaborActivityRevision, LaborRuleOccurrence, ProductionRecord)
from labor.serializers_v2 import BulletinInputV2, BulletinPreviewInputV2, ActivityInput, OccurrenceInput, ProductionInput
from labor.constants import FLOOR
from labor.services import check_revision, reopen_bulletin, replace_contents, service_rates, values
from labor.views import BulletinListView, BulletinDetailView, RatesView


def paginated(query, request, serialize):
    pager = PageNumberPagination()
    return pager.get_paginated_response([serialize(item) for item in pager.paginate_queryset(query, request)])


def require_draft(bulletin):
    if bulletin.status != 'DRAFT':
        raise ValidationError('Boletim fechado é imutável; reabra com motivo para corrigir.')


def snapshot(bulletin, actor, reason):
    BulletinRevision.objects.create(bulletin=bulletin, revision=bulletin.revision, actor=actor,
                                    reason=reason, snapshot=values(bulletin))


class RatesViewV2(RatesView):
    def get(self, request):
        response = super().get(request)
        response.data['daily_services'] = [{'kind': kind, 'price': str(price)} for kind, price in DAILY_SERVICE_PRICES.items()]
        return response


class BulletinListV2(BulletinListView):
    def post(self, request):
        require_role(request.user, 'warehouse')
        serializer = BulletinInputV2(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            with transaction.atomic():
                bulletin = DailyBulletin.objects.create(warehouse=data['warehouse'], reference_date=data['reference_date'],
                    origin=data['origin'], created_by=request.user, financial_version='boletim-v2')
                replace_contents(bulletin, data)
        except IntegrityError:
            raise ValidationError('Já existe boletim para este local/data ou participação financeira para a pessoa/data.') from None
        return Response(values(bulletin), status=201)


class BulletinDetailV2(BulletinDetailView):
    @transaction.atomic
    def patch(self, request, pk):
        require_role(request.user, 'warehouse')
        bulletin = get_object_or_404(DailyBulletin.objects.select_for_update(), pk=pk)
        check_revision(bulletin, request.data.get('revision'))
        require_draft(bulletin)
        if any(key in request.data for key in ('warehouse', 'reference_date', 'origin')):
            raise ValidationError('Local, data e origem não mudam nesta revisão.')
        serializer = BulletinInputV2(data={**request.data, 'origin': bulletin.origin}, partial=True)
        serializer.is_valid(raise_exception=True)
        if bulletin.financial_version != 'boletim-v2':
            raise ValidationError('Boletim legado conserva seu cálculo; use a revisão compatível na API v1.')
        snapshot(bulletin, request.user, 'Antes da edição')
        replace_contents(bulletin, serializer.validated_data)
        bulletin.revision += 1
        bulletin.save(update_fields=['revision'])
        return Response(values(bulletin))


class BulletinPreviewV2(APIView):
    permission_classes = [IsInternal]

    def post(self, request):
        if 'production_records' in request.data:
            raise ValidationError({'production_records': 'A prévia utiliza apenas fontes persistidas do boletim informado.'})
        serializer = BulletinPreviewInputV2(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        bulletin = data.get('bulletin')
        sources, pending = [], False
        if bulletin:
            require_draft(bulletin)
            if (bulletin.warehouse_id, bulletin.reference_date, bulletin.origin) != (data['warehouse'].pk, data['reference_date'], data['origin']):
                raise ValidationError({'bulletin': 'Local, data e origem devem coincidir com o boletim da prévia.'})
            sources = values(bulletin)['production_records']
            pending = bulletin.rule_occurrences.filter(resolved_at=None).exists()
        rates = service_rates()
        people = [{**p, 'worker': str(p['worker'].pk)} for p in data['participants']]
        result = calculate_v2([{**line, 'price': rates[line['category']]} for line in data['lines']], people,
            floor=bulletin.floor_per_day if bulletin else FLOOR, production_records=sources,
            daily_services=[{**item, 'quantity': str(item['quantity']), 'price': str(DAILY_SERVICE_PRICES[item['kind']])}
                            for item in data.get('daily_services', [])])
        if pending:
            result.update(status='pending_rule', provisional=True)
        return Response({**result, 'allocation_status': 'pending_rule' if pending else 'preview',
                         'individual_allocations': [] if pending else allocate_individuals(result, people)})


class BulletinHistoryView(APIView):
    permission_classes = [IsInternal]

    def get(self, request, pk):
        bulletin = get_object_or_404(DailyBulletin, pk=pk)
        return Response([{'id': str(item.pk), 'revision': item.revision, 'reason': item.reason,
                          'recorded_at': item.recorded_at, 'actor': item.actor_id, 'snapshot': item.snapshot}
                         for item in bulletin.history.order_by('recorded_at', 'id')])


class TransferInput(serializers.Serializer):
    worker = serializers.PrimaryKeyRelatedField(queryset=Worker.objects.all())
    target_bulletin = serializers.PrimaryKeyRelatedField(queryset=DailyBulletin.objects.all())
    revision = serializers.IntegerField(min_value=1)
    target_revision = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=2000)


class TransferWorkerView(APIView):
    permission_classes = [IsInternal]

    @transaction.atomic
    def post(self, request, pk):
        require_role(request.user, 'warehouse')
        serializer = TransferInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        locked = list(DailyBulletin.objects.select_for_update().filter(pk__in=[pk, data['target_bulletin'].pk]).order_by('pk'))
        source = next((b for b in locked if str(b.pk) == str(pk)), None)
        if not source:
            get_object_or_404(DailyBulletin, pk=pk)
        target = next((b for b in locked if b.pk == data['target_bulletin'].pk), None)
        if source.pk == target.pk or (source.reference_date, source.origin) != (target.reference_date, target.origin):
            raise ValidationError('Transfira para outro boletim da mesma data e origem.')
        if source.financial_version != 'boletim-v2' or target.financial_version != 'boletim-v2':
            raise ValidationError('Transferência exige boletins v2; legado preserva registros originais.')
        check_revision(source, data['revision'])
        check_revision(target, data['target_revision'])
        worker = Worker.objects.select_for_update().get(pk=data['worker'].pk)
        participant = get_object_or_404(BulletinParticipant, bulletin=source, worker=worker)
        if target.participants.count() >= 20:
            raise ValidationError('O boletim de destino já possui 20 pessoas.')
        reason = 'Transferência: ' + data['reason']
        for bulletin in locked:
            if bulletin.status == 'CLOSED':
                reopen_bulletin(bulletin.pk, request.user, bulletin.revision, reason)
                bulletin.refresh_from_db()
            else:
                snapshot(bulletin, request.user, reason)
        participant.bulletin = target
        participant.save(update_fields=['bulletin'])
        for bulletin in locked:
            bulletin.revision += 1
            bulletin.save(update_fields=['revision'])
            snapshot(bulletin, request.user, reason + ' — vínculo atualizado')
        return Response({'source': values(source), 'target': values(target)})


def activity_values(item):
    return {'id': str(item.pk), 'worker': str(item.worker_day.worker_id),
            'worker_name': item.worker_day.worker.name, 'reference_date': str(item.worker_day.reference_date),
            'origin': item.worker_day.origin, 'warehouse': str(item.warehouse_id), 'warehouse_name': item.warehouse.name,
            'appointment': str(item.appointment_id) if item.appointment_id else None,
            'equipment': str(item.equipment_id) if item.equipment_id else None,
            'activity_type': item.activity_type, 'attendance_state': item.attendance_state, 'used': item.used,
            'started_at': item.started_at.isoformat() if item.started_at else None,
            'finished_at': item.finished_at.isoformat() if item.finished_at else None,
            'notes': item.notes, 'revision': item.revision}


class PeriodFilters(serializers.Serializer):
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    origin = serializers.ChoiceField(choices=['demo_sintetico', 'operacional_registrado', 'historico_importado'], required=False)
    worker = serializers.UUIDField(required=False)
    warehouse = serializers.UUIDField(required=False)
    appointment = serializers.UUIDField(required=False)

    def validate(self, data):
        end = data.get('date_to', timezone.localdate())
        start = data.get('date_from', end - timedelta(days=30))
        if start > end:
            raise serializers.ValidationError('A data inicial deve preceder a final.')
        data.update(date_from=start, date_to=end)
        return data


class ActivityListView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        filters = PeriodFilters(data=request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        query = LaborActivity.objects.select_related('worker_day__worker', 'warehouse').filter(
            worker_day__reference_date__range=(data['date_from'], data['date_to']))
        for field in ('worker', 'origin'):
            if data.get(field):
                query = query.filter(**{f'worker_day__{field}': data[field]})
        for field in ('warehouse', 'appointment'):
            if data.get(field):
                query = query.filter(**{field: data[field]})
        return paginated(query.order_by('-worker_day__reference_date', 'id'), request, activity_values)

    @transaction.atomic
    def post(self, request):
        require_role(request.user, 'warehouse')
        serializer = ActivityInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        worker = Worker.objects.select_for_update().get(pk=data.pop('worker').pk)
        if not worker.is_active:
            raise ValidationError('Pessoa inativa não pode receber nova atividade.')
        day, _ = WorkerDay.objects.get_or_create(worker=worker, reference_date=data.pop('reference_date'), origin=data.pop('origin'))
        data.pop('revision', None)
        data.pop('reason', None)
        activity = LaborActivity.objects.create(worker_day=day, created_by=request.user, **data)
        LaborActivityRevision.objects.create(activity=activity, actor=request.user, reason='Criação', snapshot=activity_values(activity))
        return Response(activity_values(activity), status=201)


class ActivityDetailView(APIView):
    permission_classes = [IsInternal]

    def get(self, request, pk):
        return Response(activity_values(get_object_or_404(LaborActivity, pk=pk)))

    @transaction.atomic
    def patch(self, request, pk):
        require_role(request.user, 'warehouse')
        activity = get_object_or_404(LaborActivity.objects.select_for_update(), pk=pk)
        check_revision(activity, request.data.get('revision'))
        old = activity_values(activity)
        if any(field in request.data for field in ('worker', 'reference_date', 'origin')):
            raise ValidationError('Pessoa, data e origem da atividade não podem mudar.')
        serializer = ActivityInput(data={**old, **request.data}, context={'existing': True, 'old_equipment': activity.equipment})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        reason = data.pop('reason', '').strip()
        if not reason:
            raise ValidationError({'reason': 'Descreva o motivo da correção da atividade.'})
        LaborActivityRevision.objects.create(activity=activity, actor=request.user, reason=reason, snapshot=old)
        for key in ('worker', 'reference_date', 'origin', 'revision'):
            data.pop(key, None)
        for key, value in data.items():
            setattr(activity, key, value)
        activity.revision += 1
        activity.save()
        return Response(activity_values(activity))


class OccurrenceListView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        query = LaborRuleOccurrence.objects.order_by('-created_at')
        if request.query_params.get('bulletin'):
            value = serializers.UUIDField().run_validation(request.query_params['bulletin'])
            query = query.filter(bulletin_id=value)
        return paginated(query, request, lambda item: OccurrenceInput(item).data)

    @transaction.atomic
    def post(self, request):
        require_role(request.user, 'warehouse')
        serializer = OccurrenceInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        bulletin = DailyBulletin.objects.select_for_update().get(pk=data['bulletin'].pk)
        require_draft(bulletin)
        if data.get('worker') and not bulletin.participants.filter(worker=data['worker']).exists():
            raise ValidationError({'worker': 'A pessoa deve participar deste boletim.'})
        occurrence = serializer.save(created_by=request.user)
        bulletin.revision += 1
        bulletin.save(update_fields=['revision'])
        snapshot(bulletin, request.user, 'Ocorrência de regra pendente')
        return Response({**OccurrenceInput(occurrence).data, 'bulletin_revision': bulletin.revision}, status=201)


class OccurrenceResolveView(APIView):
    permission_classes = [IsInternal]

    @transaction.atomic
    def post(self, request, pk):
        require_role(request.user, 'management')
        issue = get_object_or_404(LaborRuleOccurrence, pk=pk)
        bulletin = DailyBulletin.objects.select_for_update().get(pk=issue.bulletin_id)
        issue.refresh_from_db()
        require_draft(bulletin)
        reason = serializers.CharField(max_length=5000).run_validation(request.data.get('reason'))
        if request.data.get('resolution_type') != 'NOT_APPLICABLE':
            raise ValidationError({'resolution_type': 'A regra excepcional permanece pendente. Somente NOT_APPLICABLE, com justificativa, confirma que não afeta o cálculo vigente.'})
        if issue.resolved_at:
            raise ValidationError('Ocorrência já resolvida.')
        issue.resolved_at, issue.resolved_by, issue.resolution = timezone.now(), request.user, reason
        issue.resolution_type = 'NOT_APPLICABLE'
        issue.policy_version = bulletin.financial_version
        issue.save(update_fields=['resolved_at', 'resolved_by', 'resolution', 'resolution_type', 'policy_version'])
        bulletin.revision += 1
        bulletin.save(update_fields=['revision'])
        snapshot(bulletin, request.user, 'Resolução documentada: ' + reason)
        return Response({**OccurrenceInput(issue).data, 'bulletin_revision': bulletin.revision})


class ProductionListView(APIView):
    permission_classes = [IsInternal]

    def get(self, request):
        query = ProductionRecord.objects.order_by('-created_at')
        if request.query_params.get('bulletin'):
            value = serializers.UUIDField().run_validation(request.query_params['bulletin'])
            query = query.filter(bulletin_id=value)
        return paginated(query, request, lambda item: ProductionInput(item).data)

    def post(self, request):
        require_role(request.user, 'warehouse')
        serializer = ProductionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            with transaction.atomic():
                bulletin = DailyBulletin.objects.select_for_update().get(pk=data['bulletin'].pk)
                check_revision(bulletin, data.pop('revision'))
                require_draft(bulletin)
                if bulletin.financial_version != 'boletim-v2':
                    raise ValidationError('Origem de produção exige boletim v2.')
                record = ProductionRecord.objects.create(**data, origin=bulletin.origin,
                    price=service_rates()[data['category']], created_by=request.user)
                bulletin.revision += 1
                bulletin.save(update_fields=['revision'])
                snapshot(bulletin, request.user, 'Produção com origem única registrada')
        except IntegrityError:
            raise ValidationError({'source_key': 'Esta origem de produção já foi contabilizada.'}) from None
        return Response({**ProductionInput(record).data, 'bulletin_revision': bulletin.revision}, status=201)


class ProductionDetailView(APIView):
    permission_classes = [IsInternal]

    @transaction.atomic
    def patch(self, request, pk):
        require_role(request.user, 'warehouse')
        record = get_object_or_404(ProductionRecord, pk=pk)
        bulletin = DailyBulletin.objects.select_for_update().get(pk=record.bulletin_id)
        check_revision(bulletin, request.data.get('revision'))
        require_draft(bulletin)
        record.refresh_from_db()
        if any(key in request.data for key in ('bulletin', 'source_key', 'origin', 'price')):
            raise ValidationError('Origem, boletim e tarifa permanecem registrados; corrija somente a quantidade com motivo.')
        reason = serializers.CharField(max_length=2000).run_validation(request.data.get('reason'))
        quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal(0)).run_validation(request.data.get('quantity'))
        snapshot(bulletin, request.user, 'Antes de corrigir produção: ' + reason)
        record.quantity = quantity
        record.save(update_fields=['quantity'])
        bulletin.revision += 1
        bulletin.save(update_fields=['revision'])
        snapshot(bulletin, request.user, 'Produção corrigida: ' + reason)
        return Response({**ProductionInput(record).data, 'bulletin_revision': bulletin.revision})


class StatementFilters(PeriodFilters):
    day_page = serializers.IntegerField(min_value=1, default=1)
    rh_page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=100)


def statement_page(records, page, size, parameter):
    """Slice presentation only; totals and quality are computed over the full period."""
    count = len(records)
    pages = max(1, (count + size - 1) // size)
    if page > pages:
        raise ValidationError({parameter: 'Página fora do intervalo. Recarregue o período.'})
    start = (page - 1) * size
    return records[start:start + size], {
        'count': count, 'page': page, 'pages': pages, 'page_size': size,
        'next_page': page + 1 if page < pages else None,
        'previous_page': page - 1 if page > 1 else None,
    }


class WorkerStatementView(APIView):
    permission_classes = [IsInternal]

    def get(self, request, pk):
        worker = get_object_or_404(Worker, pk=pk)
        serializer = StatementFilters(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        period = (data['date_from'], data['date_to'])
        participations = BulletinParticipant.objects.select_related('bulletin__warehouse').filter(
            worker=worker, bulletin__reference_date__range=period)
        activities = LaborActivity.objects.select_related('worker_day__worker', 'warehouse').filter(
            worker_day__worker=worker, worker_day__reference_date__range=period)
        if data.get('origin'):
            participations = participations.filter(bulletin__origin=data['origin'])
            activities = activities.filter(worker_day__origin=data['origin'])
        participations = list(participations.order_by('bulletin__reference_date', 'bulletin_id'))
        by_day = defaultdict(list)
        for participant in participations:
            by_day[(participant.bulletin.reference_date, participant.bulletin.origin)].append(participant)
        legacy_conflicts = {key: entries for key, entries in by_day.items()
                            if len(entries) > 1 and any(p.bulletin.financial_version != 'boletim-v2' for p in entries)}
        days, totals = [], {key: Decimal(0) for key in ('total_payable', 'production', 'supplement', 'rounding_adjustment')}
        allocated, legacy = 0, 0
        represented = set()
        for participant in participations:
            bulletin = participant.bulletin
            allocation = bulletin.allocations.filter(worker=worker, active=True).first() if bulletin.status == 'CLOSED' else None
            attached = [activity_values(a) for a in activities if a.worker_day.reference_date == bulletin.reference_date and a.worker_day.origin == bulletin.origin]
            represented.add((bulletin.reference_date, bulletin.origin))
            issues = list(bulletin.rule_occurrences.filter(resolved_at=None).values('code', 'description'))
            if (bulletin.reference_date, bulletin.origin) in legacy_conflicts:
                issues.append({'code': 'LEGACY_MULTIPLE_BULLETINS',
                               'description': 'O histórico contém mais de um boletim para esta pessoa/data/origem. Exige conferência; nenhum rateio retroativo foi inferido.'})
            if allocation:
                allocated += 1
                for key in totals:
                    totals[key] += Decimal(allocation.display.get(key, '0'))
            elif bulletin.status == 'CLOSED':
                legacy += 1
                issues.append({'code': 'LEGACY_UNALLOCATED', 'description': 'Fechado legado sem parcela individual registrada.'})
            days.append({'date': str(bulletin.reference_date), 'origin': bulletin.origin, 'bulletin': str(bulletin.pk),
                         'status': bulletin.status, 'warehouse': str(bulletin.warehouse_id), 'warehouse_name': bulletin.warehouse.name,
                         'fraction': str(participant.fraction),
                         'allocation': {'exact': allocation.exact, 'display': allocation.display,
                                        'policy_version': allocation.policy_version} if allocation else None,
                         'activities': attached, 'issues': issues})
        for activity in activities:
            key = (activity.worker_day.reference_date, activity.worker_day.origin)
            if key not in represented:
                represented.add(key)
                days.append({'date': str(key[0]), 'origin': key[1], 'bulletin': None, 'warehouse': None,
                             'allocation': None, 'activities': [activity_values(a) for a in activities
                             if (a.worker_day.reference_date, a.worker_day.origin) == key], 'issues': []})
        historical = None
        if user_role(request.user) in {'management', 'admin'}:
            history = HistoricalWorkerDay.objects.select_related('batch').filter(worker=worker, batch__active=True)
            dated = list(history.filter(day__range=period).order_by('day', 'source_sheet', 'source_row', 'source_column', 'batch_id', 'id'))
            valid = [row for row in dated if row.usable and row.payroll_paid is not None]
            historical_page, historical_pagination = statement_page(dated, data['rh_page'], data['page_size'], 'rh_page')
            historical = {'records': [{'day': str(row.day), 'location': row.location,
                            'payroll_paid': str(row.payroll_paid) if row.payroll_paid is not None else None,
                            'usable': row.usable, 'problems': row.problems,
                            'source': {'batch': str(row.batch_id), 'sheet': row.source_sheet,
                                       'row': row.source_row, 'column': row.source_column}} for row in historical_page],
                          'pagination': historical_pagination,
                          'totals': {'payroll_paid': str(sum((row.payroll_paid for row in valid), Decimal(0))) if valid else None},
                          'quality': {'active_batches_only': True, 'records_in_period': len(dated), 'usable_records': len(valid),
                                      'unusable_records': sum(not row.usable for row in dated),
                                      'undated_records_outside_period': history.filter(day=None).count()}}
        days_page, day_pagination = statement_page(
            sorted(days, key=lambda day: (day['date'], day['origin'], day['bulletin'] or '')),
            data['day_page'], data['page_size'], 'day_page')
        return Response({'worker': {'id': str(worker.pk), 'registration': worker.registration, 'name': worker.name, 'is_active': worker.is_active},
                         'period': {'date_from': str(period[0]), 'date_to': str(period[1])},
                         'operational': {'days': days_page, 'pagination': day_pagination,
                           'totals': {key: format(value, '.2f') if allocated else None for key, value in totals.items()},
                           'coverage': {'allocated_days': allocated, 'legacy_unallocated_days': legacy,
                                        'legacy_conflict': bool(legacy_conflicts),
                                        'legacy_conflict_days': len(legacy_conflicts),
                                        'legacy_conflict_bulletins': sum(len(entries) for entries in legacy_conflicts.values()),
                                        'partial': bool(legacy or legacy_conflicts), 'empty': not bool(days)}},
                         'historical_rh': historical})
