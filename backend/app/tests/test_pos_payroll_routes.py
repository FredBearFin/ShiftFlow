"""Payroll export excludes staff with a null stored wage and names them in X-Excluded-Staff."""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.tests import TEST_HEADERS

from app.database import init_db, get_db_connection, ShiftFlowRepository
from app.main import app

FACILITY_ID = "FAC-PR33-TEST"


def _employee(emp_id: str, name: str, wage):
    return {
        "id": emp_id,
        "facility_id": FACILITY_ID,
        "name": name,
        "role": "Cashier",
        "wage": wage,
        "active": True,
        "available_days": [0, 1, 2, 3, 4, 5, 6],
        "assigned_line": 1,
        "accommodation_type": "none",
        "statutory_notes": None,
    }


class TestPayrollNullWageExclusion(unittest.TestCase):
    """A staff member with a null stored wage is left out of the solve and named in the header."""

    @classmethod
    def setUpClass(cls):
        init_db()
        conn = get_db_connection()
        try:
            ShiftFlowRepository(conn).upsert_facility(
                facility_id=FACILITY_ID,
                name="PR33 Test Facility",
                location="Test Location",
                operating_hours="00:00-24:00",
                demand_matrix=[[1] * 24 for _ in range(7)],
                shift_templates=[],
            )
        finally:
            conn.close()
        cls.client = TestClient(app, headers=TEST_HEADERS)

    def test_01_null_wage_staff_is_excluded_and_named_in_header(self):
        """The null-wage employee is left out of the Gusto export and named in X-Excluded-Staff."""
        rows = [
            _employee("EMP-PR33-PAID", "Paid Person", 17.25),
            _employee("EMP-PR33-NULL", "Null Wage Person", None),
        ]
        with patch.object(ShiftFlowRepository, "list_employees", return_value=rows):
            resp = self.client.get("/api/payroll/export/gusto", params={"facility_id": FACILITY_ID})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["X-Excluded-Staff"], "EMP-PR33-NULL")
        self.assertNotIn("Null Wage Person", resp.text)


if __name__ == "__main__":
    unittest.main()
