"""Payroll export excludes staff with a null stored wage and names them in X-Excluded-Staff."""

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient


from app.config import settings
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
        # POS integration is off by default outside V1; this test suite explicitly
        # turns it on so the real routes (not a 404) are exercised.
        cls._enable_pos_integration_was = settings.enable_pos_integration
        settings.enable_pos_integration = True

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
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        settings.enable_pos_integration = cls._enable_pos_integration_was

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

    def test_02_gusto_export_neutralizes_a_formula_shaped_employee_name_and_role(self):
        """A name/role starting with '=', '+', '-' or '@' is written '-prefixed, never as a live formula cell."""
        row = _employee("EMP-PR33-FORMULA", '=HYPERLINK("http://evil.example/leak","click")', 15.0)
        row["role"] = "+1;@SUM(A1:A99)"
        with patch.object(ShiftFlowRepository, "list_employees", return_value=[row]):
            resp = self.client.get("/api/payroll/export/gusto", params={"facility_id": FACILITY_ID})

        self.assertEqual(resp.status_code, 200)
        # The raw CSV bytes must never contain a cell that starts with a formula trigger:
        # every line that mentions this employee's data should instead carry the
        # guarded, single-quote-prefixed text.
        self.assertIn('"\'=HYPERLINK', resp.text)
        self.assertIn("'+1;@SUM(A1:A99)", resp.text)
        self.assertNotIn(',=HYPERLINK', resp.text)
        self.assertNotIn(",+1;@SUM", resp.text)

    def test_03_adp_export_neutralizes_a_formula_shaped_employee_name(self):
        """The ADP export applies the same formula guard to the employee name column."""
        row = _employee("EMP-PR33-FORMULA2", "@SUM(1+1)*cmd|'/c calc'!A0", 15.0)
        with patch.object(ShiftFlowRepository, "list_employees", return_value=[row]):
            resp = self.client.get("/api/payroll/export/adp", params={"facility_id": FACILITY_ID})

        self.assertEqual(resp.status_code, 200)
        self.assertIn("'@SUM(1+1)*cmd", resp.text)
        self.assertNotIn(",@SUM(1+1)", resp.text)


if __name__ == "__main__":
    unittest.main()
