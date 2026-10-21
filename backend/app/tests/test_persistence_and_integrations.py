"""Comprehensive automated tests for database persistence, POS demand calibration, and payroll exports."""

import io
import json
import sqlite3
import unittest
from fastapi.testclient import TestClient


from app.database import init_db, get_db_connection, ShiftFlowRepository
from app.engine.pos_sync import POSDemandForecaster
from app.engine.payroll_export import PayrollExportEngine
from app.main import app


class TestPersistenceAndIntegrations(unittest.TestCase):
    """Test suite covering SQLite data layer, POS forecasting, and Gusto/ADP exports."""

    @classmethod
    def setUpClass(cls):
        init_db()
        conn = get_db_connection()
        try:
            ShiftFlowRepository(conn).upsert_facility(
                facility_id="FAC-TEST-01",
                name="Test Facility",
                location="Test Location",
                operating_hours="00:00-24:00",
                demand_matrix=[[1] * 24 for _ in range(7)],
                shift_templates=[],
            )
        finally:
            conn.close()
        cls.client = TestClient(app)

    def setUp(self):
        self.conn = get_db_connection()
        self.repo = ShiftFlowRepository(self.conn)
        self._purge("EMP-TEST-99")

    def tearDown(self):
        self.conn.close()

    def _purge(self, employee_id):
        """Test-only cleanup. Audits are retained by design, so the fixture removes its own rows directly."""
        self.conn.execute("DELETE FROM separation_audits WHERE employee_id = ?", (employee_id,))
        self.conn.commit()
        self.repo.delete_employee(employee_id)

    def test_01_facility_upsert_and_retrieval(self):
        """Verify facility creation, demand matrix persistence, and retrieval."""
        dummy_demand = [[1]*24 for _ in range(7)]
        dummy_templates = [{"code": "M", "name": "Morning", "start_hour": 6, "duration_hours": 8}]
        fac = self.repo.upsert_facility(
            facility_id="FAC-TEST-01",
            name="Test Smoke & Vape",
            location="Omaha, NE",
            operating_hours="09:00–21:00",
            demand_matrix=dummy_demand,
            shift_templates=dummy_templates,
        )
        self.assertIsNotNone(fac)
        self.assertEqual(fac["id"], "FAC-TEST-01")
        self.assertEqual(fac["name"], "Test Smoke & Vape")
        self.assertEqual(len(fac["demand_matrix"]), 7)
        self.assertEqual(len(fac["demand_matrix"][0]), 24)

    def test_02_employee_crud_and_availability(self):
        """Verify full employee lifecycle: create, get, update availability/wage, and deactivate."""
        emp = self.repo.create_employee(
            facility_id="FAC-TEST-01",
            name="Taylor Swift",
            role="Keyholder",
            wage=18.50,
            available_days=[0, 1, 2, 3, 4],  # Mon-Fri
            assigned_line=1,
            employee_id="EMP-TEST-99",
        )
        self.assertEqual(emp["name"], "Taylor Swift")
        self.assertEqual(emp["wage"], 18.50)
        self.assertEqual(emp["available_days"], [0, 1, 2, 3, 4])
        self.assertTrue(emp["active"])

        # Update wage and role
        updated = self.repo.update_employee(
            employee_id="EMP-TEST-99",
            wage=20.00,
            role="Store Manager",
            available_days=[1, 2, 3, 4, 5],
        )
        self.assertEqual(updated["wage"], 20.00)
        self.assertEqual(updated["role"], "Store Manager")
        self.assertEqual(updated["available_days"], [1, 2, 3, 4, 5])

        # Deactivate / fire
        deactivated = self.repo.deactivate_employee(
            "EMP-TEST-99",
            separation_category="mutual_agreement",
            separation_reason="Agreed end of contract",
            recorded_by="Store Manager",
        )
        self.assertFalse(deactivated["active"])
        self.assertIsNone(deactivated["assigned_line"])
        self.assertEqual(deactivated["separation_category"], "mutual_agreement")
        self.assertEqual(deactivated["recorded_by"], "Store Manager")

        # Repeated deactivate does not add a second audit row
        self.repo.deactivate_employee(
            "EMP-TEST-99",
            separation_category="voluntary_resignation",
            separation_reason="Repeat deactivation attempt in test scenario",
            recorded_by="Test Manager",
        )
        audits = self.repo.list_separation_audits(facility_id="FAC-TEST-01")
        self.assertEqual(len([a for a in audits if a["employee_id"] == "EMP-TEST-99"]), 1)

        # Clean up (audit rows are retained, so the test removes them directly)
        self._purge("EMP-TEST-99")

    def test_03_pos_csv_parsing_and_demand_projection(self):
        """Verify POS transaction ingestion and hourly demand curve projection."""
        sample_csv = """Day,Hour,Total
0,8,$450.00
0,9,$680.00
0,12,$1250.00
0,13,$1400.00
0,18,$1100.00
4,18,$2200.00
5,19,$2600.00
"""
        forecaster = POSDemandForecaster(sales_per_staff_hour=250.0, min_staff_open=1, max_staff_cap=6)
        records = forecaster.parse_pos_csv(sample_csv)
        self.assertEqual(len(records), 7)

        demand_matrix, summary = forecaster.calculate_demand_matrix(records, open_hour=6, close_hour=22)
        self.assertEqual(len(demand_matrix), 7)
        self.assertEqual(len(demand_matrix[0]), 24)
        
        # Hours outside 6-22 should be 0
        self.assertEqual(demand_matrix[0][2], 0)
        self.assertEqual(demand_matrix[0][23], 0)

        # Friday 18:00 ($2200) should demand high register staffing
        self.assertGreaterEqual(demand_matrix[4][18], 5)

        # Summary check
        self.assertGreater(summary["total_weekly_sales"], 9000.0)
        self.assertEqual(summary["total_weekly_transactions"], 7)

    def test_04_payroll_export_csv_generation(self):
        """Verify Gusto and ADP CSV generators produce valid standard headers and calculations."""
        mock_roster_lines = [
            {
                "line_number": 1,
                "assigned_employee_id": "EMP-01",
                "assigned_person": "Devon Taylor",
                "qualification_tier": "Lead Clerk",
                "regular_hours": 40,
                "overtime_hours": 5,
                "hourly_wage": 18.00,
                "estimated_weekly_payroll": 40 * 18.00 + 5 * 18.00 * 1.5,
            },
            {
                "line_number": 2,
                "assigned_employee_id": "EMP-02",
                "assigned_person": "Sarah Kowalski",
                "qualification_tier": "Associate",
                "regular_hours": 32,
                "overtime_hours": 0,
                "hourly_wage": 16.50,
                "estimated_weekly_payroll": 32 * 16.50,
            },
        ]

        gusto_csv = PayrollExportEngine.export_gusto_csv(mock_roster_lines)
        lines = gusto_csv.strip().split("\n")
        self.assertEqual(len(lines), 3)
        self.assertIn("Regular Hours,Overtime Hours,Hourly Wage,Gross Pay ($)", lines[0])
        self.assertIn("Devon Taylor,Lead Clerk,40.00,5.00,18.00,855.00", lines[1])

        adp_csv = PayrollExportEngine.export_adp_workforce_csv(mock_roster_lines)
        adp_lines = adp_csv.strip().split("\n")
        self.assertEqual(len(adp_lines), 3)
        self.assertIn("Co Code,Batch ID,File #,Employee Name", adp_lines[0])
        self.assertIn("EMP-01,Devon Taylor,40.00,5.00,18.00,REG,855.00", adp_lines[1])

    def test_05_fastapi_rest_endpoints(self):
        """Verify all new REST API endpoints respond with status code 200."""
        # 1. Employees list
        resp = self.client.get("/api/employees?facility_id=FAC-TEST-01")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

        # 2. Add employee via POST
        post_resp = self.client.post(
            "/api/employees",
            json={
                "facility_id": "FAC-TEST-01",
                "name": "Integration Tester",
                "role": "Temp Clerk",
                "wage": 17.25,
                "available_days": [0, 1, 2, 3],
            },
        )
        self.assertEqual(post_resp.status_code, 200)
        created_id = post_resp.json()["id"]

        # 3. Deactivate employee with separation payload; it must be stored as an audit row
        deact_resp = self.client.post(
            f"/api/employees/{created_id}/deactivate",
            json={
                "separation_category": "layoff_reduction",
                "separation_reason": "Workforce reduction, role eliminated",
                "recorded_by": "Store General Manager",
            },
        )
        self.assertEqual(deact_resp.status_code, 200)
        self.assertFalse(deact_resp.json()["employee"]["active"])
        self.assertEqual(deact_resp.json()["employee"]["separation_category"], "layoff_reduction")
        audits = self.repo.list_separation_audits(facility_id="FAC-TEST-01")
        matching = [a for a in audits if a["employee_id"] == created_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["recorded_by"], "Store General Manager")

        # Repeated deactivate over REST does not duplicate the audit row
        again_resp = self.client.post(f"/api/employees/{created_id}/deactivate", json={
                "separation_category": "voluntary_resignation",
                "separation_reason": "Repeat deactivation attempt in test scenario",
                "recorded_by": "Test Manager",
            })
        self.assertEqual(again_resp.status_code, 200)

        audits = self.repo.list_separation_audits(facility_id="FAC-TEST-01")
        self.assertEqual(len([a for a in audits if a["employee_id"] == created_id]), 1)

        # 4. Delete is refused with 409 and the audit rows are kept
        del_resp = self.client.delete(f"/api/employees/{created_id}")
        self.assertEqual(del_resp.status_code, 409)
        self.assertIsNotNone(self.repo.get_employee(created_id))
        audits = self.repo.list_separation_audits(facility_id="FAC-TEST-01")
        self.assertEqual(len([a for a in audits if a["employee_id"] == created_id]), 1)

        # Test-only cleanup of the fixture
        self._purge(created_id)

        # 5. Gusto and ADP exports. With no active staff the export is refused.
        empty_resp = self.client.get("/api/payroll/export/gusto?facility_id=FAC-TEST-01")
        self.assertEqual(empty_resp.status_code, 409)
        staff_resp = self.client.post(
            "/api/employees",
            json={"facility_id": "FAC-TEST-01", "name": "Export Tester", "role": "Clerk", "wage": 17.25,
                  "available_days": [0, 1, 2, 3]},
        )
        self.assertEqual(staff_resp.status_code, 200)
        export_staff_id = staff_resp.json()["id"]

        g_resp = self.client.get("/api/payroll/export/gusto?facility_id=FAC-TEST-01")
        self.assertEqual(g_resp.status_code, 200)
        self.assertIn("Regular Hours", g_resp.text)

        a_resp = self.client.get("/api/payroll/export/adp?facility_id=FAC-TEST-01")
        self.assertEqual(a_resp.status_code, 200)
        self.assertIn("Co Code", a_resp.text)
        self._purge(export_staff_id)

        # 6. POS CSV Upload
        dummy_pos_csv = b"Day,Hour,Total\n0,8,$450.00\n0,12,$1200.00\n"
        pos_resp = self.client.post(
            "/api/pos/upload-csv?facility_id=FAC-TEST-01",
            files={"file": ("pos.csv", dummy_pos_csv, "text/csv")},
        )
        self.assertEqual(pos_resp.status_code, 200)
        self.assertEqual(pos_resp.json()["status"], "success")
        self.assertEqual(pos_resp.json()["records_parsed"], 2)

    def test_06_add_employee_with_no_prior_facility_row(self):
        """A brand-new install has no facilities row until POS data is uploaded - nothing in the
        app exposes an explicit "create a facility" step, so adding staff must not depend on it.
        """
        facility_id = "FAC-NEVER-UPSERTED-01"
        self.assertIsNone(self.repo.get_facility(facility_id))
        resp = self.client.post(
            "/api/employees",
            json={"facility_id": facility_id, "name": "Day One Hire", "role": "Cook", "wage": 16.0},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(self.repo.get_facility(facility_id))
        self._purge(resp.json()["id"])


if __name__ == "__main__":
    unittest.main()
