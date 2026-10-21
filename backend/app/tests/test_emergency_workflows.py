"""Tests for Store Manager Emergency Operations, at the edges where there is no source.

Both emergency endpoints used to answer 501 because nothing stored per-employee shift
times or rest intervals. That storage now exists (assignment_shifts), so the refusals
below are the narrower ones that remain: a facility that does not exist, and a request
carrying nothing to compute a verdict from. Neither is ever answered with a fixed
roster, a default name or an invented figure.

The cases that exercise real verdicts live in test_shift_swap.py and test_callout_cover.py.
"""

import unittest
from fastapi.testclient import TestClient


from app.main import app


class TestEmergencyWorkflows(unittest.TestCase):
    """Test suite verifying emergency endpoints refuse to return unsourced results."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_callout_for_an_unknown_facility_names_no_candidate(self):
        """A facility that does not exist is a 404, not a ranked queue of invented names."""
        payload = {
            "facility_id": "FAC-DOES-NOT-EXIST",
            "target_day_index": 5,      # Saturday
            "target_shift_code": "E",   # Evening
            "line_number": 6,
            "missing_employee_id": "EMP-03",
        }
        response = self.client.post("/api/emergency/callout-replacement", json=payload)
        self.assertEqual(response.status_code, 404)
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

    def test_03_callout_without_an_employee_id_still_invents_no_name(self):
        """A callout naming nobody is refused on the facility, not answered with a default."""
        res = self.client.post(
            "/api/emergency/callout-replacement",
            json={"facility_id": "FAC-DOES-NOT-EXIST", "target_day_index": 0, "target_shift_code": "M"},
        )
        self.assertEqual(res.status_code, 404)
        self.assertNotIn("Devon Taylor", res.text)

    def test_04_stored_roster_for_an_unknown_facility_is_a_404(self):
        res = self.client.get("/api/emergency/stored-roster?facility_id=FAC-DOES-NOT-EXIST")
        self.assertEqual(res.status_code, 404)


if __name__ == "__main__":
    unittest.main()
