from datetime import timedelta
from decimal import Decimal
from fractions import Fraction
import threading

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import SimpleTestCase, TestCase, TransactionTestCase
from rest_framework.test import APIClient

from core.models import UserProfile
from imports.models import ImportBatch, HistoricalWorkerDay
from labor.calculation import allocate_individuals, calculate_v2
from labor.models import DailyBulletin, WorkerDay, IndividualAllocation, LaborActivity
from labor.services import values, close_bulletin
from labor.tests import labor_fixtures, official_payload, stored_bulletin, REFERENCE


class AllocationTests(SimpleTestCase):
    def test_proportional_exact_rationals_and_reconciled_cents_stable_order(self):
        people = [{'worker': '0001', 'fraction': '1'}, {'worker': '0002', 'fraction': '0.5'},
                  {'worker': '0003', 'fraction': '1'}]
        calculation = calculate_v2([{'price': '0.3333', 'unloading': '1000'}], people)
        allocations = allocate_individuals(calculation, people)
        self.assertEqual(allocations, allocate_individuals(calculation, list(reversed(people))))
        exact = [Fraction(int(a['exact']['rationals']['total_payable']['numerator']),
                          int(a['exact']['rationals']['total_payable']['denominator'])) for a in allocations]
        self.assertEqual(exact[0], exact[1] * 2)
        self.assertEqual(sum(exact), Fraction(Decimal(calculation['total_payable'])))
        for field in ('production', 'supplement', 'total_payable'):
            self.assertEqual(sum(Decimal(a['display'][field]) for a in allocations), Decimal(calculation['display'][field]))
        for a in allocations:
            self.assertEqual(Decimal(a['display']['production']) + Decimal(a['display']['supplement']) +
                             Decimal(a['display']['rounding_adjustment']), Decimal(a['display']['total_payable']))

    def test_half_service_tariff_is_not_half_floor_and_tie_uses_worker_id(self):
        people = [{'worker': 'b', 'fraction': '1'}, {'worker': 'a', 'fraction': '1'}, {'worker': 'c', 'fraction': '1'}]
        result = calculate_v2([], people, floor=Decimal('0'), daily_services=[{'kind': 'HALF', 'quantity': '1', 'price': '45.0786'}])
        self.assertEqual(result['production'], '45.0786')
        amounts = allocate_individuals(result, people)
        self.assertEqual([a['display']['total_payable'] for a in amounts], ['15.03', '15.03', '15.02'])


class LaborV2Tests(TestCase):
    def setUp(self):
        labor_fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.operator)

    def create(self, warehouse=None, workers=None, **extra):
        payload = official_payload(warehouse or self.warehouse, self.workers if workers is None else workers)
        result = self.client.post('/api/v2/bulletins/', {**payload, **extra}, format='json')
        self.assertEqual(result.status_code, 201, result.data)
        return result.data

    def close(self, bulletin):
        result = self.client.post(f"/api/v2/bulletins/{bulletin['id']}/close/", {'revision': bulletin['revision']}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        return result.data

    def test_unique_person_day_even_two_halves_draft_and_different_cost_locations(self):
        people = [{'worker': str(self.workers[0].pk), 'fraction': '0.5'}]
        self.create(participants=people)
        result = self.client.post('/api/v2/bulletins/', {**official_payload(self.other_warehouse, self.workers), 'participants': people}, format='json')
        self.assertEqual(result.status_code, 400)
        self.assertEqual(DailyBulletin.objects.count(), 1)
        self.assertEqual(WorkerDay.objects.count(), 1)

    def test_close_snapshot_reopen_and_reclose_preserve_old_allocations(self):
        bulletin = self.close(self.create())
        first = list(IndividualAllocation.objects.values_list('display', flat=True))
        response = self.client.post(f"/api/v2/bulletins/{bulletin['id']}/reopen/", {'revision': bulletin['revision'], 'reason': 'Correção documentada'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(IndividualAllocation.objects.filter(active=True).exists())
        bulletin = self.close(response.data)
        self.assertEqual(IndividualAllocation.objects.count(), 22)
        self.assertEqual(list(IndividualAllocation.objects.filter(active=False).values_list('display', flat=True)), first)
        self.assertEqual(sum(Decimal(item['display']['total_payable']) for item in bulletin['individual_allocations']), Decimal('991.90'))

    def test_daily_service_v1_mutation_gate_and_exact_source_price(self):
        bulletin = self.create(daily_services=[{'kind': 'HALF', 'quantity': '2'}])
        self.assertEqual(bulletin['daily_services'][0]['price'], '45.0786')
        result = self.client.patch(f"/api/v1/bulletins/{bulletin['id']}/", {'revision': 1, 'lines': []}, format='json')
        self.assertEqual(result.status_code, 400)
        self.assertEqual(result.data['error']['details']['code'], 'API_V2_REQUIRED')
        self.close(bulletin)

    def test_transfer_reopens_both_closed_and_keeps_worker_day_and_history(self):
        first = self.close(self.create(workers=self.workers[:1]))
        second = self.close(self.create(self.other_warehouse, self.workers[1:2]))
        day = WorkerDay.objects.get(worker=self.workers[0])
        response = self.client.post(f"/api/v2/bulletins/{first['id']}/transfer-worker/", {
            'worker': str(self.workers[0].pk), 'target_bulletin': second['id'], 'revision': first['revision'],
            'target_revision': second['revision'], 'reason': 'Responsável financeiro corrigido'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['source']['status'], 'DRAFT')
        self.assertEqual(response.data['target']['status'], 'DRAFT')
        self.assertEqual(day.financial_participation.bulletin_id, DailyBulletin.objects.get(pk=second['id']).pk)
        self.assertFalse(IndividualAllocation.objects.filter(active=True).exists())
        self.assertGreaterEqual(DailyBulletin.objects.get(pk=first['id']).history.count(), 3)

    def test_multi_location_activity_does_not_duplicate_pay_and_presence_validation(self):
        bulletin = self.create(workers=self.workers[:1])
        for warehouse in (self.warehouse, self.other_warehouse):
            result = self.client.post('/api/v2/labor-activities/', {'worker': str(self.workers[0].pk),
                'warehouse': str(warehouse.pk), 'reference_date': str(REFERENCE), 'origin': 'demo_sintetico',
                'activity_type': 'INTERNAL', 'attendance_state': 'PRESENT', 'used': True}, format='json')
            self.assertEqual(result.status_code, 201, result.data)
        closed = self.close(bulletin)
        self.assertEqual(len(closed['individual_allocations']), 1)
        self.assertEqual(LaborActivity.objects.count(), 2)
        bad = self.client.patch(f"/api/v2/labor-activities/{result.data['id']}/", {'revision': 1, 'attendance_state': 'ABSENT', 'reason': 'Correção'}, format='json')
        self.assertEqual(bad.status_code, 400)
        response = self.client.get(f'/api/v2/workers/{self.workers[0].pk}/statement/', {'date_from': str(REFERENCE), 'date_to': str(REFERENCE), 'origin': 'demo_sintetico'})
        self.assertEqual(len(response.data['operational']['days'][0]['activities']), 2)

    def test_rule_pending_hides_allocations_blocks_only_affected_bulletin_and_requires_explicit_resolution(self):
        bulletin = self.create(workers=self.workers[:1])
        other = self.create(self.other_warehouse, self.workers[1:2])
        issue = self.client.post('/api/v2/labor-rule-occurrences/', {'bulletin': bulletin['id'], 'worker': str(self.workers[0].pk),
              'code': 'FRACTION', 'description': 'Jornada excepcional', 'proposed_fraction': '0.7500'}, format='json')
        self.assertEqual(issue.status_code, 201, issue.data)
        current = self.client.get(f"/api/v2/bulletins/{bulletin['id']}/").data
        self.assertEqual(current['individual_allocations'], [])
        self.assertEqual(current['allocation_status'], 'pending_rule')
        blocked = self.client.post(f"/api/v2/bulletins/{bulletin['id']}/close/", {'revision': current['revision']}, format='json')
        self.assertEqual(blocked.status_code, 400)
        self.close(other)
        self.client.force_authenticate(self.manager)
        path = f"/api/v2/labor-rule-occurrences/{issue.data['id']}/resolve/"
        self.assertEqual(self.client.post(path, {'reason': 'Aprovar 0,75'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(path, {'reason': 'Não houve exceção, cadastro inicial incorreto', 'resolution_type': 'NOT_APPLICABLE'}, format='json').status_code, 200)
        self.client.force_authenticate(self.operator)
        current = self.client.get(f"/api/v2/bulletins/{bulletin['id']}/").data
        self.close(current)

    def test_unique_production_source_cannot_be_counted_at_two_locations(self):
        first = self.create(workers=self.workers[:1], lines=[])
        second = self.create(self.other_warehouse, self.workers[1:2], lines=[])
        record = {'source_key': 'receiving:synthetic:1', 'category': 'FERTILIZANTES', 'movement': 'unloading', 'quantity': '10', 'revision': 1}
        created = self.client.post('/api/v2/production-records/', {**record, 'bulletin': first['id']}, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        duplicate = self.client.post('/api/v2/production-records/', {**record, 'bulletin': second['id']}, format='json')
        self.assertEqual(duplicate.status_code, 400, duplicate.data)
        correction = self.client.patch(f"/api/v2/production-records/{created.data['id']}/", {
            'revision': created.data['bulletin_revision'], 'quantity': '3', 'reason': 'Quantidade corrigida pela origem'}, format='json')
        self.assertEqual(correction.status_code, 200, correction.data)
        current = self.client.get(f"/api/v2/bulletins/{first['id']}/").data
        self.assertEqual(Decimal(current['calculation']['production']), Decimal('0.9672'))
        self.assertEqual(current['production_records'][0]['source_key'], record['source_key'])
        preview = self.client.post('/api/v2/bulletins/preview/', {
            **official_payload(self.warehouse, self.workers[:1]), 'lines': [], 'bulletin': first['id']}, format='json')
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['production'], current['calculation']['production'])

    def test_soft_inactivation_preserves_history_but_refuses_new_participation(self):
        bulletin = self.create(workers=self.workers[:1])
        result = self.client.delete(f'/api/v1/catalog/workers/{self.workers[0].pk}/')
        self.assertEqual(result.status_code, 204)
        self.close(bulletin)
        next_day = {**official_payload(self.warehouse, self.workers[:1]), 'reference_date': str(REFERENCE + timedelta(days=1))}
        self.assertEqual(self.client.post('/api/v2/bulletins/', next_day, format='json').status_code, 400)

    def test_legacy_closed_unchanged_and_rh_only_active_batches_separate_totals(self):
        legacy = stored_bulletin(self)
        close_bulletin(legacy.pk, self.operator, 1)
        previous = values(legacy)['calculation']
        # The object is refreshed to verify the persisted legacy snapshot, not a live recalculation.
        legacy.refresh_from_db()
        previous = legacy.calculation
        self.assertEqual(values(legacy)['calculation'], previous)
        for active, amount in ((False, '999'), (True, '123.456789')):
            batch = ImportBatch.objects.create(kind='worker', source_key=str(active), file_hash=str(active), importer_version='1', source_name='synthetic.xlsx', active=active)
            HistoricalWorkerDay.objects.create(batch=batch, source_sheet='test', source_row=1, source_column=1,
                source_identifier='synthetic', worker=self.workers[0], day=REFERENCE, usable=True, payroll_paid=amount)
        path = f'/api/v2/workers/{self.workers[0].pk}/statement/'
        params = {'date_from': str(REFERENCE), 'date_to': str(REFERENCE)}
        self.assertIsNone(self.client.get(path, params).data['historical_rh'])
        self.client.force_authenticate(self.manager)
        result = self.client.get(path, params)
        self.assertEqual(result.data['historical_rh']['totals']['payroll_paid'], '123.456789')
        self.assertEqual(result.data['operational']['coverage']['legacy_unallocated_days'], 1)
        self.assertIsNone(result.data['operational']['totals']['total_payable'])

    def test_gatehouse_and_supplier_cannot_read_people_or_financial_apis(self):
        gate = User.objects.create_user('synthetic-gatehouse')
        UserProfile.objects.create(user=gate, role='gatehouse')
        for user in (gate, self.external):
            self.client.force_authenticate(user)
            for path in ('/api/v2/bulletins/', '/api/v2/catalog/workers/', '/api/v2/labor-activities/', f'/api/v2/workers/{self.workers[0].pk}/statement/'):
                self.assertEqual(self.client.get(path).status_code, 403, path)

    def test_statement_pages_are_independent_and_totals_quality_cover_full_period(self):
        for offset in range(3):
            self.close(self.create(workers=self.workers[:1], lines=[], reference_date=str(REFERENCE + timedelta(days=offset))))
        batch = ImportBatch.objects.create(kind='worker', source_key='paging', file_hash='paging',
            importer_version='1', source_name='synthetic-paging.xlsx')
        for index, (offset, amount, usable) in enumerate([(0, '1.111111', True), (0, '2.222222', True),
                                                       (1, '9.999999', False), (2, '3.333333', True)], 1):
            HistoricalWorkerDay.objects.create(batch=batch, source_sheet='test', source_row=index, source_column=1,
                source_identifier='synthetic', worker=self.workers[0], day=REFERENCE + timedelta(days=offset),
                payroll_paid=amount, usable=usable)
        HistoricalWorkerDay.objects.create(batch=batch, source_sheet='test', source_row=5, source_column=1,
            source_identifier='synthetic', worker=self.workers[0], day=None, payroll_paid='99', usable=False)
        self.client.force_authenticate(self.manager)
        path = f'/api/v2/workers/{self.workers[0].pk}/statement/'
        query = {'date_from': str(REFERENCE), 'date_to': str(REFERENCE + timedelta(days=2)),
                 'origin': 'demo_sintetico', 'page_size': 2, 'day_page': 2, 'rh_page': 1}
        response = self.client.get(path, query)
        self.assertEqual(response.status_code, 200, response.data)
        result = response.data
        self.assertEqual(len(result['operational']['days']), 1)
        self.assertEqual(result['operational']['pagination'], {'count': 3, 'page': 2, 'pages': 2,
            'page_size': 2, 'next_page': None, 'previous_page': 1})
        self.assertEqual(result['operational']['totals']['total_payable'], '270.51')
        self.assertEqual(result['operational']['coverage']['allocated_days'], 3)
        self.assertEqual(len(result['historical_rh']['records']), 2)
        self.assertEqual(result['historical_rh']['totals']['payroll_paid'], '6.666666')
        self.assertEqual(result['historical_rh']['quality']['records_in_period'], 4)
        self.assertEqual(result['historical_rh']['quality']['usable_records'], 3)
        self.assertEqual(result['historical_rh']['quality']['unusable_records'], 1)
        self.assertEqual(result['historical_rh']['quality']['undated_records_outside_period'], 1)
        second = self.client.get(path, {**query, 'rh_page': 2}).data
        self.assertEqual(second['operational'], result['operational'])
        self.assertNotEqual(second['historical_rh']['records'], result['historical_rh']['records'])
        self.assertEqual(second['historical_rh']['totals'], result['historical_rh']['totals'])
        self.assertEqual(second['historical_rh']['quality'], result['historical_rh']['quality'])
        first_day_page = self.client.get(path, {**query, 'day_page': 1}).data
        combined = first_day_page['operational']['days'] + result['operational']['days']
        self.assertEqual(len({day['bulletin'] for day in combined}), 3)
        self.assertEqual(first_day_page['operational']['totals'], result['operational']['totals'])
        for invalid in ({'page_size': 101}, {'page_size': 0}, {'day_page': 0}, {'rh_page': 3}, {'day_page': 'bad'}):
            self.assertEqual(self.client.get(path, {**query, **invalid}).status_code, 400)

    def test_statement_default_limits_records_to_one_hundred(self):
        batch = ImportBatch.objects.create(kind='worker', source_key='many', file_hash='many',
            importer_version='1', source_name='synthetic-many.xlsx')
        HistoricalWorkerDay.objects.bulk_create([
            HistoricalWorkerDay(batch=batch, source_sheet='test', source_row=index, source_column=1,
                source_identifier='synthetic', worker=self.workers[0], day=REFERENCE, payroll_paid='1', usable=True)
            for index in range(1, 102)
        ])
        self.client.force_authenticate(self.manager)
        path = f'/api/v2/workers/{self.workers[0].pk}/statement/'
        query = {'date_from': str(REFERENCE), 'date_to': str(REFERENCE)}
        response = self.client.get(path, query).data
        self.assertEqual(len(response['historical_rh']['records']), 100)
        self.assertEqual(response['historical_rh']['pagination']['count'], 101)
        self.assertEqual(response['historical_rh']['pagination']['page_size'], 100)
        self.assertEqual(response['historical_rh']['pagination']['next_page'], 2)
        self.assertEqual(response['historical_rh']['totals']['payroll_paid'], '101.000000')
        last = self.client.get(path, {**query, 'rh_page': 2}).data
        self.assertEqual(len(last['historical_rh']['records']), 1)
        self.assertEqual(last['historical_rh']['totals'], response['historical_rh']['totals'])
        self.assertEqual(response['operational']['pagination']['count'], 0)
        self.assertIsNone(response['operational']['totals']['total_payable'])

    def test_statement_marks_legacy_duplicate_day_without_inventing_pay_or_rewriting_snapshots(self):
        people = [{'worker': str(self.workers[0].pk), 'fraction': '0.5'}]
        first = stored_bulletin(self, people=people, lines=[])
        second = stored_bulletin(self, people=people, lines=[], warehouse=self.other_warehouse)
        first = close_bulletin(first.pk, self.operator, 1)
        second = close_bulletin(second.pk, self.operator, 1)
        before = {str(b.pk): b.calculation for b in (first, second)}
        current = self.close(self.create(workers=self.workers[:1], lines=[], reference_date=str(REFERENCE + timedelta(days=1))))
        path = f'/api/v2/workers/{self.workers[0].pk}/statement/'
        query = {'date_from': str(REFERENCE), 'date_to': str(REFERENCE + timedelta(days=1)),
                 'origin': 'demo_sintetico', 'page_size': 1}
        first_page = self.client.get(path, query).data['operational']
        second_page = self.client.get(path, {**query, 'day_page': 2}).data['operational']
        new_page = self.client.get(path, {**query, 'day_page': 3}).data['operational']
        for page in (first_page, second_page):
            self.assertIn('LEGACY_MULTIPLE_BULLETINS', [issue['code'] for issue in page['days'][0]['issues']])
            self.assertIsNone(page['days'][0]['allocation'])
            self.assertEqual(page['coverage']['legacy_conflict_days'], 1)
            self.assertEqual(page['coverage']['legacy_conflict_bulletins'], 2)
            self.assertTrue(page['coverage']['legacy_conflict'])
            self.assertTrue(page['coverage']['partial'])
        self.assertEqual(new_page['days'][0]['bulletin'], current['id'])
        self.assertFalse(new_page['days'][0]['issues'])
        self.assertEqual(new_page['coverage'], first_page['coverage'])
        self.assertEqual(first_page['totals']['total_payable'], '90.17')
        self.assertEqual(new_page['totals'], first_page['totals'])
        for pk, calculation in before.items():
            legacy = DailyBulletin.objects.get(pk=pk)
            self.assertEqual(legacy.calculation, calculation)
            self.assertFalse(legacy.allocations.exists())


class PersonDayConcurrencyTests(TransactionTestCase):
    def setUp(self):
        labor_fixtures(self)

    def test_simultaneous_new_half_participations_only_one_commits(self):
        barrier, results, lock = threading.Barrier(2), [], threading.Lock()
        def create(warehouse):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=self.operator.pk))
            payload = official_payload(warehouse, self.workers[:1])
            payload['participants'][0]['fraction'] = '0.5'
            try:
                barrier.wait(timeout=10)
                result = client.post('/api/v2/bulletins/', payload, format='json').status_code
            except Exception as error:
                result = repr(error)
            finally:
                close_old_connections()
            with lock:
                results.append(result)
        threads = [threading.Thread(target=create, args=(warehouse,)) for warehouse in (self.warehouse, self.other_warehouse)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
            self.assertFalse(thread.is_alive())
        self.assertCountEqual(results, [201, 400])
        self.assertEqual(WorkerDay.objects.count(), 1)
