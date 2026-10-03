from django.db import migrations, models


def normalize_machine(apps, schema_editor):
    Appointment = apps.get_model("receiving", "Appointment")
    CapacityHold = apps.get_model("receiving", "CapacityHold")
    database = schema_editor.connection.alias
    Appointment.objects.using(database).filter(packaging="maquina_implemento").update(packaging="machine_implement")
    CapacityHold.objects.using(database).filter(
        active=True, source_appointment__packaging="machine_implement",
    ).update(units=1, exclusive=False)


class Migration(migrations.Migration):
    dependencies = [("receiving", "0008_merge_richardy_receiving")]
    operations = [
        migrations.RunPython(normalize_machine, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="appointment", name="packaging",
            field=models.CharField(max_length=20, choices=[
                ("batida", "Batida"), ("paletizada", "Paletizada"),
                ("big_bag", "Big bag"), ("machine_implement", "Máquina / implemento"),
            ]),
        ),
    ]
