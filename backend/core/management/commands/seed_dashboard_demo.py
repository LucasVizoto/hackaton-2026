"""Semanas sintéticas para o Dashboard responder "sobra ou falta chapa?" na apresentação.

Equipe fixa de 14 chapas paga todo dia útil. Segunda e terça concentram caminhões de adubo batido:
o pico exigido passa da equipe, a espera cresce e há descarga após o expediente (falta). De quarta a
sexta a agenda é leve e o boletim fica abaixo do piso (sobra, paga como complemento).

Tudo usa a origem ``demo_sintetico``. Nada é apagado; datas que já têm boletim ou recebimentos deste
cenário são puladas, então o comando pode rodar de novo sem duplicar.
"""

import hashlib
import random
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from catalog.models import Supplier, Warehouse, Worker
from labor.constants import FLOOR, PRICES
from labor.models import DailyBulletin, RosterShift
from labor.services import DAILY, close_bulletin, replace_contents
from receiving.models import (
    Appointment, AppointmentInvoice, GlobalSlot, Holiday, Invoice, NonReceipt, WarehouseVisit,
)

DEMO = "demo_sintetico"
MARKER = "Demonstração dashboard — "
TEAM_SIZE = 14
START = date(2026, 8, 17)
END = date(2026, 9, 30)
HOLIDAYS = {date(2026, 9, 7): "Independência do Brasil"}

# (horário, acondicionamento, armazém). Batida exige 5 chapas; palete e big bag, 2; máquina, 1 + operador.
AGENDA = {
    0: [("08:00", "batida", "ADUBO"), ("08:00", "batida", "ADUBO"), ("08:00", "batida", "ADUBO"),
        ("10:00", "batida", "ADUBO"), ("10:00", "paletizada", "INSUMOS"), ("10:00", "big_bag", "ADUBO"),
        ("13:00", "batida", "ADUBO"), ("13:00", "batida", "ADUBO"), ("13:00", "paletizada", "INSUMOS"),
        ("15:00", "batida", "ADUBO"), ("15:00", "paletizada", "LOJA")],
    1: [("08:00", "batida", "ADUBO"), ("08:00", "batida", "ADUBO"), ("08:00", "paletizada", "INSUMOS"),
        ("10:00", "batida", "ADUBO"), ("10:00", "batida", "ADUBO"), ("10:00", "batida", "ADUBO"),
        ("13:00", "batida", "ADUBO"), ("13:00", "paletizada", "INSUMOS"),
        ("15:00", "batida", "ADUBO"), ("15:00", "big_bag", "ADUBO")],
    2: [("08:00", "batida", "ADUBO"), ("08:00", "paletizada", "INSUMOS"),
        ("13:00", "paletizada", "LOJA"), ("15:00", "big_bag", "ADUBO")],
    3: [("08:00", "paletizada", "INSUMOS"), ("08:00", "big_bag", "ADUBO"), ("10:00", "batida", "ADUBO")],
    4: [("08:00", "batida", "ADUBO"), ("13:00", "paletizada", "INSUMOS"), ("15:00", "machine_implement", "MAQUINAS")],
}
# Produção do boletim por diária, em múltiplos do piso: acima de 1,2 é pressão; abaixo de 1 gera complemento.
PRODUCTIVITY = {0: 1.60, 1: 1.50, 2: 0.82, 3: 0.70, 4: 0.74}
CATEGORY = {"ADUBO": "FERTILIZANTES", "INSUMOS": "AGROQUIMICO", "LOJA": "PECAS", "MAQUINAS": "MAQUINAS"}
# Volume declarado na NF-e e unidades pagas no boletim por caminhão.
LOAD = {
    "batida": {"weight": 28000, "units": 560, "unload": (45, 60)},
    "big_bag": {"weight": 20000, "units": 400, "unload": (30, 40)},
    "paletizada": {"weight": 12000, "units": 480, "unload": (18, 30)},
    "machine_implement": {"weight": 4500, "units": 20, "unload": (18, 25)},
}
SUPPLIERS = (("DEMO-A", "Fornecedor sintético A"), ("DEMO-B", "Fornecedor sintético B"),
             ("DEMO-C", "Fertilizantes sintéticos C"), ("DEMO-D", "Agroquímicos sintéticos D"))
NON_RECEIPTS = (
    (date(2026, 8, 24), 9, "unscheduled_no_capacity", "Caminhão sem agendamento; horários de segunda lotados."),
    (date(2026, 8, 31), 10, "unscheduled_no_capacity", "Sem vaga: fila de adubo batido desde as 8h."),
    (date(2026, 9, 1), 14, "invoice_mismatch", "Quantidade da nota acima do pedido."),
    (date(2026, 9, 14), 9, "unscheduled_no_capacity", "Chegou sem agendamento na segunda; sem equipe livre."),
    (date(2026, 9, 15), 11, "unscheduled_no_capacity", "Sem vaga no dia; reagendado para quinta."),
    (date(2026, 9, 17), 15, "nature", "Chuva forte impediu a descarga de sacaria."),
    (date(2026, 9, 22), 8, "invoice_mismatch", "Produto da nota diferente do pedido."),
    (date(2026, 9, 28), 10, "unscheduled_no_capacity", "Segunda lotada; motorista orientado a agendar."),
)


def at(day, hour, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, 0)) + timedelta(minutes=minute))


class Command(BaseCommand):
    help = "Acrescenta semanas sintéticas coerentes para o Dashboard (sobra ou falta de chapas)."

    @transaction.atomic
    def handle(self, *args, **options):
        self.rng = random.Random(2026)
        self.actor = (User.objects.filter(username="armazem_demo").first()
                      or User.objects.filter(is_superuser=True).order_by("pk").first())
        if self.actor is None:
            raise CommandError("Rode antes o seed_demo (cria armazem_demo) ou crie um superusuário.")
        self.warehouses = {w.code: w for w in Warehouse.objects.filter(code__in=CATEGORY)}
        if len(self.warehouses) != len(CATEGORY):
            raise CommandError("Faltam armazéns ADUBO, INSUMOS, LOJA ou MAQUINAS. Rode antes o seed_demo.")
        self.suppliers = []
        for code, name in SUPPLIERS:
            supplier, _ = Supplier.objects.get_or_create(code=code, defaults={"name": name, "origin": DEMO})
            if supplier.origin != DEMO:
                raise CommandError(f"Fornecedor {code} pertence a outra origem; nada foi alterado.")
            self.suppliers.append(supplier)
        self.team = []
        for index in range(1, TEAM_SIZE + 1):
            worker, _ = Worker.objects.get_or_create(
                registration=f"D{index:03}", defaults={"name": f"Chapa demonstração {index:02}", "origin": DEMO})
            if worker.origin != DEMO:
                raise CommandError(f"Matrícula D{index:03} pertence a outra origem; nada foi alterado.")
            self.team.append(worker)
        for day, description in HOLIDAYS.items():
            Holiday.objects.get_or_create(date=day, defaults={"description": description})

        created = {"dias": 0, "caminhoes": 0, "ocorrencias": 0}
        day = START
        while day <= END:
            if day.weekday() < 5 and not Holiday.objects.filter(date=day).exists():
                if self.seed_day(day, created):
                    created["dias"] += 1
            day += timedelta(days=1)
        for day, hour, reason, description in NON_RECEIPTS:
            text = MARKER + description
            if not NonReceipt.objects.filter(origin=DEMO, description=text).exists():
                NonReceipt.objects.create(
                    supplier=self.rng.choice(self.suppliers), reason=reason, description=text,
                    vehicle_plate="SINTETICO", occurred_at=at(day, hour, 20), created_by=self.actor, origin=DEMO)
                created["ocorrencias"] += 1
        self.stdout.write(self.style.SUCCESS(
            f"Dashboard sintético: {created['dias']} dias, {created['caminhoes']} caminhões e "
            f"{created['ocorrencias']} não recebimentos acrescentados ({START:%d/%m} a {END:%d/%m/%Y}). "
            "No Dashboard, escolha a origem Demonstração sintética."))

    def seed_day(self, day, created):
        if DailyBulletin.objects.filter(reference_date=day, origin=DEMO).exists():
            self.stdout.write(f"{day:%d/%m/%Y}: já há boletim sintético nesta data; dia preservado.")
            return False
        weekday = day.weekday()
        heavy = weekday <= 1
        agenda = list(AGENDA[weekday])
        # Variação semanal: um caminhão a menos em parte das semanas, sem perder o pico das 8h.
        if self.rng.random() < 0.35:
            agenda.pop(self.rng.randrange(1, len(agenda)) if len(agenda) > 1 else 0)
        units = {code: 0 for code in CATEGORY}
        if not Appointment.objects.filter(origin=DEMO, slot__date=day, notes__startswith=MARKER).exists():
            queue = {}
            for index, (slot, packaging, code) in enumerate(agenda):
                self.truck(day, index, slot, packaging, code, heavy, queue)
                created["caminhoes"] += 1
        for _, packaging, code in agenda:
            units[code] += LOAD[packaging]["units"]

        absent = self.team[self.rng.randrange(TEAM_SIZE)] if self.rng.random() < 0.2 else None
        for worker in self.team:
            RosterShift.objects.get_or_create(
                worker=worker, date=day, origin=DEMO,
                defaults={"attendance": "ABSENT" if worker == absent else "PRESENT", "period": "FULL",
                          "activity": "OPERATION", "created_by": self.actor, "updated_by": self.actor,
                          "notes": MARKER + "escala fixa"})
        present = [worker for worker in self.team if worker != absent]

        lines = []
        unloading_value = Decimal(0)
        for code, quantity in units.items():
            if quantity:
                unloading_value += Decimal(quantity) * PRICES[CATEGORY[code]]
                lines.append({"warehouse": self.warehouses[code], "category": CATEGORY[code],
                              "unloading": Decimal(quantity)})
        factor = Decimal(str(PRODUCTIVITY[weekday] + self.rng.uniform(-0.06, 0.06)))
        target = factor * FLOOR * len(present)
        # O que a agenda não explica é carregamento ao cooperado (remoção), sempre no Adubo e na Loja.
        gap = max(Decimal(0), target - unloading_value)
        loja_value = min(gap, Decimal(self.rng.randint(60, 110)))
        adubo_units = ((gap - loja_value) / PRICES["FERTILIZANTES"]).quantize(Decimal(1), ROUND_HALF_UP)
        loja_units = (loja_value / PRICES["PECAS"]).quantize(Decimal(1), ROUND_HALF_UP)
        lines.append({"warehouse": self.warehouses["ADUBO"], "category": "FERTILIZANTES", "removal": adubo_units})
        lines.append({"warehouse": self.warehouses["LOJA"], "category": "PECAS", "removal": loja_units})
        merged = {}
        for line in lines:
            key = (line["warehouse"].pk, line["category"])
            entry = merged.setdefault(key, {"warehouse": line["warehouse"], "category": line["category"],
                                            "unloading": Decimal(0), "removal": Decimal(0)})
            entry["unloading"] += line.get("unloading", Decimal(0))
            entry["removal"] += line.get("removal", Decimal(0))

        bulletin = DailyBulletin.objects.create(
            warehouse=None, reference_date=day, origin=DEMO, created_by=self.actor, financial_version=DAILY)
        replace_contents(bulletin, {"lines": list(merged.values()),
                                    "participants": [{"worker": w, "fraction": Decimal(1)} for w in present]})
        close_bulletin(bulletin.pk, self.actor, bulletin.revision)
        return True

    def truck(self, day, index, slot, packaging, code, heavy, queue):
        spec = LOAD[packaging]
        supplier = self.suppliers[2] if code == "ADUBO" else self.suppliers[3] if code == "INSUMOS" else \
            self.suppliers[index % 2]
        number = f"9{day:%m%d}{index:02}"
        content = (f'<?xml version="1.0" encoding="UTF-8"?><NFe><infNFe><ide><nNF>{number}</nNF></ide>'
                   f'<emit><xNome>EMITENTE SINTETICO SEM VALIDADE FISCAL</xNome></emit></infNFe></NFe>').encode()
        invoice = Invoice(
            supplier=supplier, original_name=f"{number}.xml", media_type="application/xml",
            sha256=hashlib.sha256(content).hexdigest(), number=number, extraction_status="manual",
            extracted={"volumes": [{"quantity": str(spec["units"]), "gross_weight": str(spec["weight"])}]},
            created_by=self.actor, origin=DEMO)
        invoice.file.save(f"{number}.xml", ContentFile(content), save=False)
        invoice.save()

        hour, minute = (int(part) for part in slot.split(":"))
        arrived = at(day, hour, self.rng.randint(-15, 20))
        # Segunda e terça: chapas presos nas batidas anteriores, a fila cresce ao longo do horário.
        position = queue.get((slot, code), 0)
        queue[(slot, code)] = position + 1
        if heavy and code == "ADUBO":
            wait = self.rng.randint(45, 75) + 25 * position
        elif heavy:
            wait = self.rng.randint(25, 50)
        else:
            wait = self.rng.randint(8, 25)
        started = arrived + timedelta(minutes=wait)
        low, high = spec["unload"]
        unload = self.rng.randint(low, high) + (12 if heavy and packaging == "batida" else 0)
        finished = started + timedelta(minutes=unload)
        crew = {"batida": 5, "big_bag": 2, "paletizada": 2, "machine_implement": 1}[packaging]

        appointment = Appointment.objects.create(
            workflow_version=2, supplier=supplier, invoice=invoice,
            slot=GlobalSlot.objects.get_or_create(date=day, time=slot)[0], packaging=packaging,
            vehicle_plate=f"SIN{self.rng.randint(1000, 9999)}", driver_name=f"Motorista sintético {index + 1:02}",
            booking_kind="scheduled", gate_checked_in_at=arrived,
            gate_checked_out_at=finished + timedelta(minutes=self.rng.randint(8, 15)),
            notes=MARKER + f"{packaging} para {self.warehouses[code].name}", origin=DEMO,
            purchase_status="approved", purchase_reviewed_by=self.actor, purchase_reviewed_at=arrived - timedelta(days=2),
            warehouse_status="approved", warehouse_reviewed_by=self.actor,
            warehouse_reviewed_at=arrived - timedelta(days=1), operation_status="completed",
            arrived_at=arrived, started_at=started, finished_at=finished, worker_count=crew,
            resources_confirmed=True, created_by=self.actor)
        AppointmentInvoice.objects.create(appointment=appointment, invoice=invoice, position=1)
        WarehouseVisit.objects.create(
            appointment=appointment, warehouse=self.warehouses[code], sequence=1,
            checked_in_at=started, checked_out_at=finished, started_at=started, finished_at=finished,
            worker_count=crew, resources_confirmed=True)
