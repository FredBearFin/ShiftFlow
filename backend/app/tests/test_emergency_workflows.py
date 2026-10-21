"""Tests for Store Manager Emergency Callout & Shift Swap operations.

Both endpoints need stored shift and rest data, which the schema does not hold,
so each must answer 501 rather than return a fixed roster or verdict.
"""

import unittest
from fastapi.testclient import TestClient


from app.main import app

NO_SOURCE = {"detail": "not implemented: no source data"}


class TestEmergencyWorkflows(unittest.TestCase):
    """Test suite verifying emergency endpoints refuse to return unsourced results."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_callout_returns_501_without_stored_data(self):
        """Saturday evening callout returns 501 and names no fixed candidate."""
        payload = {
            "target_day_index": 5,      # Saturday
            "target_shift_code": "E",   # Evening (16:00-24:00)
            "line_number": 6,
            "missing_employee_id": "EMP-03",
        }
        response = self.client.post("/api/emergency/callout-replacement", json=payload)
        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.json(), NO_SOURCE)
        self.assertNotIn("Devon Taylor", response.text)
        self.assertNotIn("Elena Rodriguez", response.text)

    def test_02_swap_returns_501_for_adjacent_and_non_adjacent_days(self):
        """Shift swap validation returns 501 for both adjacent and non-adjacent days."""
        dangerous_swap = {
            "associate_a_id": "EMP-04",
            "associate_b_id": "EMP-03",
            "day_a_index": 2,  # Wednesday
            "day_b_index": 3,  # Thursday
        }
        res_danger = self.client.post("/api/emergency/validate-swap", json=dangerous_swap)
        self.assertEqual(res_danger.status_code, 501)
        self.assertEqual(res_danger.json(), NO_SOURCE)
        self.assertNotIn("11.0 hours", res_danger.text)

        safe_swap = {
            "associate_a_id": "EMP-04",
            "associate_b_id": "EMP-03",
            "day_a_index": 1,  # Tuesday
            "day_b_index": 4,  # Friday
        }
        res_safe = self.client.post("/api/emergency/validate-swap", json=safe_swap)
        self.assertEqual(res_safe.status_code, 501)
        self.assertEqual(res_safe.json(), NO_SOURCE)

    def test_03_callout_without_employee_id_returns_501(self):
        """A callout with no missing employee also returns 501, not a default name."""
        res = self.client.post("/api/emergency/callout-replacement", json={"target_day_index": 0, "target_shift_code": "M"})
        self.assertEqual(res.status_code, 501)
        self.assertEqual(res.json(), NO_SOURCE)


if __name__ == "__main__":
    unittest.main()
