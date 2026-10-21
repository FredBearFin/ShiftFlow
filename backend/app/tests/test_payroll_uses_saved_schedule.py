"""The payroll export describes the saved schedule, not a projection from hardcoded defaults.

Both payroll routes used to call _get_default_templates() and re-solve from
scratch, so the CSV priced a facility against three built-in 8-hour shifts
whatever shifts it had actually stored, and ignored any saved roster entirely.
"""

import csv
import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.database import init_db, get_db_connection, ShiftFlowRepository
from app.main import app

FACILITY_ID = "FAC-D3-TEST"
SNAPSHOT_FACILITY_ID = "FAC-D3-SNAP"

# Includes an overnight shift, which no built-in default template covers, so a
# solve over these is not the same solve as one over _get_default_templates().
STORED_TEMPLATES = [
    {
        "code": "M",
        "name": "Opening — 6a-2p (M)",
        "earliest_start": 5,
        "latest_end": 15,
        "min_duration": 8,
        "max_duration": 8,
        "preferred_start": 6,
        "preferred_duration": 8,
        "enabled": True,
    },
    {
        "code": "N",
        "name": "Overnight — 10p-6a (N)",
        "earliest_start": 21,
        "latest_end": 31,
        "min_duration": 8,
        "max_duration": 8,
        "preferred_start": 22,
        "preferred_duration": 8,
        "enabled": True,
    },
]


def _employee(emp_id: str, name: str, wage, line: int):
    return {
        "id": emp_id,
        "facility_id": FACILITY_ID,
        "name": name,
        "role": "Cashier",
        "wage": wage,
        "active": True,
        "available_days": [0, 1, 2, 3, 4, 5, 6],
        "assigned_line": line,
        "accommodation_type": "none",
        "statutory_notes": None,
    }


STAFF = [
    _employee("EMP-D3-1", "Dana Reyes", 19.0, 1),
    _employee("EMP-D3-2", "Sam Okafor", 21.0, 2),
]


def _rows(csv_text: str):
    return list(csv.DictReader(io.StringIO(csv_text)))


class PayrollUsesStoredScheduleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        conn = get_db_connection()
        try:
            repo = ShiftFlowRepository(conn)
            repo.upsert_facility(
                facility_id=FACILITY_ID,
                name="D3 Stored Templates",
                location="Test Location",
                operating_hours="00:00-24:00",
                demand_matrix=[[2] * 24 for _ in range(7)],
                shift_templates=STORED_TEMPLATES,
            )
            repo.upsert_facility(
                facility_id=SNAPSHOT_FACILITY_ID,
                name="D3 Saved Roster",
                location="Test Location",
                operating_hours="00:00-24:00",
                demand_matrix=[[2] * 24 for _ in range(7)],
                shift_templates=STORED_TEMPLATES,
            )
            repo.save_roster_snapshot(
                SNAPSHOT_FACILITY_ID,
                week_number=1,
                rotation_offset=0,
                schedule_data={
                    "roster_lines": [
                        {
                            "line_number": 1,
                            "assigned_employee_id": "EMP-D3-1",
                            "assigned_person": "Dana Reyes",
                            "qualification_tier": "Cashier",
                            "regular_hours": 33.5,
                            "overtime_hours": 2.5,
                            "hourly_wage": 19.0,
                            "estimated_weekly_payroll": 707.75,
                        },
                        # A line the manager left empty in the saved roster.
                        {
                            "line_number": 2,
                            "assigned_employee_id": None,
                            "assigned_person": None,
                            "qualification_tier": "Union Line Standard",
                            "regular_hours": 30.0,
                            "overtime_hours": 0.0,
                            "hourly_wage": None,
                            "estimated_weekly_payroll": None,
                        },
                    ]
                },
            )
        finally:
            conn.close()
        cls.client = TestClient(app)

    def _get(self, path, facility_id):
        with patch.object(ShiftFlowRepository, "list_employees", return_value=STAFF):
            return self.client.get(path, params={"facility_id": facility_id})

    def test_gusto_export_uses_the_saved_roster_when_there_is_one(self):
        """The figures come from the saved snapshot, not from a fresh solve."""
        resp = self._get("/api/payroll/export/gusto", SNAPSHOT_FACILITY_ID)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["X-Payroll-Source"], "saved-roster-snapshot")
        rows = _rows(resp.text)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["Employee Name"], "Dana Reyes")
        # 33.50 / 2.50 exist only in the snapshot; a re-solve produces whole-shift hours.
        self.assertEqual(rows[0]["Regular Hours"], "33.50")
        self.assertEqual(rows[0]["Overtime Hours"], "2.50")

    def test_adp_export_uses_the_same_saved_roster(self):
        """Both routes share one builder, so both read the snapshot."""
        resp = self._get("/api/payroll/export/adp", SNAPSHOT_FACILITY_ID)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["X-Payroll-Source"], "saved-roster-snapshot")
        rows = _rows(resp.text)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["Employee Name"], "Dana Reyes")
        self.assertEqual(rows[0]["Reg Hours"], "33.50")

    def test_no_exported_row_carries_hours_without_an_employee(self):
        """The saved roster's empty line is dropped, not exported as 'Associate 2'."""
        for path, name_col, hours_cols in (
            ("/api/payroll/export/gusto", "Employee Name", ("Regular Hours", "Overtime Hours")),
            ("/api/payroll/export/adp", "Employee Name", ("Reg Hours", "O/T Hours")),
        ):
            with self.subTest(path=path):
                resp = self._get(path, SNAPSHOT_FACILITY_ID)
                text = resp.text
                self.assertNotIn("Associate 2", text)
                self.assertNotIn("Shift Pattern 2", text)
                self.assertNotIn("Union Line Standard", text)
                for row in _rows(text):
                    if any(float(row[c] or 0) > 0 for c in hours_cols):
                        self.assertTrue(row[name_col].strip(), f"hours with no employee in {path}")

    def test_export_without_a_snapshot_uses_the_facilitys_stored_templates(self):
        """No saved roster: the solve runs over stored templates, and says so."""
        resp = self._get("/api/payroll/export/gusto", FACILITY_ID)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["X-Payroll-Source"], "resolved-from-stored-templates")
        self.assertIn("Projection, not hours worked", resp.headers["X-Payroll-Basis"])

    def test_every_export_admits_it_is_a_projection(self):
        """No timecard data is stored, so no export may imply hours worked."""
        for facility in (FACILITY_ID, SNAPSHOT_FACILITY_ID):
            for path in ("/api/payroll/export/gusto", "/api/payroll/export/adp"):
                with self.subTest(facility=facility, path=path):
                    resp = self._get(path, facility)
                    self.assertIn("not hours worked", resp.headers["X-Payroll-Basis"])

    def test_a_snapshot_from_another_account_is_not_visible(self):
        """get_latest_roster_snapshot is owner-scoped like every other read."""
        conn = get_db_connection()
        try:
            owner = ShiftFlowRepository(conn, owner_id="USER-D3-OWNER")
            other = ShiftFlowRepository(conn, owner_id="USER-D3-OTHER")
            owner.upsert_facility(
                facility_id="FAC-SHARED-ID",
                name="Owner facility",
                location="L",
                operating_hours="00:00-24:00",
                demand_matrix=[[2] * 24 for _ in range(7)],
                shift_templates=STORED_TEMPLATES,
            )
            owner.save_roster_snapshot("FAC-SHARED-ID", 1, 0, {"roster_lines": []})
            self.assertIsNotNone(owner.get_latest_roster_snapshot("FAC-SHARED-ID"))
            self.assertIsNone(other.get_latest_roster_snapshot("FAC-SHARED-ID"))
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
