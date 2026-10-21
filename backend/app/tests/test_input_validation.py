"""Tests for input bounds on solver requests, POS upload and payroll export."""

import io
import unittest

from fastapi.testclient import TestClient

from app.database import get_db_connection, ShiftFlowRepository, init_db
from app.main import app


FACILITY_ID = "FAC-VALIDATION-01"


def _template(**overrides):
    base = {
        "code": "M", "name": "Morning", "earliest_start": 6, "latest_end": 15,
        "min_duration": 7, "max_duration": 9, "preferred_start": 6, "preferred_duration": 8,
    }
    base.update(overrides)
    return base


class InputValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        init_db()
        conn = get_db_connection()
        ShiftFlowRepository(conn).upsert_facility(
            facility_id=FACILITY_ID,
            name="Validation Test Site",
            location="Test City",
            operating_hours="06:00-24:00",
            demand_matrix=[[1] * 24 for _ in range(7)],
            shift_templates=[],
        )
        conn.commit()
        conn.close()

    def _solve_body(self, **overrides):
        body = {"demand_matrix": [[1] * 24 for _ in range(7)], "templates": [_template()]}
        body.update(overrides)
        return body

    def test_demand_value_above_bound_is_rejected(self):
        matrix = [[1] * 24 for _ in range(7)]
        matrix[0][0] = 501
        response = self.client.post("/api/v1/schedules/solve", json=self._solve_body(demand_matrix=matrix))
        self.assertEqual(response.status_code, 422)

    def test_negative_demand_is_rejected(self):
        matrix = [[1] * 24 for _ in range(7)]
        matrix[3][5] = -1
        response = self.client.post("/api/v1/schedules/solve", json=self._solve_body(demand_matrix=matrix))
        self.assertEqual(response.status_code, 422)

    def test_preferred_start_outside_window_is_rejected(self):
        response = self.client.post(
            "/api/v1/schedules/solve",
            json=self._solve_body(templates=[_template(preferred_start=20)]),
        )
        self.assertEqual(response.status_code, 422)

    def test_min_duration_above_max_is_rejected(self):
        response = self.client.post(
            "/api/v1/schedules/solve",
            json=self._solve_body(templates=[_template(min_duration=9, max_duration=7)]),
        )
        self.assertEqual(response.status_code, 422)

    def test_pos_upload_to_missing_facility_returns_404(self):
        response = self.client.post(
            "/api/pos/upload-csv",
            params={"facility_id": "FAC-NOPE-99"},
            files={"file": ("sales.csv", io.BytesIO(b"amount,day_of_week,hour_of_day\n10,0,9\n"), "text/csv")},
        )
        self.assertEqual(response.status_code, 404)

    def test_pos_upload_over_size_limit_returns_413(self):
        big = b"amount,day_of_week,hour_of_day\n" + b"10,0,9\n" * 200_000
        response = self.client.post(
            "/api/pos/upload-csv",
            params={"facility_id": FACILITY_ID},
            files={"file": ("sales.csv", io.BytesIO(big), "text/csv")},
        )
        self.assertEqual(response.status_code, 413)

    def test_pos_open_hour_must_precede_close_hour(self):
        response = self.client.post(
            "/api/pos/upload-csv",
            params={"facility_id": FACILITY_ID, "open_hour": 12, "close_hour": 6},
            files={"file": ("sales.csv", io.BytesIO(b"amount,day_of_week,hour_of_day\n10,0,9\n"), "text/csv")},
        )
        self.assertEqual(response.status_code, 422)

    def test_payroll_for_missing_facility_returns_404(self):
        response = self.client.get("/api/payroll/export/gusto", params={"facility_id": "FAC-NOPE-99"})
        self.assertEqual(response.status_code, 404)

    def test_payroll_without_staff_returns_409(self):
        response = self.client.get("/api/payroll/export/adp", params={"facility_id": FACILITY_ID})
        self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
