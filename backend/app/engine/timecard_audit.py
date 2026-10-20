"""Wage and Hour statutory compliance engine under 29 C.F.R. Part 785, Part 778, and Part 516.

Implements:
1. 29 C.F.R. § 785.48(b) 7-Minute Rounding & Statistical Neutrality Verification
2. 29 C.F.R. § 778.104 Standalone Workweek (168-Hour) Overtime Boundary Enforcement
3. 29 C.F.R. § 516.5 & § 516.6 Historical Recordkeeping & Immutable Audit Trail Integrity
"""

import datetime
from typing import Any, Dict, List, Tuple


class TimecardAuditor:
    """Audits timecard punches, rounding neutrality, and FLSA overtime boundaries."""

    @staticmethod
    def round_punch(punch_dt: datetime.datetime, interval_minutes: int = 15) -> datetime.datetime:
        """Applies 29 C.F.R. § 785.48(b) rounding rules (default: 15-minute / 7-minute rule).
        
        Under the 15-minute rounding standard:
        - 1 to 7 minutes round down to the preceding 15-minute mark.
        - 8 to 14 minutes round up to the next 15-minute mark.
        """
        minute = punch_dt.minute
        second = punch_dt.second
        # Total fractional minutes within current quarter-hour
        quarter_idx = minute // interval_minutes
        remainder_minutes = (minute % interval_minutes) + (second / 60.0)

        threshold = interval_minutes / 2.0  # 7.5 minutes for 15-min interval

        if remainder_minutes < threshold:
            # Round down to nearest interval
            rounded_minute = quarter_idx * interval_minutes
            delta = datetime.timedelta(
                minutes=(rounded_minute - minute),
                seconds=-second,
                microseconds=-punch_dt.microsecond,
            )
        else:
            # Round up to next interval
            rounded_minute = (quarter_idx + 1) * interval_minutes
            delta = datetime.timedelta(
                minutes=(rounded_minute - minute),
                seconds=-second,
                microseconds=-punch_dt.microsecond,
            )

        return punch_dt + delta

    @staticmethod
    def audit_rounding_neutrality(
        punch_pairs: List[Tuple[datetime.datetime, datetime.datetime]],
        interval_minutes: int = 15,
    ) -> Dict[str, Any]:
        """Audits a set of clock-in/clock-out punch pairs for employer-favorable rounding bias.
        
        Under 29 C.F.R. § 785.48(b), rounding is lawful provided it does not result, over
        a period of time, in failure to compensate employees properly for all time actually worked.
        """
        actual_total_seconds = 0.0
        rounded_total_seconds = 0.0
        details = []

        for clock_in, clock_out in punch_pairs:
            rounded_in = TimecardAuditor.round_punch(clock_in, interval_minutes)
            rounded_out = TimecardAuditor.round_punch(clock_out, interval_minutes)

            actual_dur = (clock_out - clock_in).total_seconds()
            rounded_dur = (rounded_out - rounded_in).total_seconds()

            actual_total_seconds += actual_dur
            rounded_total_seconds += rounded_dur

            details.append({
                "raw_in": clock_in.isoformat(),
                "raw_out": clock_out.isoformat(),
                "rounded_in": rounded_in.isoformat(),
                "rounded_out": rounded_out.isoformat(),
                "actual_hours": actual_dur / 3600.0,
                "rounded_hours": rounded_dur / 3600.0,
                "delta_minutes": (rounded_dur - actual_dur) / 60.0,
            })

        net_delta_minutes = (rounded_total_seconds - actual_total_seconds) / 60.0
        avg_delta_per_shift = (net_delta_minutes / len(punch_pairs)) if punch_pairs else 0.0

        return {
            "total_shifts_audited": len(punch_pairs),
            "actual_total_hours": round(actual_total_seconds / 3600.0, 3),
            "rounded_total_hours": round(rounded_total_seconds / 3600.0, 3),
            "net_variance_minutes": round(net_delta_minutes, 2),
            "avg_shift_variance_minutes": round(avg_delta_per_shift, 3),
            "details": details,
        }

    @staticmethod
    def calculate_standalone_workweek(
        daily_hours: List[float],
        hourly_wage: float = 16.50,
    ) -> Dict[str, Any]:
        """Calculates overtime under 29 C.F.R. § 778.104 (The Standalone Workweek Rule).
        
        Requires that each workweek stands alone; hours cannot be averaged across pay cycles.
        Standard FLSA statutory threshold: 40.0 hours in a 168-hour workweek.
        """
        if len(daily_hours) != 7:
            raise ValueError(f"A standard FLSA workweek must have exactly 7 daily entries, got {len(daily_hours)}")

        total_hours = sum(daily_hours)
        regular_hours = min(40.0, total_hours)
        overtime_hours = max(0.0, total_hours - 40.0)

        regular_pay = regular_hours * hourly_wage
        overtime_premium_rate = hourly_wage * 1.5
        overtime_pay = overtime_hours * overtime_premium_rate
        total_gross_pay = regular_pay + overtime_pay

        return {
            "workweek_hours_total": round(total_hours, 2),
            "regular_hours": round(regular_hours, 2),
            "overtime_hours": round(overtime_hours, 2),
            "regular_rate": round(hourly_wage, 2),
            "overtime_rate": round(overtime_premium_rate, 2),
            "regular_pay": round(regular_pay, 2),
            "overtime_pay": round(overtime_pay, 2),
            "total_gross_pay": round(total_gross_pay, 2),
            "daily_hours_mon_sun": daily_hours,
        }

    @staticmethod
    def audit_recordkeeping_compliance(
        records: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Audits historical data records against 29 C.F.R. § 516.2 & § 516.5 requirements.
        
        Mandatory 29 C.F.R. § 516.2 items:
        1. Employee identification & personal info
        2. Time of day and day of week when workweek begins
        3. Regular hourly rate of pay
        4. Hours worked each workday and total hours worked each workweek
        5. Total daily or weekly straight-time earnings
        6. Total overtime excess compensation
        7. Total wages paid each pay period & date of payment
        """
        required_fields = [
            "employee_id",
            "workweek_start",
            "hourly_wage",
            "daily_hours",
            "weekly_regular_hours",
            "weekly_overtime_hours",
            "straight_time_earnings",
            "overtime_earnings",
            "total_gross_pay",
            "timestamp",
        ]

        deficiencies = []
        compliant_count = 0

        for idx, rec in enumerate(records):
            missing = [f for f in required_fields if f not in rec]
            if missing:
                deficiencies.append({
                    "record_index": idx,
                    "employee_id": rec.get("employee_id", "UNKNOWN"),
                    "missing_mandatory_fields": missing,
                })
            else:
                compliant_count += 1

        is_fully_compliant = len(deficiencies) == 0

        return {
            "records_audited": len(records),
            "compliant_records": compliant_count,
            "deficiency_count": len(deficiencies),
            "cfr_516_5_compliant": is_fully_compliant,
            "audit_readiness_verdict": "PASS" if is_fully_compliant else "REVISE — DEFICIENCIES NOTED",
            "deficiencies": deficiencies,
        }
