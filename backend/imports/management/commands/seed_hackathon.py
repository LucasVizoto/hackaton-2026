import json
from pathlib import Path
from zipfile import BadZipFile

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from imports.models import SeedRun
from imports.seed import apply_seed, check_existing
from imports.seed_readers import SEED_VERSION, prepare_seed
from imports.services import PrivateDataError


def add_seed_arguments(parser):
    parser.add_argument("--path", help="Pasta privada; padrão PRIVATE_DATA_DIR.")
    parser.add_argument("--dry-run", action="store_true", help="Valida sem migrations, dados ou cópias de anexos.")
    parser.add_argument("--report", help="Caminho privado para o relatório JSON.")


def validate_report_path(destination, directory):
    if destination and Path(destination).expanduser().resolve().is_relative_to(directory):
        raise PrivateDataError("O relatório deve ficar fora da pasta de fontes, para preservar os originais e o manifesto.")


def publish_report(command, report, destination, data):
    if destination:
        path = Path(destination).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        detailed = {**report, "manifest_hash": data["manifest_hash"], "manifest": data["manifest"],
                    "file_problems": data["file_problems"]}
        path.write_text(json.dumps(detailed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    command.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))


def validate_existing_if_ready(data):
    tables = set(connection.introspection.table_names())
    if SeedRun._meta.db_table in tables:
        previous = SeedRun.objects.filter(version=SEED_VERSION).first()
        if previous:
            if previous.manifest_hash != data["manifest_hash"]:
                raise PrivateDataError("Este banco já recebeu outro baseline; nenhuma fonte foi substituída.")
            return True
        check_existing(data)
        return True
    return False


class Command(BaseCommand):
    help = "Aplica o baseline privado completo, atomicamente e sem sobrescrever dados existentes."

    def add_arguments(self, parser):
        add_seed_arguments(parser)

    def handle(self, *args, **options):
        try:
            self.stdout.write("Validando todas as fontes privadas...")
            data = prepare_seed(options["path"] or settings.PRIVATE_DATA_DIR)
            validate_report_path(options["report"], data["directory"])
            if options["dry_run"]:
                checked = validate_existing_if_ready(data)
                report = {**data["report"], "status": "dry_run", "database_conflicts_checked": checked}
            else:
                if SeedRun._meta.db_table not in connection.introspection.table_names():
                    raise PrivateDataError("Schema não preparado; execute bootstrap_database ou migrate antes do seed.")
                report = apply_seed(data)
            publish_report(self, report, options["report"], data)
        except (PrivateDataError, OSError, ValueError, KeyError, StopIteration, BadZipFile) as error:
            raise CommandError(str(error)) from None
