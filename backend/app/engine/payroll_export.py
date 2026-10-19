"""Payroll export formatting engine for Gusto, ADP, and standard CSV integrations."""

import csv
import io
from typing import Any, Dict, List


class PayrollExportEngine:
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

        for line in roster_lines:
            line_num = line.get("line_number") or line.get("lineNum") or 1
            emp_id = line.get("assigned_employee_id") or line.get("empId") or f"LINE-{line_num:02d}"
            name = line.get("assigned_person") or line.get("empName") or f"Rotation Line {line_num}"
            role = line.get("qualification_tier") or line.get("role") or "Floor Clerk"
            reg = round(float(line.get("regular_hours", line.get("regHours", 0.0))), 2)
            ot = round(float(line.get("overtime_hours", line.get("otHours", 0.0))), 2)
            wage = round(float(line.get("hourly_wage", line.get("wage", 16.50))), 2)
            gross = round(float(line.get("estimated_weekly_payroll", line.get("weeklyPay", 0.0))), 2)

            writer.writerow([
                emp_id,
                name,
                role,
                f"{reg:.2f}",
                f"{ot:.2f}",
                f"{wage:.2f}",
                f"{gross:.2f}",
                f"ShiftFlow Cyclic Line {line_num}",
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

        for line in roster_lines:
            line_num = line.get("line_number") or line.get("lineNum") or 1
            emp_id = line.get("assigned_employee_id") or line.get("empId") or f"L{line_num:02d}"
            name = line.get("assigned_person") or line.get("empName") or f"Associate {line_num}"
            reg = round(float(line.get("regular_hours", line.get("regHours", 0.0))), 2)
            ot = round(float(line.get("overtime_hours", line.get("otHours", 0.0))), 2)
            wage = round(float(line.get("hourly_wage", line.get("wage", 16.50))), 2)
            gross = round(float(line.get("estimated_weekly_payroll", line.get("weeklyPay", 0.0))), 2)

            writer.writerow([
                company_code,
                batch_id,
                emp_id,
                name,
                f"{reg:.2f}",
                f"{ot:.2f}",
                f"{wage:.2f}",
                "REG",
                f"{gross:.2f}",
            ])

        return output.getvalue()
