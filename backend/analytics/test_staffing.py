from datetime import date
from decimal import Decimal

from labor.test_daily_bulletin import DailyBulletinBase


class StaffingBalanceTests(DailyBulletinBase):
    def test_supplement_every_day_with_light_agenda_signals_surplus(self):
        self.close(self.create(split=True))
        self.close(self.create(day=date(2025, 11, 18)))
        self.client.force_authenticate(self.manager)
        response = self.client.get("/api/v2/analytics/staffing-balance/", {
            "date_from": "2025-11-17", "date_to": "2025-11-21", "origin": "demo_sintetico"})
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data
        self.assertEqual(data["signal"]["status"], "sobra")
        indicators = data["indicators"]
        self.assertEqual((indicators["days_with_bulletin"], indicators["days_below_floor"]), (2, 2))
        self.assertEqual(indicators["days_without_data"], 3)
        self.assertEqual(Decimal(indicators["supplement_total"]), Decimal("147.42"))
        days = {row["date"]: row for row in data["days"]}
        self.assertEqual(days["2025-11-19"]["status"], "sem_dado")
        self.assertIsNone(days["2025-11-19"]["total_payable"])
        self.assertEqual(days["2025-11-17"]["production_per_equivalent_day"], "83.47")
        names = {row["warehouse_name"] for row in data["warehouse_costs"]}
        self.assertEqual(names, {self.warehouse.name, self.other_warehouse.name})

    def test_without_bulletins_there_is_no_conclusion(self):
        self.client.force_authenticate(self.manager)
        data = self.client.get("/api/v2/analytics/staffing-balance/", {
            "date_from": "2025-11-17", "date_to": "2025-11-17", "origin": "demo_sintetico"}).data
        self.assertEqual(data["signal"]["status"], "sem_dado")
        too_long = self.client.get("/api/v2/analytics/staffing-balance/", {"date_from": "2025-01-01", "date_to": "2025-12-31"})
        self.assertEqual(too_long.status_code, 400)
