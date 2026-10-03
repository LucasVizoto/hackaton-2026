from datetime import date

from django.core.management.base import BaseCommand, CommandError

from receiving.models import Holiday


class Command(BaseCommand):
    help = "Adiciona/atualiza um feriado do calendário local, sem inventar uma lista nacional."

    def add_arguments(self, parser):
        parser.add_argument("--date", required=True, dest="holiday_date", help="AAAA-MM-DD")
        parser.add_argument("--description", required=True)

    def handle(self, *args, **options):
        try:
            day = date.fromisoformat(options["holiday_date"])
        except ValueError:
            raise CommandError("Informe --date no formato AAAA-MM-DD.") from None
        description = options["description"].strip()
        if not description or len(description) > 200:
            raise CommandError("Descrição obrigatória, até 200 caracteres.")
        holiday, created = Holiday.objects.update_or_create(
            date=day, defaults={"description": description}
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Feriado {holiday.date} {'adicionado' if created else 'atualizado'} no calendário local."
            )
        )
