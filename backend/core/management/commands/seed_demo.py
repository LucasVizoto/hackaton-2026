"""Local, idempotent synthetic fixtures. Never reads the private historical package."""

import os
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework.test import APIClient

from catalog.models import Equipment, Supplier, Warehouse, Worker
from core.models import UserProfile
from labor.constants import RATE_TABLE
from labor.models import DailyBulletin, ServiceRate
from labor.services import close_bulletin, replace_contents
from receiving import services
from receiving.models import Appointment, Invoice, NonReceipt

DEMO = "demo_sintetico"


class Command(BaseCommand):
    help = "Cria contas e dados sintéticos separados, sem sobrescrever registros existentes."

    @transaction.atomic
    def handle(self, *args, **options):
        password = os.environ.get("DEMO_PASSWORD")
        if not password or len(password) < 12:
            raise CommandError(
                "Configure DEMO_PASSWORD com pelo menos 12 caracteres no .env privado."
            )
        warehouses = {}
        for code, name in (
            ("ADUBO", "Adubo"),
            ("INSUMOS", "Insumos"),
            ("LOJA", "Loja"),
            ("MAQUINAS", "Máquinas"),
        ):
            warehouses[code], _ = Warehouse.objects.get_or_create(
                code=code, defaults={"name": name}
            )
        suppliers = []
        for suffix in ("A", "B"):
            supplier, _ = Supplier.objects.get_or_create(
                code="DEMO-" + suffix,
                defaults={"name": "Fornecedor sintético " + suffix, "origin": DEMO},
            )
            if supplier.origin != DEMO:
                raise CommandError("Código reservado de demonstração já pertence a outra origem.")
            suppliers.append(supplier)
        users = {}
        for username, role, supplier in (
            ("fornecedor_demo", "supplier", suppliers[0]),
            ("fornecedor_b_demo", "supplier", suppliers[1]),
            ("compras_demo", "purchasing", None),
            ("armazem_demo", "warehouse", None),
            ("gestao_demo", "management", None),
        ):
            user, created = User.objects.get_or_create(username=username)
            if created:
                user.set_password(password)
                user.save(update_fields=["password"])
            profile, _ = UserProfile.objects.get_or_create(
                user=user, defaults={"role": role, "supplier": supplier}
            )
            if profile.role != role or profile.supplier_id != (supplier.pk if supplier else None):
                raise CommandError("Conta de demonstração já existente com perfil diferente.")
            users[role if supplier != suppliers[1] else "supplier_b"] = user
        workers = []
        for index in range(1, 33):
            worker, _ = Worker.objects.get_or_create(
                registration=f"D{index:03}",
                defaults={"name": f"Chapa demonstração {index:02}", "origin": DEMO},
            )
            if worker.origin != DEMO:
                raise CommandError(
                    "Matrícula reservada de demonstração já pertence a outra origem."
                )
            workers.append(worker)
        equipment = []
        for index, code in enumerate(("ADUBO", "INSUMOS", "MAQUINAS"), 1):
            item, _ = Equipment.objects.get_or_create(
                code=f"DEMO-E{index}",
                defaults={
                    "name": f"Empilhadeira sintética {index}",
                    "warehouse": warehouses[code],
                    "mobile": True,
                },
            )
            equipment.append(item)
        for code, label, price in RATE_TABLE:
            ServiceRate.objects.get_or_create(code=code, defaults={"label": label, "price": price})

        # One real numerical reference reproduced with fake participants, never a historical series.
        official = [
            {"category": "FERTILIZANTES", "unloading": Decimal(2378), "removal": Decimal(400)},
            {"category": "AGROQUIMICO", "unloading": Decimal(30)},
            {"category": "SERVICOS_DIVERSOS", "removal": Decimal(40)},
        ]
        self.bulletin(
            users["warehouse"], warehouses["ADUBO"], date(2025, 11, 17), official, workers[:11]
        )
        self.bulletin(
            users["warehouse"], warehouses["ADUBO"], date(2025, 11, 18), official, workers[:11],
            half_registration=workers[10].registration,
        )
        samples = (
            ("ADUBO", "FERTILIZANTES", [1200, 1800], workers[:5]),
            ("INSUMOS", "AGROQUIMICO", [800, 1400], workers[5:9]),
            ("LOJA", "PECAS", [400, 900], workers[9:12]),
            ("MAQUINAS", "MAQUINAS", [100, 200], workers[12:14]),
        )
        for code, category, quantities, team in samples:
            for offset, quantity in enumerate(quantities):
                self.bulletin(
                    users["warehouse"],
                    warehouses[code],
                    date(2026, 10, 1 + offset),
                    [{"category": category, "unloading": Decimal(quantity)}],
                    team,
                )

        invoice_a = self.invoice(users["supplier"], suppliers[0], "SYN-001")
        invoice_b = self.invoice(users["supplier_b"], suppliers[1], "SYN-002")
        self.receipt(
            users,
            suppliers[0],
            invoice_a,
            date(2026, 10, 1),
            "08:00",
            "paletizada",
            "DEMO-RECEB-01",
            [warehouses["ADUBO"]],
            equipment[:1],
            2,
        )
        self.receipt(
            users,
            suppliers[1],
            invoice_b,
            date(2026, 10, 2),
            "10:00",
            "big_bag",
            "DEMO-RECEB-02",
            [warehouses["INSUMOS"], warehouses["MAQUINAS"]],
            equipment[1:],
            2,
        )
        for marker, day, hour, packaging in (
            ("DEMO-PEND-01", date(2026, 10, 5), "08:00", "paletizada"),
            ("DEMO-CANCEL-01", date(2026, 10, 5), "13:00", "big_bag"),
            ("DEMO-CHUVA-01", date(2026, 10, 5), "15:00", "paletizada"),
        ):
            if Appointment.objects.filter(notes=marker, origin=DEMO).exists():
                continue
            ap = services.create_appointment(
                users["supplier"],
                supplier=suppliers[0],
                invoice=invoice_a,
                day=day,
                time=hour,
                packaging=packaging,
                notes=marker,
                vehicle_plate="SINTETICO",
            )
            if "CANCEL" in marker:
                services.cancel(
                    users["supplier"],
                    ap.pk,
                    {
                        "reason": "Cancelamento sintético; vaga depende de decisão nominal do armazém."
                    },
                )
            if "CHUVA" in marker:
                services.reschedule(
                    users["warehouse"],
                    ap.pk,
                    {
                        "date": date(2026, 10, 6),
                        "time": "15:00",
                        "nature_exception": True,
                        "reason": "Chuva simulada; sem evento real.",
                    },
                )
        if not NonReceipt.objects.filter(
            origin=DEMO, description="Ocorrência avulsa sintética; sem agendamento e sem vaga."
        ).exists():
            services.create_non_receipt(
                users["warehouse"],
                {
                    "supplier": suppliers[1],
                    "reason": "unscheduled_no_capacity",
                    "description": "Ocorrência avulsa sintética; sem agendamento e sem vaga.",
                    "vehicle_plate": "SINTETICO",
                    "occurred_at": self.at(date(2026, 10, 2), 15),
                    "origin": DEMO,
                },
            )
        self.stdout.write(
            self.style.SUCCESS(
                "Seed sintético concluído, idempotente e sem sobrescrever registros. Contas: fornecedor_demo, fornecedor_b_demo, compras_demo, armazem_demo, gestao_demo. Senha somente no .env privado."
            )
        )

    def bulletin(self, actor, warehouse, day, lines, workers, *, half_registration=None):
        bulletin, created = DailyBulletin.objects.get_or_create(
            warehouse=warehouse, reference_date=day, defaults={"origin": DEMO, "created_by": actor}
        )
        if not created:
            if bulletin.origin != DEMO:
                raise CommandError(
                    "Local/data reservados do seed já possuem boletim de outra origem; nenhum registro foi sobrescrito."
                )
            return
        replace_contents(
            bulletin,
            {
                "lines": lines,
                "participants": [{
                    "worker": worker,
                    "fraction": Decimal("0.5") if worker.registration == half_registration else Decimal(1),
                } for worker in workers],
            },
        )
        close_bulletin(bulletin.pk, actor, 1)

    def invoice(self, user, supplier, number):
        existing = Invoice.objects.filter(supplier=supplier, number=number, origin=DEMO).first()
        if existing:
            return existing
        content = f"""<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe><ide><nNF>{number}</nNF><dhEmi>2026-10-01T07:00:00-03:00</dhEmi></ide><emit><xNome>EMITENTE SINTETICO SEM VALIDADE FISCAL</xNome></emit><det nItem="1"><prod><cProd>SYN-PROD-001</cProd><xProd>Produto sintético para demonstração</xProd><uCom>UN</uCom><qCom>120</qCom><vUnCom>1.00</vUnCom></prod></det><transp><vol><qVol>10</qVol><esp>CONFIRMAR MANUALMENTE</esp><pesoB>600</pesoB></vol></transp></infNFe></NFe>""".encode(
            "utf-8"
        )
        client = APIClient()
        client.force_authenticate(user)
        response = client.post(
            "/api/v1/invoices/upload/",
            {"file": SimpleUploadedFile(number + ".xml", content, content_type="application/xml")},
            format="multipart",
            HTTP_HOST="localhost",
        )
        if response.status_code != 201:
            raise CommandError(
                "Falha ao criar nota sintética pela API; verifique as regras do upload."
            )
        return Invoice.objects.get(pk=response.data["id"])

    def at(self, day, hour, minute=0):
        return timezone.make_aware(
            datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=minute)
        )

    def receipt(
        self, users, supplier, invoice, day, hour, packaging, marker, warehouses, equipment, workers
    ):
        if Appointment.objects.filter(notes=marker, origin=DEMO).exists():
            return
        ap = services.create_appointment(
            users["supplier" if supplier.code == "DEMO-A" else "supplier_b"],
            supplier=supplier,
            invoice=invoice,
            day=day,
            time=hour,
            packaging=packaging,
            notes=marker,
            vehicle_plate="SINTETICO",
        )
        arrived = self.at(day, int(hour[:2]), 5)
        # Arrival may precede either approval.
        services.arrive(users["warehouse"], ap.pk, {"occurred_at": arrived})
        services.purchase_review(
            users["purchasing"],
            ap.pk,
            {
                "decision": "approved",
                "order_reference": "SYN-PEDIDO",
                "comparison_notes": "Comparação manual sintética: produtos e quantidades conferidos para demonstração.",
            },
        )
        services.warehouse_review(
            users["warehouse"], ap.pk, {"warehouse_ids": [warehouse.pk for warehouse in warehouses]}
        )
        start = arrived + timedelta(minutes=10)
        services.start(users["warehouse"], ap.pk, {"occurred_at": start})
        resource = {
            "worker_count": workers,
            "equipment_ids": [item.pk for item in equipment],
            "resources_confirmed": True,
        }
        if len(warehouses) > 1:
            for index, visit in enumerate(ap.visits.order_by("sequence")):
                services.visit_action(
                    users["warehouse"],
                    visit.pk,
                    {"occurred_at": start + timedelta(minutes=20 * index)},
                    "start",
                )
                services.visit_action(
                    users["warehouse"],
                    visit.pk,
                    {
                        **resource,
                        "equipment_ids": [equipment[index].pk],
                        "occurred_at": start + timedelta(minutes=20 * (index + 1)),
                    },
                    "finish",
                )
        services.finish(
            users["warehouse"],
            ap.pk,
            {**resource, "occurred_at": start + timedelta(minutes=20 * len(warehouses))},
        )
