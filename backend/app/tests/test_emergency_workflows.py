"""Unit and integration tests for Store Manager Emergency Callout & Shift Swap operations."""

import unittest
from fastapi.testclient import TestClient

from app.main import app


class TestEmergencyWorkflows(unittest.TestCase):
    """Test suite verifying chaotic store emergency handling, callouts, and shift swaps."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_saturday_evening_callout_ranking_and_clopening_block(self):
        """Verify Saturday 8pm callout recommends zero-clopening candidate and blocks unsafe Sunday openers."""
        payload = {
            "target_day_index": 5,      # Saturday
            "target_shift_code": "E",   # Evening (16:00-24:00)
            "line_number": 6,
        }
        response = self.client.post("/api/emergency/callout-replacement", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["target_day_name"], "Sat")
        self.assertEqual(data["target_shift_code"], "E")
        self.assertGreaterEqual(data["candidates_count"], 3)

        # Candidate 1 should be recommended (Devon Taylor)
        rec = data["candidates"][0]
        self.assertTrue(rec["is_recommended"])
        self.assertEqual(rec["employee_id"], "EMP-03")
        self.assertEqual(rec["employee_name"], "Devon Taylor")
        self.assertFalse(rec["clopening_risk"])
        self.assertFalse(rec["overtime_risk"])
        self.assertEqual(rec["hours_with_shift"], 40)
        self.assertGreaterEqual(rec["prior_rest_hours"], 16.0)
        self.assertGreaterEqual(rec["next_rest_hours"], 16.0)

        # Priya Patel must be BLOCKED because of Sunday 6:00 AM opening shift (6h turnaround)
        priya = next((c for c in data["candidates"] if c["employee_id"] == "EMP-05"), None)
        self.assertIsNotNone(priya)
        self.assertTrue(priya["clopening_risk"])
        self.assertFalse(priya["is_recommended"])
        self.assertIn("BLOCKED", priya["status_label"])
        self.assertLess(priya["next_rest_hours"], 16.0)

        # Sarah Kowalski should be available with Overtime
        sarah = next((c for c in data["candidates"] if c["employee_id"] == "EMP-02"), None)
        self.assertIsNotNone(sarah)
        self.assertTrue(sarah["overtime_risk"])
        self.assertFalse(sarah["clopening_risk"])
        self.assertIn("Overtime", sarah["status_label"])

    def test_02_bilateral_shift_swap_clopening_guardrail(self):
        """Verify adjacent day Evening->Day swap is rejected, and non-adjacent swap is approved."""
        # Dangerous swap: Wednesday (day 2) Evening to Thursday (day 3) Day
        dangerous_swap = {
            "associate_a_id": "EMP-04",
            "associate_b_id": "EMP-03",
            "day_a_index": 2,  # Wednesday
            "day_b_index": 3,  # Thursday
        }
        res_danger = self.client.post("/api/emergency/validate-swap", json=dangerous_swap)
        self.assertEqual(res_danger.status_code, 200)
        data_danger = res_danger.json()

        self.assertFalse(data_danger["is_approved"])
        self.assertTrue(data_danger["clopening_violation_a"])
        self.assertTrue(any("REJECTED" in msg for msg in data_danger["validation_messages"]))

        # Safe swap: Tuesday (day 1) to Friday (day 4)
        safe_swap = {
            "associate_a_id": "EMP-04",
            "associate_b_id": "EMP-03",
            "day_a_index": 1,  # Tuesday
            "day_b_index": 4,  # Friday
        }
        res_safe = self.client.post("/api/emergency/validate-swap", json=safe_swap)
        self.assertEqual(res_safe.status_code, 200)
        data_safe = res_safe.json()

        self.assertTrue(data_safe["is_approved"])
        self.assertFalse(data_safe["clopening_violation_a"])
        self.assertFalse(data_safe["clopening_violation_b"])
        self.assertIn("APPROVED", data_safe["validation_messages"][0])
        self.assertIn("Zero impact", data_safe["next_monday_rotation_impact"])

    def test_03_fastapi_emergency_endpoints_exist(self):
        """Verify endpoints return standard 200 responses."""
        res = self.client.post("/api/emergency/callout-replacement", json={"target_day_index": 0, "target_shift_code": "M"})
        self.assertEqual(res.status_code, 200)


if __name__ == "__main__":
    unittest.main()
