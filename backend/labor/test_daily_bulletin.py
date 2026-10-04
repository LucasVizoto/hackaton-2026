"""Boletim único por dia (boletim-v3): decisão da Cocapec de 03/10/2026, exemplo oficial do Adubo de 17/11/2025."""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from labor.constants import RATE_TABLE
from labor.models import DailyBulletin, IndividualAllocation, WorkerAdjustment
from labor.tests import labor_fixtures

DAY = date(2025, 11, 17)


class DailyBulletinBase(TestCase):
    def setUp(self):
        labor_fixtures(self)
        self.client = APIClient()
        self.client.force_authenticate(self.operator)

    def lines(self, split=False):
        if split:
            return [
                {"warehouse": str(self.warehouse.pk), "category": "FERTILIZANTES", "unloading": "2778"},
                {"warehouse": str(self.other_warehouse.pk), "category": "AGROQUIMICO", "unloading": "30"},
                {"warehouse": str(self.other_warehouse.pk), "category": "SERVICOS_DIVERSOS", "removal": "40"},
            ]
        return [{"warehouse": str(self.warehouse.pk), "category": code, "unloading": qty}
                for code, qty in (("FERTILIZANTES", "2778"), ("AGROQUIMICO", "30"), ("SERVICOS_DIVERSOS", "40"))]

    def payload(self, half=False, split=False, day=DAY, people=11):
        return {"reference_date": str(day), "origin": "demo_sintetico", "lines": self.lines(split),
                "participants": [{"worker": str(w.pk), "fraction": "0.5" if half and i == people - 1 else "1.0"}
                                 for i, w in enumerate(self.workers[:people])]}

    def create(self, **kwargs):
        response = self.client.post("/api/v2/bulletins/", self.payload(**kwargs), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def close(self, bulletin):
        response = self.client.post(f"/api/v2/bulletins/{bulletin['id']}/close/", {"revision": bulletin["revision"]},
                                    format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

class DailyBulletinTests(DailyBulletinBase):
    def test_official_example_full_team(self):
        bulletin = self.close(self.create())
        self.assertEqual((bulletin["scope"], bulletin["financial_version"], bulletin["warehouse"]), ("day", "boletim-v3", None))
        resumo = bulletin["calculation"]["resumo"]
        self.assertEqual((resumo["producaoTotal"], resumo["totalAPagar"], resumo["complemento"]),
                         ("918.20", "991.90", "73.71"))
        values = sorted(Decimal(a["display"]["total_payable"]) for a in bulletin["individual_allocations"])
        self.assertEqual(values.count(Decimal("90.17")), 8)
        self.assertEqual(values.count(Decimal("90.18")), 3)
        self.assertEqual(sum(values), Decimal("991.90"))

    def test_official_example_with_half_day(self):
        bulletin = self.close(self.create(half=True))
        resumo = bulletin["calculation"]["resumo"]
        self.assertEqual((resumo["totalAPagar"], resumo["complemento"]), ("946.82", "28.62"))
        values = sorted(Decimal(a["display"]["total_payable"]) for a in bulletin["individual_allocations"])
        self.assertEqual(values[0], Decimal("45.09"))
        self.assertEqual(sum(values), Decimal("946.82"))

    def test_one_bulletin_per_day_and_person_once(self):
        self.create()
        again = self.client.post("/api/v2/bulletins/", self.payload(), format="json")
        self.assertEqual(again.status_code, 400)
        legacy = self.client.post("/api/v2/bulletins/", {**self.payload(), "warehouse": str(self.warehouse.pk)},
                                  format="json")
        self.assertEqual(legacy.status_code, 400)
        self.assertEqual(DailyBulletin.objects.count(), 1)
        duplicated = self.payload()
        duplicated["participants"].append(duplicated["participants"][0])
        self.assertEqual(self.client.post("/api/v2/bulletins/", {**duplicated, "reference_date": "2025-11-18"},
                                          format="json").status_code, 400)

    def test_lines_require_warehouse_and_daily_services_disabled(self):
        payload = self.payload()
        payload["lines"][0].pop("warehouse")
        self.assertEqual(self.client.post("/api/v2/bulletins/", payload, format="json").status_code, 400)
        payload = {**self.payload(), "daily_services": [{"kind": "FULL", "quantity": "1"}]}
        self.assertEqual(self.client.post("/api/v2/bulletins/", payload, format="json").status_code, 400)

    def test_more_than_twenty_and_invalid_fraction_refused(self):
        self.assertEqual(self.client.post("/api/v2/bulletins/", self.payload(people=21), format="json").status_code, 400)
        payload = self.payload()
        payload["participants"][0]["fraction"] = "0.7"
        self.assertEqual(self.client.post("/api/v2/bulletins/", payload, format="json").status_code, 400)

    def test_cost_split_by_production_share(self):
        bulletin = self.close(self.create(split=True))
        split = bulletin["calculation"]["warehouse_costs"]
        self.assertFalse(split["unattributed"])
        rows = {row["warehouse"]: row for row in split["warehouses"]}
        self.assertEqual(set(rows), {"TEST-LAB-A", "TEST-LAB-B"})
        self.assertEqual(sum(Decimal(r["display"]["total_payable"]) for r in rows.values()), Decimal("991.90"))
        self.assertGreater(Decimal(rows["TEST-LAB-A"]["share"]), Decimal("0.97"))

    def test_saturday_without_production_is_unattributed(self):
        payload = {**self.payload(day=date(2025, 11, 22)), "lines": []}
        bulletin = self.client.post("/api/v2/bulletins/", payload, format="json").data
        bulletin = self.close(bulletin)
        split = bulletin["calculation"]["warehouse_costs"]
        self.assertTrue(split["unattributed"])
        self.assertEqual(split["warehouses"][0]["display"]["total_payable"], "991.90")

    def test_empty_team_stays_draft(self):
        bulletin = self.create(people=0)
        response = self.client.post(f"/api/v2/bulletins/{bulletin['id']}/close/", {"revision": bulletin["revision"]},
                                    format="json")
        self.assertEqual(response.status_code, 400)

    def test_tariff_validity_applies_to_drafts_never_to_closed_days(self):
        closed = self.close(self.create())
        draft = self.create(day=date(2025, 11, 18))
        rates = {code: price for code, _, price in RATE_TABLE}
        rates["FERTILIZANTES"] = "0.4000"
        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.post("/api/v2/tariff-tables/", {"valid_from": "2025-11-01", "floor_per_day": "95",
                                                                     "rates": rates}, format="json").status_code, 403)
        self.client.force_authenticate(self.manager)
        response = self.client.post("/api/v2/tariff-tables/", {"valid_from": "2025-11-01", "floor_per_day": "95",
                                                                "rates": rates}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        partial = self.client.post("/api/v2/tariff-tables/", {"valid_from": "2025-12-01", "floor_per_day": "95",
                                                               "rates": {"FERTILIZANTES": "1"}}, format="json")
        self.assertEqual(partial.status_code, 400)
        self.client.force_authenticate(self.operator)
        old = self.client.get(f"/api/v2/bulletins/{closed['id']}/").data
        self.assertEqual(old["calculation"]["resumo"]["totalAPagar"], "991.90")
        shown = self.client.get(f"/api/v2/bulletins/{draft['id']}/").data
        self.assertEqual(shown["calculation"]["floor_per_day"], "95.0000")
        self.assertEqual(next(line["price"] for line in shown["lines"] if line["category"] == "FERTILIZANTES"), "0.4000")
        new = self.close(shown)
        self.assertEqual(new["calculation"]["resumo"], shown["calculation"]["resumo"])
        self.assertEqual(new["calculation"]["floor_per_day"], "95.0000")
        self.assertEqual(new["calculation"]["tariff_table"]["valid_from"], "2025-11-01")
        current = self.client.get("/api/v2/tariff-tables/", {"date": "2025-11-20"}).data
        self.assertEqual(current["current"]["floor_per_day"], "95.0000")

    def test_reopen_requires_reason_and_keeps_history(self):
        bulletin = self.close(self.create())
        response = self.client.post(f"/api/v2/bulletins/{bulletin['id']}/reopen/", {"revision": bulletin["revision"]},
                                    format="json")
        self.assertEqual(response.status_code, 400)
        response = self.client.post(f"/api/v2/bulletins/{bulletin['id']}/reopen/",
                                    {"revision": bulletin["revision"], "reason": "Matrícula errada"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        history = self.client.get(f"/api/v2/bulletins/{bulletin['id']}/history/").data
        self.assertTrue(any(item["reason"] == "Matrícula errada" for item in history))
        self.assertFalse(IndividualAllocation.objects.filter(active=True).exists())

    def test_adjustment_does_not_change_bulletin_and_feeds_fortnight(self):
        bulletin = self.close(self.create())
        worker = self.workers[0]
        response = self.client.post("/api/v2/labor-adjustments/", {
            "worker": str(worker.pk), "reference_date": str(DAY), "origin": "demo_sintetico", "kind": "OVERTIME",
            "amount": "25.50", "reason": "Hora extra confirmada pelo RH"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        outsider = self.client.post("/api/v2/labor-adjustments/", {
            "worker": str(self.workers[20].pk), "reference_date": str(DAY), "origin": "demo_sintetico",
            "kind": "OTHER", "amount": "10", "reason": "x"}, format="json")
        self.assertEqual(outsider.status_code, 400)
        after = self.client.get(f"/api/v2/bulletins/{bulletin['id']}/").data
        self.assertEqual(after["calculation"]["resumo"], bulletin["calculation"]["resumo"])
        self.assertEqual(len(after["adjustments"]), 1)
        settlement = self.client.get("/api/v2/settlements/fortnight/", {"date": "2025-11-20", "origin": "demo_sintetico"}).data
        self.assertEqual(settlement["period"]["date_from"], "2025-11-16")
        self.assertEqual(settlement["period"]["date_to"], "2025-11-30")
        statuses = {d["date"]: d["status"] for d in settlement["days"]}
        self.assertEqual(statuses["2025-11-17"], "fechado")
        self.assertEqual(statuses["2025-11-18"], "sem_dado")
        self.assertEqual(statuses["2025-11-16"], "sem_expediente")
        row = next(r for r in settlement["workers"] if r["worker"] == str(worker.pk))
        self.assertEqual(Decimal(row["total"]), Decimal(row["base_total"]) + Decimal("25.50"))
        self.assertNotIn("2025-11-18", row["days"])
        self.assertEqual(Decimal(settlement["totals"]["base"]), Decimal("991.90"))
        cancel = self.client.post(f"/api/v2/labor-adjustments/{response.data['id']}/cancel/", {"reason": "Lançado em dobro"},
                                  format="json")
        self.assertEqual(cancel.status_code, 200)
        self.assertTrue(WorkerAdjustment.objects.get().cancelled_at)

    def test_first_fortnight_bounds_and_warehouse_filter(self):
        self.create(split=True)
        settlement = self.client.get("/api/v2/settlements/fortnight/", {"date": "2025-11-03"}).data
        self.assertEqual((settlement["period"]["date_from"], settlement["period"]["date_to"]), ("2025-11-01", "2025-11-15"))
        listed = self.client.get("/api/v2/bulletins/", {"warehouse": str(self.other_warehouse.pk)}).data
        self.assertEqual(listed["count"], 1)

    def test_v1_cannot_touch_daily_bulletin(self):
        bulletin = self.create()
        response = self.client.post(f"/api/v1/bulletins/{bulletin['id']}/close/", {"revision": bulletin["revision"]},
                                    format="json")
        self.assertEqual(response.status_code, 400)
        payload = self.payload(day=date(2025, 11, 19))
        self.assertEqual(self.client.post("/api/v1/bulletins/", payload, format="json").status_code, 400)


class DailyBulletinAnalyticsTests(DailyBulletinBase):
    def test_dashboard_series_and_week_reconcile_with_split_daily_bulletin(self):
        bulletin = self.close(self.create(split=True, half=True))
        self.client.force_authenticate(self.manager)
        params = {"date_from": "2025-11-16", "date_to": "2025-11-18", "origin": "demo_sintetico"}
        response = self.client.get("/api/v2/analytics/labor-costs/", params)
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data
        row = data["daily_series"][1]
        for key in ("production", "supplement", "total_payable"):
            self.assertEqual(Decimal(row[key]), Decimal(bulletin["calculation"][key]))
        self.assertIsNone(data["daily_series"][0]["total_payable"])
        week = data["weekly_supplement"]
        self.assertEqual(week["closed_bulletins"], 1)
        self.assertEqual(len(week["groups"]), 2)
        self.assertEqual(sum(Decimal(group["supplement"]) for group in week["groups"]), Decimal(row["supplement"]))
        for warehouse in (self.warehouse, self.other_warehouse):
            filtered = self.client.get("/api/v2/analytics/labor-costs/", {**params, "warehouse": str(warehouse.pk)})
            self.assertEqual(filtered.status_code, 200, filtered.data)
            filtered = filtered.data
            self.assertEqual(filtered["daily_series"][1]["total_payable"], filtered["summary"]["total_payable"])
            self.assertEqual(filtered["weekly_supplement"]["closed_bulletins"], 1)
            self.assertEqual(filtered["weekly_supplement"]["groups"][0]["warehouse"], str(warehouse.pk))
            self.assertLess(Decimal(filtered["summary"]["total_payable"]), Decimal(row["total_payable"]))

    def test_dashboard_unattributed_daily_floor_and_assistant_context(self):
        payload = {**self.payload(day=date(2025, 11, 22)), "lines": []}
        response = self.client.post("/api/v2/bulletins/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        bulletin = self.close(response.data)
        self.client.force_authenticate(self.manager)
        params = {"date_from": "2025-11-22", "date_to": "2025-11-22", "origin": "demo_sintetico"}
        response = self.client.get("/api/v2/analytics/labor-costs/", params)
        self.assertEqual(response.status_code, 200, response.data)
        week = response.data["weekly_supplement"]
        self.assertEqual(week["closed_bulletins"], 1)
        self.assertEqual(week["groups"][0]["warehouse_name"], "Não atribuído")
        self.assertEqual(week["groups"][0]["supplement"], bulletin["calculation"]["supplement"])
        from integrations.views import analytics_context
        context = analytics_context(self.manager, params)
        self.assertEqual(context["weekly_supplement"], week)
        self.assertEqual(context["financial_summary"]["total_payable"], response.data["daily_series"][0]["total_payable"])

    def test_management_cost_split_and_statement(self):
        bulletin = self.close(self.create(split=True))
        self.client.force_authenticate(self.manager)
        params = {"date_from": "2025-11-01", "date_to": "2025-11-30", "origin": "demo_sintetico"}
        costs = self.client.get("/api/v2/analytics/labor-costs/", params)
        self.assertEqual(costs.status_code, 200, costs.data)
        groups = {g["warehouse_name"]: g for g in costs.data["groups"]}
        self.assertEqual(set(groups), {self.warehouse.name, self.other_warehouse.name})
        self.assertEqual(sum(Decimal(g["total_payable"]) for g in groups.values()).quantize(Decimal("0.01")),
                         Decimal("991.90"))
        self.assertEqual(costs.data["summary"]["total_payable"], bulletin["calculation"]["total_payable"])
        filtered = self.client.get("/api/v2/analytics/labor-costs/", {**params, "warehouse": str(self.other_warehouse.pk)})
        self.assertEqual(len(filtered.data["groups"]), 1)
        self.assertLess(Decimal(filtered.data["summary"]["total_payable"]), Decimal("40"))
        statement = self.client.get(f"/api/v2/workers/{self.workers[0].pk}/statement/", params)
        self.assertEqual(statement.status_code, 200, statement.data)
        self.assertIsNone(statement.data["operational"]["days"][0]["warehouse"])
        scenario = self.client.post("/api/v2/analytics/staffing-scenario/",
                                    {"bulletin": bulletin["id"], "equivalent_days": "10"}, format="json")
        self.assertEqual(scenario.status_code, 200, scenario.data)
