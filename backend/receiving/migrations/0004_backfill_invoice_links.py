from django.db import migrations


def backfill(apps, schema_editor):
    Appointment = apps.get_model("receiving", "Appointment")
    Link = apps.get_model("receiving", "AppointmentInvoice")
    alias = schema_editor.connection.alias
    pending = []
    for pk, invoice in Appointment.objects.using(alias).values_list("pk", "invoice_id").iterator(chunk_size=1000):
        pending.append(Link(appointment_id=pk, invoice_id=invoice, position=1))
        if len(pending) >= 1000:
            Link.objects.using(alias).bulk_create(pending, ignore_conflicts=True)
            pending.clear()
    if pending:
        Link.objects.using(alias).bulk_create(pending, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [("receiving", "0003_receiving_v2")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
