from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_portaria_gate"),
        ("core", "0002_receiving_v2"),
    ]

    operations = [
        migrations.AlterField(
            model_name="userprofile",
            name="role",
            field=models.CharField(
                max_length=20,
                choices=[
                    ("supplier", "Fornecedor"), ("purchasing", "Compras"),
                    ("warehouse", "Armazém"), ("gatehouse", "Portaria"),
                    ("management", "Gestão"), ("portaria", "Portaria"),
                    ("admin", "Administrador"),
                ],
            ),
        ),
    ]
