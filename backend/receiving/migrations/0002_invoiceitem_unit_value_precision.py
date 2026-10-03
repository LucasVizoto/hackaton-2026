from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("receiving", "0001_initial")]

    operations = [
        migrations.AlterField(
            model_name="invoiceitem",
            name="unit_value",
            field=models.DecimalField(decimal_places=10, max_digits=26, null=True),
        ),
    ]
