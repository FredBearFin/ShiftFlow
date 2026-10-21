"""Payroll export formatting engine for Gusto, ADP, and standard CSV integrations."""

import csv
import io
from typing import Any, Dict, List


class PayrollExportEngine:
    """Builds payroll CSVs from solved roster lines.

    A rotation line with nobody assigned is not a person and is never invented into
    one. These builders used to fall back to "Shift Pattern 3" / "Associate 3" with a
    role of "Floor Clerk", which lands in a payroll file looking exactly like a real
    employee owed real money. An unassigned line is skipped instead, and the caller is
    told how many were skipped so a coverage gap is reported rather than paid.
    """
    """Formats calculated labor records into standard payroll provider ingestion formats."""

    @staticmethod
    def export_gusto_csv(
        roster_lines: List[Dict[str, Any]],
        company_name: str = "Downtown Foodmart",
    ) -> str:
        """Generates Gusto-formatted payroll CSV for 1-click import."""
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")

        # Standard Gusto Import Header
        writer.writerow([
            "Employee ID",
            "Employee Name",
            "Role",
            "Regular Hours",
            "Overtime Hours",
            "Hourly Wage",
            "Gross Pay ($)",
            "Notes",
        ])

        skipped: List[int] = []
        for line in roster_lines:
            line_num = line.get("line_number") or line.get("lineNum") or 1
            emp_id = line.get("assigned_employee_id") or line.get("empId")
            name = line.get("assigned_person") or line.get("empName")
            if not emp_id or not name:
                # Nobody is on this line. Skipping it is the whole point: see the class docstring.
                skipped.append(line_num)
                continue
            role = line.get("qualification_tier") or line.get("role") or ""
            reg = round(float(line.get("regular_hours", line.get("regHours", 0.0))), 2)
            ot = round(float(line.get("overtime_hours", line.get("otHours", 0.0))), 2)
            wage_raw = line.get("hourly_wage", line.get("wage"))
            gross_raw = line.get("estimated_weekly_payroll", line.get("weeklyPay"))
            wage = "" if wage_raw is None else f"{round(float(wage_raw), 2):.2f}"
            gross = "" if gross_raw is None else f"{round(float(gross_raw), 2):.2f}"

            writer.writerow([
                emp_id,
                name,
                role,
                f"{reg:.2f}",
                f"{ot:.2f}",
                wage,
                gross,
                f"ShiftFlow Pattern {line_num}",
            ])

        return output.getvalue()

    @staticmethod
    def export_adp_workforce_csv(
        roster_lines: List[Dict[str, Any]],
        company_code: str = "SF99",
        batch_id: str = "WEEKLY_01",
    ) -> str:
        """Generates ADP Workforce Now-formatted payroll import CSV."""
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")

        # ADP Standard Batch Header
        writer.writerow([
            "Co Code",
            "Batch ID",
            "File #",
            "Employee Name",
            "Reg Hours",
            "O/T Hours",
            "Hourly Rate",
            "Shift Pay Code",
            "Gross Amount",
        ])

        skipped: List[int] = []
        for line in roster_lines:
            line_num = line.get("line_number") or line.get("lineNum") or 1
            emp_id = line.get("assigned_employee_id") or line.get("empId")
            name = line.get("assigned_person") or line.get("empName")
            if not emp_id or not name:
                # Nobody is on this line. Skipping it is the whole point: see the class docstring.
                skipped.append(line_num)
                continue
            reg = round(float(line.get("regular_hours", line.get("regHours", 0.0))), 2)
            ot = round(float(line.get("overtime_hours", line.get("otHours", 0.0))), 2)
            wage_raw = line.get("hourly_wage", line.get("wage"))
            gross_raw = line.get("estimated_weekly_payroll", line.get("weeklyPay"))
            wage = "" if wage_raw is None else f"{round(float(wage_raw), 2):.2f}"
            gross = "" if gross_raw is None else f"{round(float(gross_raw), 2):.2f}"

            writer.writerow([
                company_code,
                batch_id,
                emp_id,
                name,
                f"{reg:.2f}",
                f"{ot:.2f}",
                wage,
                "REG",
                gross,
            ])

        return output.getvalue()
