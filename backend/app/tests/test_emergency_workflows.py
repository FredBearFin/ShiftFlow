"""Tests for Store Manager Emergency Callout operations.

Callout replacement needs each associate's STORED shift times and rest intervals,
which nothing persists, so it must answer 501 rather than return a ranked queue
nothing backs.

Swap validation no longer belongs here: it is computed from the per-line data a solved
roster already carries, which the caller sends with the request. Its tests are in
test_shift_swap.py. The cases below hold the line that a swap sent WITHOUT that roster
is still refused rather than answered from nothing.
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

    def test_02_swap_without_a_roster_is_refused_not_answered(self):
        """A swap carrying no roster has no source for a verdict, so it is rejected.

        Both an adjacent-day and a non-adjacent-day request are checked, and neither
        comes back with the hard-coded rest figure the old fixed verdict used to quote.
        """
        for day_a, day_b in ((2, 3), (1, 4)):
            res = self.client.post(
                "/api/emergency/validate-swap",
                json={
                    "associate_a_id": "EMP-04",
                    "associate_b_id": "EMP-03",
                    "day_a_index": day_a,
                    "day_b_index": day_b,
                },
            )
            self.assertEqual(res.status_code, 422)
            self.assertIn("roster_lines", res.text)
            self.assertNotIn("11.0 hours", res.text)

    def test_03_callout_without_employee_id_returns_501(self):
        """A callout with no missing employee also returns 501, not a default name."""
        res = self.client.post("/api/emergency/callout-replacement", json={"target_day_index": 0, "target_shift_code": "M"})
        self.assertEqual(res.status_code, 501)
        self.assertEqual(res.json(), NO_SOURCE)


if __name__ == "__main__":
    unittest.main()
