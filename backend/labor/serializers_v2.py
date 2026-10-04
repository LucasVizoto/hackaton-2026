from decimal import Decimal

from rest_framework import serializers

from catalog.models import Worker, Warehouse, Equipment
from core.models import ORIGIN_CHOICES
from labor.models import DailyBulletin, BulletinDailyService, LaborActivity, LaborRuleOccurrence, ProductionRecord
from labor.serializers import BulletinInput
from receiving.models import Appointment


class DailyServiceInput(serializers.Serializer):
    kind = serializers.ChoiceField(choices=BulletinDailyService.KINDS)
    quantity = serializers.DecimalField(max_digits=18, decimal_places=4, min_value=Decimal(0))


class BulletinInputV2(BulletinInput):
    daily_services = DailyServiceInput(many=True, required=False)

    def validate(self, data):
        origins = {item['worker'].origin for item in data.get('participants', [])}
        if 'demo_sintetico' in origins and len(origins) > 1:
            raise serializers.ValidationError({'participants': 'Equipe de demonstração não pode misturar pessoas reais.'})
        if 'origin' not in self.initial_data and data.get('participants'):
            if origins == {'demo_sintetico'}:
                data['origin'] = 'demo_sintetico'
        data = super().validate(data)
        if not data.get('warehouse') and any(not line.get('warehouse') for line in data.get('lines', [])):
            raise serializers.ValidationError({'lines': 'No boletim do dia, informe o armazém de cada linha de produção.'})
        kinds = [item['kind'] for item in data.get('daily_services', [])]
        if len(kinds) != len(set(kinds)):
            raise serializers.ValidationError({'daily_services': 'Cada tipo aparece uma única vez.'})
        return data


class BulletinPreviewInputV2(BulletinInputV2):
    bulletin = serializers.PrimaryKeyRelatedField(queryset=DailyBulletin.objects.all(), required=False)


class ActivityInput(serializers.Serializer):
    worker = serializers.PrimaryKeyRelatedField(queryset=Worker.objects.all())
    reference_date = serializers.DateField()
    origin = serializers.ChoiceField(choices=ORIGIN_CHOICES, default='operacional_registrado')
    warehouse = serializers.PrimaryKeyRelatedField(queryset=Warehouse.objects.all())
    appointment = serializers.PrimaryKeyRelatedField(queryset=Appointment.objects.all(), allow_null=True, required=False)
    equipment = serializers.PrimaryKeyRelatedField(queryset=Equipment.objects.all(), allow_null=True, required=False)
    activity_type = serializers.ChoiceField(choices=LaborActivity._meta.get_field('activity_type').choices)
    attendance_state = serializers.ChoiceField(choices=LaborActivity._meta.get_field('attendance_state').choices, default='PLANNED')
    used = serializers.BooleanField(default=False)
    started_at = serializers.DateTimeField(allow_null=True, required=False)
    finished_at = serializers.DateTimeField(allow_null=True, required=False)
    notes = serializers.CharField(allow_blank=True, required=False, max_length=5000)
    revision = serializers.IntegerField(required=False, min_value=1)
    reason = serializers.CharField(required=False, max_length=2000)

    def validate(self, data):
        if data.get('origin') == 'historico_importado':
            raise serializers.ValidationError({'origin': 'Histórico exige importação rastreável.'})
        worker = data.get('worker')
        if worker and not worker.is_active and not self.context.get('existing'):
            raise serializers.ValidationError({'worker': 'Pessoa inativa não pode receber nova atividade.'})
        if worker and worker.origin == 'demo_sintetico' and data.get('origin') != 'demo_sintetico':
            raise serializers.ValidationError({'origin': 'Pessoa de demonstração exige origem demo_sintetico.'})
        if worker and worker.origin != 'demo_sintetico' and data.get('origin') == 'demo_sintetico':
            raise serializers.ValidationError({'origin': 'Atividade de demonstração exige pessoa sintética.'})
        equipment = data.get('equipment')
        if equipment and not equipment.is_active and equipment != self.context.get('old_equipment'):
            raise serializers.ValidationError({'equipment': 'Equipamento inativo não pode receber nova atividade.'})
        if equipment and not equipment.mobile and equipment.warehouse_id and equipment.warehouse != data.get('warehouse'):
            raise serializers.ValidationError({'equipment': 'Equipamento fixo pertence a outro local.'})
        if data.get('used') and data.get('attendance_state') != 'PRESENT':
            raise serializers.ValidationError({'used': 'Uso efetivo exige presença confirmada.'})
        if data.get('finished_at') and not data.get('started_at'):
            raise serializers.ValidationError({'finished_at': 'Informe o início da atividade.'})
        if data.get('finished_at') and data['finished_at'] < data['started_at']:
            raise serializers.ValidationError({'finished_at': 'O fim deve ser posterior ao início.'})
        appointment = data.get('appointment')
        if appointment:
            if appointment.origin != data.get('origin'):
                raise serializers.ValidationError({'appointment': 'As origens devem coincidir.'})
            if appointment.slot.date != data.get('reference_date'):
                raise serializers.ValidationError({'appointment': 'A atividade deve ocorrer na data do recebimento.'})
            if not appointment.visits.filter(warehouse=data.get('warehouse')).exists():
                raise serializers.ValidationError({'warehouse': 'O local não pertence ao recebimento.'})
        return data


class OccurrenceInput(serializers.ModelSerializer):
    class Meta:
        model = LaborRuleOccurrence
        fields = ['id', 'bulletin', 'worker', 'code', 'description', 'proposed_fraction', 'started_at', 'finished_at',
                  'activity', 'created_at', 'resolved_at', 'resolution', 'policy_version', 'resolution_type']
        read_only_fields = ['id', 'created_at', 'resolved_at', 'resolution', 'policy_version', 'resolution_type']

    def validate(self, data):
        if data.get('proposed_fraction') is not None and data['proposed_fraction'] <= 0:
            raise serializers.ValidationError({'proposed_fraction': 'A fração proposta deve ser positiva.'})
        if data.get('finished_at') and (not data.get('started_at') or data['finished_at'] < data['started_at']):
            raise serializers.ValidationError({'finished_at': 'Informe início anterior ao fim.'})
        activity = data.get('activity')
        if activity and (activity.worker_day.reference_date != data['bulletin'].reference_date
                         or activity.worker_day.origin != data['bulletin'].origin
                         or data.get('worker') and activity.worker_day.worker_id != data['worker'].pk):
            raise serializers.ValidationError({'activity': 'Atividade deve coincidir com pessoa, data e origem.'})
        return data


class ProductionInput(serializers.ModelSerializer):
    revision = serializers.IntegerField(write_only=True, min_value=1)

    class Meta:
        model = ProductionRecord
        fields = ['id', 'bulletin', 'warehouse', 'source_key', 'category', 'movement', 'quantity', 'price', 'origin',
                  'revision']
        read_only_fields = ['id', 'price', 'origin']
        extra_kwargs = {'quantity': {'min_value': Decimal(0)}}
