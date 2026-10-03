import threading
from datetime import date, timedelta
from decimal import Decimal
from unittest import skipUnless

from django.contrib.auth.models import User
from django.db import close_old_connections, connection
from django.test import SimpleTestCase, TestCase, TransactionTestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from catalog.models import Warehouse, Worker
from core.models import UserProfile
from labor.calculation import calculate, money_display
from labor.constants import FLOOR, PRICES, RATE_TABLE
from labor.models import BulletinRevision, DailyBulletin, ServiceRate
from labor.serializers import BulletinInput
from labor.services import close_bulletin, replace_contents, values

REFERENCE = date(2026, 10, 5)


def official_lines():
    return [
        {"category": "FERTILIZANTES", "unloading": "2378", "removal": "400", "transfer": "0"},
        {"category": "AGROQUIMICO", "unloading": "30", "removal": "0", "transfer": "0"},
        {"category": "SERVICOS_DIVERSOS", "unloading": "40", "removal": "0", "transfer": "0"},
    ]


def official_payload(warehouse, workers, *, half=False, day=REFERENCE):
    return {
        "warehouse": str(warehouse.id),
        "reference_date": str(day),
        "origin": "demo_sintetico",
        "lines": official_lines(),
        "participants": [{"worker": str(worker.id), "fraction": "0.5" if half and index == 10 else "1.0"} for index, worker in enumerate(workers[:11])],
    }


def labor_fixtures(instance):
    instance.operator = User.objects.create_user("labor-warehouse-test")
    UserProfile.objects.create(user=instance.operator, role="warehouse")
    instance.manager = User.objects.create_user("labor-management-test")
    UserProfile.objects.create(user=instance.manager, role="management")
    instance.external = User.objects.create_user("labor-supplier-test")
    UserProfile.objects.create(user=instance.external, role="supplier")
    instance.warehouse = Warehouse.objects.create(code="TEST-LAB-A", name="Armazém sintético A")
    instance.other_warehouse = Warehouse.objects.create(code="TEST-LAB-B", name="Armazém sintético B")
    instance.workers = [Worker.objects.create(registration=f"TEST-{index:02d}", name=f"Pessoa sintética {index:02d}", origin="demo_sintetico") for index in range(21)]


def stored_bulletin(instance, *, warehouse=None, people=None, lines=None, day=REFERENCE):
    raw = {
        "warehouse": str((warehouse or instance.warehouse).id),
        "reference_date": str(day),
        "origin": "demo_sintetico",
        "lines": official_lines() if lines is None else lines,
        "participants": people if people is not None else [{"worker": str(worker.id), "fraction": "1"} for worker in instance.workers[:11]],
    }
    serializer = BulletinInput(data=raw)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    bulletin = DailyBulletin.objects.create(warehouse=data["warehouse"], reference_date=data["reference_date"], origin=data["origin"], created_by=instance.operator)
    replace_contents(bulletin, data)
    return bulletin


class MoneyCalculationTests(SimpleTestCase):
    def test_official_eleven_days_exact_and_displayed_values(self):
        lines = [{**line, "price": PRICES[line["category"]]} for line in official_lines()]
        result = calculate(lines, [{"fraction": "1"}] * 11)
        self.assertEqual(Decimal(result["production"]), Decimal("918.1952"))
        self.assertEqual(Decimal(result["equivalent_days"]), Decimal("11"))
        self.assertEqual(Decimal(result["total_payable"]), Decimal("991.9041"))
        self.assertEqual(Decimal(result["supplement"]), Decimal("73.7089"))
        self.assertEqual(result["people_count"], 11)
        self.assertEqual(result["display"], {"production": "918.20", "total_payable": "991.90", "supplement": "73.71"})
        self.assertNotEqual(Decimal(result["display"]["total_payable"]) - Decimal(result["display"]["production"]), Decimal(result["display"]["supplement"]))

    def test_half_day_remains_eleven_people_and_ten_point_five_equivalents(self):
        lines = [{**line, "price": PRICES[line["category"]]} for line in official_lines()]
        result = calculate(lines, [{"fraction": "1"}] * 10 + [{"fraction": "0.5"}])
        self.assertEqual(result["people_count"], 11)
        self.assertEqual(Decimal(result["equivalent_days"]), Decimal("10.5"))
        self.assertEqual(Decimal(result["production"]), Decimal("918.1952"))
        self.assertEqual(Decimal(result["total_payable"]), Decimal("946.81755"))
        self.assertEqual(Decimal(result["supplement"]), Decimal("28.62235"))
        self.assertEqual(result["display"]["total_payable"], "946.82")
        self.assertEqual(result["display"]["supplement"], "28.62")
        self.assertEqual(FLOOR * Decimal("0.5"), Decimal("45.08655"))
        self.assertNotEqual(FLOOR * Decimal("0.5"), Decimal("45.0786"))

    def test_total_is_max_production_floor_without_ceiling_or_extra_supplement(self):
        rich = calculate([{"price": "10", "unloading": "100"}], [{"fraction": "1"}])
        self.assertEqual(Decimal(rich["total_payable"]), Decimal("1000"))
        self.assertEqual(Decimal(rich["supplement"]), 0)
        empty_production = calculate([], [{"fraction": "1"}])
        self.assertEqual(Decimal(empty_production["total_payable"]), FLOOR)
        self.assertEqual(Decimal(empty_production["supplement"]), FLOOR)
        self.assertNotEqual(Decimal(empty_production["total_payable"]), FLOOR + Decimal(empty_production["supplement"]))

    def test_zero_equivalents_has_no_division_and_half_up_is_presentation_only(self):
        result = calculate([], [])
        self.assertIsNone(result["production_per_equivalent_day"])
        self.assertEqual(result["people_count"], 0)
        self.assertEqual(money_display(Decimal("1.005")), "1.01")
        self.assertEqual(money_display(Decimal("0.0049")), "0.00")

    def test_all_three_modalities_and_fourteen_official_prices(self):
        expected = ["0.1824", "0.2635", "0.3224", "1.1780", "2.3561", "0.3387", "0.3224", "0.3224", "0.3224", "0.3224", "0.3387", "0.3387", "0.3224", "0.3224"]
        self.assertEqual(len(RATE_TABLE), 14)
        self.assertEqual([price for _, _, price in RATE_TABLE], expected)
        result = calculate([{"price": price, "unloading": "1", "removal": "2", "transfer": "3"} for price in expected], [{"fraction": "1"}])
        self.assertEqual(Decimal(result["production"]), sum(map(Decimal, expected)) * 6)


class BulletinPersistenceTests(TestCase):
    def setUp(self):
        labor_fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.operator)

    def test_api_official_examples_persist_full_lines_and_names(self):
        for half, total, supplement in [(False, "991.9041", "73.7089"), (True, "946.81755", "28.62235")]:
            day = REFERENCE + timedelta(days=int(half))
            result = self.client.post("/api/v1/bulletins/", official_payload(self.warehouse, self.workers, half=half, day=day), format="json")
            self.assertEqual(result.status_code, 201)
            self.assertEqual(len(result.data["lines"]), 14)
            self.assertEqual(len(result.data["participants"]), 11)
            self.assertEqual(result.data["participants"][0]["name"], self.workers[0].name)
            closed = self.client.post(f"/api/v1/bulletins/{result.data['id']}/close/", {"revision": result.data["revision"]}, format="json")
            self.assertEqual(closed.status_code, 200)
            self.assertEqual(Decimal(closed.data["calculation"]["total_payable"]), Decimal(total))
            self.assertEqual(Decimal(closed.data["calculation"]["supplement"]), Decimal(supplement))
            reload = self.client.get(f"/api/v1/bulletins/{result.data['id']}/")
            self.assertEqual(reload.data["status"], "CLOSED")
            self.assertEqual(reload.data["calculation"], closed.data["calculation"])

    def test_duplicate_worker_over_twenty_invalid_fraction_negative_unknown_rejected(self):
        payload = official_payload(self.warehouse, self.workers)
        cases = []
        cases.append({**payload, "participants": payload["participants"] + [payload["participants"][0]]})
        cases.append({**payload, "participants": [{"worker": str(worker.id), "fraction": "1"} for worker in self.workers]})
        cases.append({**payload, "participants": [{"worker": str(self.workers[0].id), "fraction": "0.7"}]})
        cases.append({**payload, "lines": [{"category": "FERTILIZANTES", "unloading": "-1"}]})
        cases.append({**payload, "lines": [{"category": "UNKNOWN", "unloading": "1"}]})
        cases.append({**payload, "lines": [payload["lines"][0], payload["lines"][0]]})
        for data in cases:
            result = self.client.post("/api/v1/bulletins/", data, format="json")
            self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(DailyBulletin.objects.exists())

    def test_no_team_cannot_close_even_with_positive_production(self):
        for index, lines in enumerate([[], official_lines()]):
            bulletin = stored_bulletin(self, people=[], lines=lines, day=REFERENCE + timedelta(days=index))
            self.assertIsNone(values(bulletin)["calculation"]["production_per_equivalent_day"])
            with self.assertRaises(ValidationError):
                close_bulletin(bulletin.id, self.operator, 1)
            bulletin.refresh_from_db()
            self.assertEqual(bulletin.status, "DRAFT")

    def test_one_bulletin_per_local_date_and_saturday_internal_work_allowed(self):
        payload = official_payload(self.warehouse, self.workers, day=date(2026, 10, 3))
        self.assertEqual(self.client.post("/api/v1/bulletins/", payload, format="json").status_code, 201)
        self.assertEqual(self.client.post("/api/v1/bulletins/", payload, format="json").status_code, 400)
        payload["warehouse"] = str(self.other_warehouse.id)
        self.assertEqual(self.client.post("/api/v1/bulletins/", payload, format="json").status_code, 201)

    def test_closed_price_floor_snapshot_and_audited_reopen(self):
        bulletin = stored_bulletin(self)
        closed = close_bulletin(bulletin.id, self.operator, 1)
        snapshot = values(closed)
        ServiceRate.objects.update_or_create(code="FERTILIZANTES", defaults={"label": "Fertilizantes", "price": Decimal("999")})
        reload = self.client.get(f"/api/v1/bulletins/{bulletin.id}/")
        self.assertEqual(reload.data["calculation"], snapshot["calculation"])
        self.assertEqual(bulletin.lines.get(category="FERTILIZANTES").price, Decimal("0.3224"))
        with self.assertRaises(ValidationError):
            close_bulletin(bulletin.id, self.operator, closed.revision)
        blocked = self.client.patch(f"/api/v1/bulletins/{bulletin.id}/", {"revision": closed.revision, "lines": []}, format="json")
        self.assertEqual(blocked.status_code, 400)
        no_reason = self.client.post(f"/api/v1/bulletins/{bulletin.id}/reopen/", {"revision": closed.revision}, format="json")
        self.assertEqual(no_reason.status_code, 400)
        reopened = self.client.post(f"/api/v1/bulletins/{bulletin.id}/reopen/", {"revision": closed.revision, "reason": "Correção sintética documentada"}, format="json")
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.data["status"], "DRAFT")
        self.assertEqual(BulletinRevision.objects.filter(bulletin=bulletin).count(), 2)
        self.assertEqual(BulletinRevision.objects.filter(bulletin=bulletin).latest("id").snapshot["calculation"], snapshot["calculation"])

    def test_fraction_rateio_two_half_days_allowed_two_full_days_rejected(self):
        for fraction in ["0.5", "1"]:
            day = REFERENCE + timedelta(days=0 if fraction == "0.5" else 1)
            people = [{"worker": str(self.workers[0].id), "fraction": fraction}]
            first = stored_bulletin(self, people=people, warehouse=self.warehouse, day=day)
            second = stored_bulletin(self, people=people, warehouse=self.other_warehouse, day=day)
            close_bulletin(first.id, self.operator, 1)
            if fraction == "0.5":
                self.assertEqual(close_bulletin(second.id, self.operator, 1).status, "CLOSED")
            else:
                with self.assertRaises(ValidationError):
                    close_bulletin(second.id, self.operator, 1)
                second.refresh_from_db()
                self.assertEqual(second.status, "DRAFT")

    def test_permissions_and_revision_reject_stale_save(self):
        bulletin = stored_bulletin(self)
        self.client.force_authenticate(self.external)
        self.assertEqual(self.client.get(f"/api/v1/bulletins/{bulletin.id}/").status_code, 403)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.get(f"/api/v1/bulletins/{bulletin.id}/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/v1/bulletins/{bulletin.id}/close/", {"revision": 1}, format="json").status_code, 403)
        self.client.force_authenticate(self.operator)
        saved = self.client.patch(f"/api/v1/bulletins/{bulletin.id}/", {"revision": 1, "lines": official_lines()}, format="json")
        self.assertEqual(saved.status_code, 200)
        stale = self.client.patch(f"/api/v1/bulletins/{bulletin.id}/", {"revision": 1, "lines": []}, format="json")
        self.assertEqual(stale.status_code, 400)
        self.assertEqual(len(self.client.get(f"/api/v1/bulletins/{bulletin.id}/").data["lines"]), 14)

    def test_synthetic_and_historical_provenance_not_accepted_as_operational(self):
        payload = official_payload(self.warehouse, self.workers)
        for origin in ["operacional_registrado", "historico_importado"]:
            result = self.client.post("/api/v1/bulletins/", {**payload, "origin": origin}, format="json")
            self.assertEqual(result.status_code, 400)

    def test_malformed_revision_and_filters_return_validation_not_server_error(self):
        bulletin = stored_bulletin(self)
        self.client.raise_request_exception = False
        for revision in ["not-a-number", {}, [], 1.5]:
            result = self.client.post(f"/api/v1/bulletins/{bulletin.id}/close/", {"revision": revision}, format="json")
            self.assertEqual(result.status_code, 400, f"revision={revision!r}")
        for query in [{"date_from": "invalid-date"}, {"warehouse": "invalid-uuid"}]:
            self.assertEqual(self.client.get("/api/v1/bulletins/", query).status_code, 400)


@skipUnless(connection.vendor == "postgresql", "Rateio concorrente exige PostgreSQL.")
class BulletinClosingConcurrencyTests(TransactionTestCase):
    def setUp(self):
        labor_fixtures(self)

    def test_same_person_cannot_get_two_full_diarias_under_simultaneous_closing(self):
        people = [{"worker": str(self.workers[0].id), "fraction": "1"}]
        bulletins = [stored_bulletin(self, people=people, warehouse=warehouse) for warehouse in [self.warehouse, self.other_warehouse]]
        barrier = threading.Barrier(2)
        results = []
        guard = threading.Lock()

        def close(bulletin_id):
            close_old_connections()
            try:
                actor = User.objects.get(id=self.operator.id)
                barrier.wait(timeout=15)
                close_bulletin(bulletin_id, actor, 1)
                result = "closed"
            except ValidationError:
                result = "refused"
            except Exception as exc:
                result = repr(exc)
            finally:
                close_old_connections()
            with guard:
                results.append(result)

        threads = [threading.Thread(target=close, args=(bulletin.id,)) for bulletin in bulletins]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive(), "Fechamento ficou bloqueado.")
        self.assertCountEqual(results, ["closed", "refused"])
        self.assertEqual(DailyBulletin.objects.filter(status="CLOSED").count(), 1)
