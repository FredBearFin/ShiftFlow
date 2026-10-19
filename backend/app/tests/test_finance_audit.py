"""Unit and integration tests for CFO Financial Controller & EBITDA Audit engine."""

import unittest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection, ShiftFlowRepository


class TestCFOFinancialAudit(unittest.TestCase):
    """Test suite verifying financial controller formulas, EBITDA expansion, and fleet valuation models."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.conn = get_db_connection()
        cls.repo = ShiftFlowRepository(cls.conn)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def test_01_single_store_ebitda_audit_calculations(self):
        """Verify single-store GAAP/CFO EBITDA audit formulas and return metrics."""
        response = self.client.get("/api/finance/ebitda-audit?annual_revenue=670000.0")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        # Verify key baseline values
        self.assertEqual(data["active_headcount"], 6)
        self.assertEqual(data["average_hourly_wage"], 16.50)
        self.assertEqual(data["annual_gross_revenue"], 670000.0)

        # Verify hard overtime savings ($2,005 target)
        self.assertAlmostEqual(data["hard_overtime_savings"], 2005.12, delta=10.0)

        # Verify churn reduction savings ($7,434 target)
        self.assertAlmostEqual(data["churn_reduction_savings"], 7434.0, delta=20.0)

        # Verify manager reallocation ($3,711 target)
        self.assertAlmostEqual(data["manager_floor_reallocation_savings"], 3711.14, delta=10.0)

        # Gross annual value ~$13,148
        self.assertAlmostEqual(data["gross_annual_value"], 13150.26, delta=30.0)

        # Net EBITDA gain ~$12,202
        self.assertAlmostEqual(data["net_ebitda_gain"], 12202.26, delta=30.0)

        # Payback period under 30 days
        self.assertLessEqual(data["payback_days"], 30.0)
        self.assertGreaterEqual(data["payback_days"], 20.0)

        # Annual ROI ratio > 12.0x
        self.assertGreaterEqual(data["annual_roi_ratio"], 12.0)

        # EBITDA margin expansion > 150 bps
        self.assertGreaterEqual(data["ebitda_margin_expansion_bps"], 150.0)

        # Verify statutory audit notes
        self.assertGreaterEqual(len(data["audit_methodology_notes"]), 4)

    def test_02_fleet_projections_and_enterprise_value_multiples(self):
        """Verify multi-store fleet economics and 6.0x private equity valuation arbitrage."""
        response = self.client.get("/api/finance/fleet-projections?store_count=10&valuation_multiple=6.0")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["store_count"], 10)
        self.assertEqual(data["combined_gross_revenue"], 6700000.0)

        # Fleet software cost: 10 stores * $39/mo * 12 mos = $4,680
        self.assertEqual(data["fleet_software_annual_cost"], 4680.0)

        # Net annual EBITDA impact should exceed $120,000 for 10 stores
        self.assertGreaterEqual(data["net_annual_ebitda_impact"], 120000.0)

        # Enterprise value created at 6.0x multiple should exceed $720,000
        self.assertAlmostEqual(
            data["enterprise_value_gain"],
            round(data["net_annual_ebitda_impact"] * 6.0, 2),
            delta=1.0,
        )
        self.assertGreaterEqual(data["enterprise_value_gain"], 720000.0)

        # Fleet ROI multiple should exceed 25x
        self.assertGreaterEqual(data["fleet_roi_multiple"], 25.0)

    def test_03_facility_specific_ebitda_audit(self):
        """Verify facility lookup dynamically incorporates seeded store wage and headcount."""
        response = self.client.get("/api/finance/ebitda-audit?facility_id=fac_downtown_foodmart")
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["facility_id"], "fac_downtown_foodmart")
        self.assertIn("Downtown Foodmart", data["facility_name"])
        self.assertGreaterEqual(data["active_headcount"], 4)
        self.assertGreater(data["net_ebitda_gain"], 0.0)


if __name__ == "__main__":
    unittest.main()
