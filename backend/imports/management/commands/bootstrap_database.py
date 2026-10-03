from zipfile import BadZipFile

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from imports.management.commands.seed_hackathon import (
    add_seed_arguments, publish_report, validate_existing_if_ready, validate_report_path,
)
from imports.seed import BOOTSTRAP_LOCK, apply_seed
from imports.seed_readers import prepare_seed
from imports.services import PrivateDataError


class Command(BaseCommand):
    help = "Valida as fontes, executa migrations e instala o baseline antes de iniciar a aplicação."

    def add_arguments(self, parser):
        add_seed_arguments(parser)

    def handle(self, *args, **options):
        try:
            self.stdout.write("Validando todas as fontes privadas antes das migrations...")
            data = prepare_seed(options["path"] or settings.PRIVATE_DATA_DIR)
            validate_report_path(options["report"], data["directory"])
            if options["dry_run"]:
                report = {**data["report"], "status": "dry_run",
                          "database_conflicts_checked": validate_existing_if_ready(data)}
            else:
                # A session lock also serializes the schema migration phase of concurrent deploys.
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_lock(%s)", [BOOTSTRAP_LOCK])
                try:
                    call_command("migrate", interactive=False, stdout=self.stdout)
                    self.stdout.write("Aplicando o seed completo em uma única transação...")
                    report = apply_seed(data)
                finally:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT pg_advisory_unlock(%s)", [BOOTSTRAP_LOCK])
            publish_report(self, report, options["report"], data)
        except (PrivateDataError, OSError, ValueError, KeyError, StopIteration, BadZipFile) as error:
            raise CommandError(str(error)) from None
