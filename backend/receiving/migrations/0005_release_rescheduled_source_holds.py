from django.db import migrations

# Earlier versions held the source slot when an appointment moved (reschedule or
# administrative assignment). Those holds blocked slots that appear free on the calendar.
MOVE_REASONS = ("Vaga de origem de reagendamento", "Vaga de origem da atribuição administrativa")


def release(apps, schema_editor):
    CapacityHold = apps.get_model("receiving", "CapacityHold")
    for prefix in MOVE_REASONS:
        CapacityHold.objects.filter(
            active=True, assigned_to__isnull=True, reason__startswith=prefix
        ).update(active=False)


class Migration(migrations.Migration):
    dependencies = [("receiving", "0004_packaging_maquina_implemento")]

    operations = [migrations.RunPython(release, migrations.RunPython.noop)]
