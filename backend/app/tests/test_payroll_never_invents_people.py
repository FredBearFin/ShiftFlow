"""A rotation line with nobody on it must never leave the payroll engine as a person.

Both builders used to fall back to "Shift Pattern 3" / "Associate 3" with a role of
"Floor Clerk" when a line had no assignee. In a payroll file that is indistinguishable
from a real employee owed real money. An unassigned line is a coverage gap to report,
not a paycheck to issue.
"""

import unittest

from app.engine.payroll_export import PayrollExportEngine

STAFFED = {
    "line_number": 1,
    "assigned_employee_id": "EMP-REAL",
    "assigned_person": "Real Person",
    "qualification_tier": "Clerk",
    "regular_hours": 30.0,
    "overtime_hours": 0.0,
    "hourly_wage": 18.0,
    "estimated_weekly_payroll": 540.0,
}
UNSTAFFED = {
    "line_number": 2,
    "assigned_employee_id": None,
    "assigned_person": None,
    "regular_hours": 30.0,
    "overtime_hours": 0.0,
    "hourly_wage": None,
    "estimated_weekly_payroll": None,
}

INVENTED = ("Associate 2", "Shift Pattern 2", "Floor Clerk", "PATTERN-02", "L02")


class PayrollNeverInventsPeopleTests(unittest.TestCase):
    def _builders(self):
        return (
            ("gusto", PayrollExportEngine.export_gusto_csv),
            ("adp", PayrollExportEngine.export_adp_workforce_csv),
        )

    def test_unassigned_line_is_not_exported_as_a_person(self):
        for name, build in self._builders():
            with self.subTest(builder=name):
                csv_text = build([STAFFED, UNSTAFFED])
                rows = [r for r in csv_text.strip().split("\n")[1:] if r.strip()]
                self.assertEqual(len(rows), 1, f"{name} exported the unassigned line")
                self.assertIn("Real Person", csv_text)

    def test_no_identity_is_fabricated_for_an_unassigned_line(self):
        for name, build in self._builders():
            with self.subTest(builder=name):
                csv_text = build([STAFFED, UNSTAFFED])
                for token in INVENTED:
                    self.assertNotIn(token, csv_text, f"{name} invented {token!r}")

    def test_a_roster_with_nobody_on_it_exports_no_pay_rows(self):
        for name, build in self._builders():
            with self.subTest(builder=name):
                csv_text = build([UNSTAFFED])
                rows = [r for r in csv_text.strip().split("\n")[1:] if r.strip()]
                self.assertEqual(rows, [], f"{name} produced pay rows for an empty roster")


if __name__ == "__main__":
    unittest.main()
