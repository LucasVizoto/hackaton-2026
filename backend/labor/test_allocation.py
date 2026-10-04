from datetime import date
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from catalog.models import Equipment, Supplier, Warehouse
from core.models import UserProfile
from labor.allocation import assign_forklifts, plan_slot, requirement, season_target
from receiving.models import Appointment, GlobalSlot, Invoice, WarehouseVisit

INVENTORY = {"INSUMOS": {"quantity": 1, "mobile": False}, "ADUBO": {"quantity": 2, "mobile": True},
             "MAQUINAS": {"quantity": 1, "mobile": False}}


class NormTests(SimpleTestCase):
    def test_people_and_equipment_depend_only_on_packaging(self):
        self.assertEqual((requirement("batida", 10000).chapas, requirement("batida", 10000).gas_forklifts), (5, 0))
        self.assertEqual((requirement("paletizada").chapas, requirement("paletizada").gas_forklifts), (2, 1))
        self.assertEqual((requirement("big_bag").chapas, requirement("big_bag").gas_forklifts), (2, 1))
        machine = requirement("machine_implement")
        self.assertEqual((machine.chapas, machine.operators), (1, 1))

    def test_light_load_needs_nobody(self):
        light = requirement("batida", Decimal("499"))
        self.assertTrue(light.light_load)
        self.assertEqual((light.chapas, light.cycle_minutes), (0, 0))

    def test_unload_vs_full_cycle_times_from_prd(self):
        pallets = requirement("paletizada", Decimal("8000"), units=10)
        self.assertEqual((pallets.unload_minutes, pallets.cycle_minutes), (Decimal(15), Decimal(50)))
        bags = requirement("big_bag", Decimal("20000"), units=20)
        self.assertEqual((bags.unload_minutes, bags.cycle_minutes), (Decimal(30), Decimal(100)))
        self.assertEqual(requirement("batida", Decimal("10000")).unload_minutes, Decimal(40))
        self.assertEqual(requirement("batida", Decimal("28000")).unload_minutes, Decimal(50))

    def test_missing_units_uses_norm_and_flags_estimate(self):
        result = requirement("paletizada", Decimal("8000"))
        self.assertTrue(result.estimated)
        self.assertEqual(result.units, 10)

    def test_observed_time_replaces_norm(self):
        result = requirement("paletizada", Decimal("8000"), units=10, observed_unload=Decimal(30))
        self.assertEqual((result.unload_minutes, result.cycle_minutes, result.time_source),
                         (Decimal(30), Decimal(100), "tempo_real"))

    def test_adubo_forklift_supports_insumos_and_machine_yard_never_lends(self):
        assignments, conflicts = assign_forklifts({"INSUMOS": 2}, INVENTORY)
        self.assertEqual(conflicts, [])
        self.assertIn({"warehouse": "INSUMOS", "from": "ADUBO", "quantity": 1, "borrowed": True}, assignments)
        _, conflicts = assign_forklifts({"INSUMOS": 2}, {**INVENTORY, "ADUBO": {"quantity": 2, "mobile": False}})
        self.assertEqual(conflicts, [{"warehouse": "INSUMOS", "missing": 1}])

    def test_two_pallet_trucks_in_one_slot_need_four_people_and_two_forklifts(self):
        loads = [{"warehouse": "INSUMOS", "requirement": requirement("paletizada", Decimal("8000"), 10)}
                 for _ in range(2)]
        slot = plan_slot(date(2026, 10, 5), "08:00", loads, INVENTORY)
        self.assertEqual((slot["chapas"], slot["gas_forklifts"]), (4, 2))
        self.assertTrue(any("ADUBO" in warning for warning in slot["warnings"]))

    def test_late_slot_crosses_workday_end(self):
        slot = plan_slot(date(2026, 10, 5), "15:00",
                         [{"warehouse": "ADUBO", "requirement": requirement("big_bag", Decimal("20000"), 30)}], INVENTORY)
        self.assertTrue(slot["after_hours"])
        self.assertEqual(slot["ends_at"], "17:30")

    def test_season_target(self):
        self.assertEqual(season_target(date(2026, 11, 1))["min"], 14)
        self.assertEqual(season_target(date(2026, 6, 1))["min"], 8)


class DayPlanApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("armazem_plan")
        UserProfile.objects.create(user=self.user, role="warehouse")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.insumos = Warehouse.objects.create(code="INSUMOS", name="Insumos")
        self.adubo = Warehouse.objects.create(code="ADUBO", name="Adubo")
        self.supplier = Supplier.objects.create(code="S1", name="Fornecedor")
        self.day = date(2026, 10, 5)

    def appointment(self, time, packaging, warehouse, volumes):
        invoice = Invoice.objects.create(supplier=self.supplier, file="x.pdf", original_name="x.pdf",
                                         media_type="application/pdf", sha256="0" * 64, created_by=self.user,
                                         extracted={"volumes": volumes})
        slot, _ = GlobalSlot.objects.get_or_create(date=self.day, time=time)
        appointment = Appointment.objects.create(supplier=self.supplier, invoice=invoice, slot=slot,
                                                 packaging=packaging, created_by=self.user)
        WarehouseVisit.objects.create(appointment=appointment, warehouse=warehouse, sequence=1)
        return appointment

    def test_day_plan_peaks_and_forklift_suggestion_from_registered_inventory(self):
        Equipment.objects.create(code="G1", name="Gás Insumos", warehouse=self.insumos, kind="EMPILHADEIRA_GAS", mobile=False)
        Equipment.objects.create(code="G2", name="Gás Adubo", warehouse=self.adubo, kind="EMPILHADEIRA_GAS",
                                 quantity=2, mobile=True)
        self.appointment("08:00", "batida", self.adubo, [{"quantity": "200", "gross_weight": "10000"}])
        self.appointment("10:00", "paletizada", self.insumos, [{"quantity": "10", "gross_weight": "8000"}])
        self.appointment("10:00", "paletizada", self.insumos, [{"quantity": "10", "gross_weight": "8000"}])
        self.appointment("13:00", "big_bag", self.adubo, [{"quantity": "4", "gross_weight": "400"}])
        response = self.client.get("/api/v2/allocation/day-plan/", {"date": "2026-10-05"})
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data
        self.assertEqual(data["inventory"]["source"], "cadastro")
        self.assertEqual((data["peak_chapas"], data["peak_gas_forklifts"], data["loads"]), (5, 2, 4))
        slots = {slot["time"]: slot for slot in data["slots"]}
        self.assertEqual(slots["10:00"]["forklift_conflicts"], [])
        self.assertTrue(any(a["borrowed"] and a["from"] == "ADUBO" for a in slots["10:00"]["forklift_assignments"]))
        self.assertTrue(slots["13:00"]["loads"][0]["requirement"]["light_load"])

    def test_period_and_default_inventory(self):
        response = self.client.get("/api/v2/allocation/day-plan/", {"date_from": "2026-10-05", "date_to": "2026-10-10"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["results"]), 6)
        self.assertEqual(response.data["results"][0]["inventory"]["source"], "padrao_prd")
        self.assertEqual(response.data["results"][5]["day_type"], "saturday")
        norms = self.client.get("/api/v2/allocation/norms/")
        self.assertEqual(norms.status_code, 200)
        self.assertEqual(len(norms.data["norms"]), 4)
