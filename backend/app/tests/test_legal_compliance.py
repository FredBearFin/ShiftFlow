"""Automated tests for legal compliance, Title VII/ADA accommodations, and separation audits."""

import unittest
from app.database import init_db, get_db_connection, ShiftFlowRepository, SeparationAuditExistsError
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.schemas import (
    EmployeeRecord,
    ShiftTemplateSchema,
    SolveRequestSchema,
)


class TestLegalComplianceAndAccommodations(unittest.TestCase):
    """Test suite verifying statutory safe harbors and legal guardrails."""

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

    def setUp(self):
        self.conn = get_db_connection()
        self.repo = ShiftFlowRepository(self.conn)
        self._purge("EMP-LEGAL-01")

    def tearDown(self):
        self._purge("EMP-LEGAL-01")
        self.conn.close()

    def _purge(self, employee_id):
        """Test-only cleanup. Audits are retained by design, so the fixture removes its own rows directly."""
        self.conn.execute("DELETE FROM separation_audits WHERE employee_id = ?", (employee_id,))
        self.conn.commit()
        self.repo.delete_employee(employee_id)

    def test_01_title_vii_religious_sabbath_accommodation_flag(self):
        """Verify Title VII Sabbath observance triggers statutory accommodation violation if line conflicts."""
        templates = [
            ShiftTemplateSchema(code="M", name="Morning", earliest_start=6, latest_end=14, preferred_start=6, preferred_duration=8),
            ShiftTemplateSchema(code="E", name="Closing", earliest_start=16, latest_end=24, preferred_start=16, preferred_duration=8),
        ]
        # Demand every day
        demand = [[2]*24 for _ in range(7)]

        # Employee with religious Sabbath accommodation: Unavailable on Friday (4) and Saturday (5)
        sabbath_emp = EmployeeRecord(
            employee_id="EMP-SABBATH-01",
            name="David Stern",
            role="Clerk",
            hourly_wage=17.50,
            is_active=True,
            available_days=[0, 1, 2, 3, 6],  # Mon, Tue, Wed, Thu, Sun (Fri & Sat OFF)
            accommodation_type="religious",
            statutory_notes="Sabbath: Friday sundown to Saturday sundown approved per Title VII",
            assigned_line_id=1,
        )

        req = SolveRequestSchema(
            demand_matrix=demand,
            templates=templates,
            employees=[sabbath_emp],
        )

        sol = ISDRWSPSolver(req).solve()
        self.assertIsNotNone(sol)
        self.assertEqual(sol.instance_name, req.facility_name)

        # Check line 1 (assigned to David Stern)
        line_1 = sol.roster_lines[0]
        self.assertEqual(line_1.assigned_employee_id, "EMP-SABBATH-01")

        # If line 1 operates on Friday or Saturday, statutory_accommodation_violation must be True
        works_fri_or_sat = any(c.shift_code != "OFF" for c in line_1.days if c.day_index in (4, 5))
        if works_fri_or_sat:
            self.assertTrue(line_1.statutory_accommodation_violation)
            statutory_conflicts = [c for c in line_1.days if c.statutory_accommodation_conflict]
            self.assertGreater(len(statutory_conflicts), 0)

        # The ergonomics count is computed from the solved lines, not fixed at zero.
        expected_count = sum(1 for line in sol.roster_lines if line.statutory_accommodation_violation)
        self.assertEqual(sol.ergonomics_audit.statutory_accommodation_violations_count, expected_count)

    def test_02_contemporaneous_separation_audit_logging(self):
        """Verify employee deactivation logs an immutable contemporaneous audit record for retaliation defense."""
        emp = self.repo.create_employee(
            facility_id="FAC-TEST-01",
            name="Marcus Jones",
            role="Register Clerk",
            wage=16.50,
            available_days=[0, 1, 2, 3, 4, 5, 6],
            employee_id="EMP-LEGAL-01",
            accommodation_type="none",
        )
        self.assertTrue(emp["active"])

        # Execute structured deactivation with contemporaneous legal documentation
        deactivated = self.repo.deactivate_employee(
            employee_id="EMP-LEGAL-01",
            separation_category="involuntary_for_cause",
            separation_reason="Repeated unexcused register drawer shortages documented on 2026-10-15 and 2026-10-18",
            recorded_by="Store General Manager Marcus Vance",
        )
        self.assertFalse(deactivated["active"])
        self.assertEqual(deactivated["separation_category"], "involuntary_for_cause")
        self.assertIn("drawer shortages", deactivated["separation_reason"])

        # Query separation audits table to ensure contemporaneous proof exists
        audits = self.repo.list_separation_audits(facility_id="FAC-TEST-01")
        matching = [a for a in audits if a["employee_id"] == "EMP-LEGAL-01"]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["separation_category"], "involuntary_for_cause")
        self.assertEqual(matching[0]["recorded_by"], "Store General Manager Marcus Vance")
        self.assertIsNotNone(matching[0]["timestamp"])

        # Repeated deactivation is idempotent: no second audit row, first record kept.
        again = self.repo.deactivate_employee(
            employee_id="EMP-LEGAL-01",
            separation_category="layoff_reduction",
            separation_reason="Second attempt",
            recorded_by="Someone Else",
        )
        self.assertFalse(again["active"])
        self.assertEqual(again["separation_category"], "involuntary_for_cause")
        audits = self.repo.list_separation_audits(facility_id="FAC-TEST-01")
        self.assertEqual(len([a for a in audits if a["employee_id"] == "EMP-LEGAL-01"]), 1)

    def test_02b_delete_refused_while_separation_audits_exist(self):
        """Verify delete raises and keeps the separation audit rows when audits exist."""
        self.repo.create_employee(
            facility_id="FAC-TEST-01",
            name="Marcus Jones",
            role="Register Clerk",
            wage=16.50,
            available_days=[0, 1, 2, 3, 4, 5, 6],
            employee_id="EMP-LEGAL-01",
            accommodation_type="none",
        )
        self.repo.deactivate_employee(
            employee_id="EMP-LEGAL-01",
            separation_category="voluntary_resignation",
            separation_reason="Deactivation set up for delete-refusal test scenario",
            recorded_by="Test Manager",
        )

        with self.assertRaises(SeparationAuditExistsError):
            self.repo.delete_employee("EMP-LEGAL-01")

        self.assertIsNotNone(self.repo.get_employee("EMP-LEGAL-01"))
        audits = self.repo.list_separation_audits(facility_id="FAC-TEST-01")
        self.assertEqual(len([a for a in audits if a["employee_id"] == "EMP-LEGAL-01"]), 1)

    def test_03_fair_workweek_16h_mandatory_rest_safe_harbor(self):
        """Verify solver produces 0 clopening violations, satisfying Fair Workweek mandatory rest interval."""
        templates = [
            ShiftTemplateSchema(code="M", name="Opening Shift — 6a-2p (M)", earliest_start=6, latest_end=14, preferred_start=6, preferred_duration=8),
            ShiftTemplateSchema(code="D", name="Midday Rush — 11a-7p (D)", earliest_start=11, latest_end=19, preferred_start=11, preferred_duration=8),
            ShiftTemplateSchema(code="E", name="Closing Shift — 4p-12a (E)", earliest_start=16, latest_end=24, preferred_start=16, preferred_duration=8),
        ]
        demand = [[3]*24 for _ in range(7)]
        req = SolveRequestSchema(demand_matrix=demand, templates=templates)

        sol = ISDRWSPSolver(req).solve()
        self.assertEqual(sol.ergonomics_audit.clopening_violations, 0)
        self.assertTrue(sol.ergonomics_audit.fair_workweek_compliant)
        self.assertGreaterEqual(sol.ergonomics_audit.min_rest_hours_observed, 16.0)


if __name__ == "__main__":
    unittest.main()
