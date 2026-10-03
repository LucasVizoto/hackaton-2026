import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from imports.services import SOURCE_FILES, PrivateDataError, import_directory


class Command(BaseCommand):
    help = "Lê fontes privadas; importa versões por hash sem duplicar análises ou divulgar linhas."

    def add_arguments(self, parser):
        parser.add_argument("--path", help="Pasta privada; padrão PRIVATE_DATA_DIR.")
        parser.add_argument("--dry-run", action="store_true", help="Valida as fontes sem gravar no banco.")
        parser.add_argument("--kind", choices=list(SOURCE_FILES), action="append", help="Importa somente o conjunto escolhido; pode repetir.")

    def handle(self, *args, **options):
        try:
            results = import_directory(options["path"] or settings.PRIVATE_DATA_DIR, dry_run=options["dry_run"], kinds=options["kind"])
        except PrivateDataError as error:
            raise CommandError(str(error)) from None
        self.stdout.write(json.dumps(results, ensure_ascii=False, indent=2))
