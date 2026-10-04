import io
import os
import tempfile
from unittest.mock import patch
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from receiving.models import Appointment, GateArrival
from imports.models import SeedRun
from labor.models import DailyBulletin, IndividualAllocation

class PresentationSeedTests(TestCase):
    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings = override_settings(MEDIA_ROOT=media.name, PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'], OPTIONAL_INTEGRATIONS_ENABLED=False)
        settings.enable()
        self.addCleanup(settings.disable)
        env = patch.dict(os.environ, {'DEMO_PASSWORD': 'synthetic-presentation-tests-only'})
        env.start()
        self.addCleanup(env.stop)

    def seed(self):
        call_command('seed_demo', presentation=True, stdout=io.StringIO())

    def test_presentation_is_idempotent_uses_real_v2_workflow_and_keeps_synthetic_origin(self):
        self.seed()
        before = (Appointment.objects.count(), GateArrival.objects.count(), DailyBulletin.objects.count(), IndividualAllocation.objects.count())
        self.seed()
        self.assertEqual(before, (Appointment.objects.count(), GateArrival.objects.count(), DailyBulletin.objects.count(), IndividualAllocation.objects.count()))
        self.assertEqual(Appointment.objects.count(), 3)
        self.assertFalse(Appointment.objects.exclude(origin='demo_sintetico', workflow_version=2).exists())
        self.assertFalse(DailyBulletin.objects.exclude(origin='demo_sintetico', financial_version='boletim-v2').exists())
        for ap in Appointment.objects.filter(operation_status='completed'):
            self.assertIsNotNone(ap.gate_checked_in_at)
            self.assertIsNotNone(ap.gate_checked_out_at)
            self.assertTrue(ap.receipt_lines.exists())
        self.assertEqual(GateArrival.objects.get().decision, 'rejected')
        self.assertGreater(IndividualAllocation.objects.count(), 0)
        pending = Appointment.objects.exclude(operation_status='completed').get()
        self.assertFalse(pending.invoice.items.filter(receiptline__isnull=False).exists())

    def test_presentation_refuses_mixed_qa_data_without_removing_or_relabeling_it(self):
        self.seed()
        ap = Appointment.objects.first()
        ap.notes = 'Synthetic migration fixture'
        ap.save(update_fields=['notes'])
        with self.assertRaises(CommandError):
            self.seed()
        ap.refresh_from_db()
        self.assertEqual(ap.notes, 'Synthetic migration fixture')
        self.assertEqual(Appointment.objects.count(), 3)

    def test_presentation_refuses_imported_baseline(self):
        SeedRun.objects.create(version='qa-only', manifest_hash='a' * 64, manifest={})
        with self.assertRaises(CommandError):
            self.seed()
        self.assertEqual(Appointment.objects.count(), 0)
        self.assertEqual(SeedRun.objects.count(), 1)
