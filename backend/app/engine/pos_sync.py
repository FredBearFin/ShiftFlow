"""POS transaction ingestion and demand forecasting engine for ShiftFlow Studio."""

import csv
import io
import json
import math
from typing import Any, Dict, List, Optional, Tuple

AMOUNT_COLUMNS = ("amount", "Total", "Net Sales", "Gross Sales")
DAY_COLUMNS = ("day_of_week", "Day")
HOUR_COLUMNS = ("hour_of_day", "Hour")

# Accepts "Mon" and "Monday" (any case) as well as 0=Mon .. 6=Sun.
_DAY_INDEX: Dict[str, int] = {}
for _i, _full in enumerate(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]):
    _DAY_INDEX[_full] = _i
    _DAY_INDEX[_full[:3]] = _i


def _first_column(row: Dict[str, Any], names: Tuple[str, ...]) -> Optional[str]:
    """Returns the value of the first header present in the row, or None if no such column exists."""
    for name in names:
        if name in row:
            return row[name]
    return None


def _parse_amount(raw: Optional[str]) -> float:
    if raw is None or not raw.strip():
        raise ValueError("amount is missing")
    text = raw.replace("$", "").replace(",", "").strip()
    try:
        amt = float(text)
    except ValueError:
        raise ValueError(f"amount '{raw}' is not a number") from None
    if not math.isfinite(amt):
        raise ValueError(f"amount '{raw}' is not a finite number")
    return amt


def _parse_day(raw: Optional[str]) -> int:
    if raw is None or not raw.strip():
        raise ValueError("day is missing")
    text = raw.strip().lower()
    if text in _DAY_INDEX:
        return _DAY_INDEX[text]
    try:
        day = int(text)
    except ValueError:
        raise ValueError(f"day '{raw}' is not a day name or a number 0-6") from None
    if not 0 <= day <= 6:
        raise ValueError(f"day '{raw}' is outside 0-6")
    return day


def _parse_hour(raw: Optional[str]) -> int:
    if raw is None or not raw.strip():
        raise ValueError("hour is missing")
    try:
        hr = int(raw.strip())
    except ValueError:
        raise ValueError(f"hour '{raw}' is not a whole number") from None
    if not 0 <= hr <= 23:
        raise ValueError(f"hour '{raw}' is outside 0-23")
    return hr


# The per-hour staffing ceiling the forecast will not exceed.
#
# 6 suits a convenience store or a single-counter cafe and nothing larger: a hospital ward
# or a plant line needs many more people on the floor in one hour, and a cap of 6 silently
# flattens their real peaks into a schedule that cannot cover them. It is a site property,
# not a property of the engine, so it is a constructor argument with a documented default
# rather than a hidden constant. Callers that know the site should pass their own.
DEFAULT_MAX_STAFF_PER_HOUR = 6

# A site that wants no ceiling at all passes this instead of guessing a large number.
NO_STAFF_CAP = None


class POSDemandForecaster:
    """Ingests POS transaction records and converts sales velocity into hourly staffing demand R_gi."""

    def __init__(
        self,
        sales_per_staff_hour: float = 220.0,
        tx_per_staff_hour: float = 14.0,
        min_staff_open: int = 1,
        max_staff_cap: Optional[int] = DEFAULT_MAX_STAFF_PER_HOUR,
    ):
        """max_staff_cap is the most people the forecast will ever ask for in one hour.

        Pass the site's own ceiling, or None (NO_STAFF_CAP) for no ceiling at all. The
        default of 6 fits a small retail floor; larger operations must raise it or their
        peak hours come back understated.
        """
        if max_staff_cap is not None and max_staff_cap < min_staff_open:
            raise ValueError(
                f"max_staff_cap ({max_staff_cap}) is below min_staff_open ({min_staff_open}), "
                "so no staffing level would satisfy both."
            )
        self.sales_per_staff_hour = sales_per_staff_hour
        self.tx_per_staff_hour = tx_per_staff_hour
        self.min_staff_open = min_staff_open
        self.max_staff_cap = max_staff_cap

    def parse_pos_csv(self, csv_content: str) -> List[Dict[str, Any]]:
        """Parses generic POS export CSV (Square, Clover, Toast) into normalized transaction records.

        Raises ValueError naming the first row that cannot be read. No row is skipped silently,
        and a missing amount, day or hour is never defaulted to zero.
        """
        records = []
        reader = csv.DictReader(io.StringIO(csv_content))
        for row in reader:
            line_no = reader.line_num
            # Flexible field matching across POS types: the first header present wins
            try:
                amt = _parse_amount(_first_column(row, AMOUNT_COLUMNS))
                day = _parse_day(_first_column(row, DAY_COLUMNS))
                hr = _parse_hour(_first_column(row, HOUR_COLUMNS))
            except ValueError as exc:
                raise ValueError(f"POS CSV row {line_no} is invalid: {exc}") from None
            records.append({
                "day_of_week": day,
                "hour_of_day": hr,
                "amount": amt,
            })
        return records

    def calculate_demand_matrix(
        self,
        transactions: List[Dict[str, Any]],
        open_hour: int = 6,
        close_hour: int = 24,
    ) -> Tuple[List[List[int]], Dict[str, Any]]:
        """Aggregates transactions into 7x24 hourly revenue and projects required register demand R_gi."""
        # Initialize 7x24 matrices
        hourly_sales = [[0.0 for _ in range(24)] for _ in range(7)]
        hourly_tx_count = [[0 for _ in range(24)] for _ in range(7)]

        for tx in transactions:
            d = tx["day_of_week"]
            h = tx["hour_of_day"]
            hourly_sales[d][h] += tx["amount"]
            hourly_tx_count[d][h] += 1

        total_weekly_sales = sum(sum(day) for day in hourly_sales)
        total_weekly_tx = sum(sum(day) for day in hourly_tx_count)

        demand_matrix = [[0 for _ in range(24)] for _ in range(7)]

        for d in range(7):
            for h in range(24):
                if h < open_hour or h >= close_hour:
                    demand_matrix[d][h] = 0
                else:
                    sales = hourly_sales[d][h]
                    tx_cnt = hourly_tx_count[d][h]

                    staff_by_sales = sales / self.sales_per_staff_hour
                    staff_by_tx = tx_cnt / self.tx_per_staff_hour
                    needed = max(staff_by_sales, staff_by_tx)

                    # Round to nearest integer with minimum threshold during open hours
                    staff_int = max(self.min_staff_open, round(needed))
                    if self.max_staff_cap is not None:
                        staff_int = min(self.max_staff_cap, staff_int)
                    demand_matrix[d][h] = staff_int

        # Say so when the ceiling actually bit. Without this the forecast quietly reports a
        # flat peak and the schedule built from it is understaffed for reasons nothing names.
        capped_hours = 0
        if self.max_staff_cap is not None:
            for d in range(7):
                for h in range(open_hour, min(close_hour, 24)):
                    sales = hourly_sales[d][h]
                    tx_cnt = hourly_tx_count[d][h]
                    wanted = max(
                        self.min_staff_open,
                        round(max(sales / self.sales_per_staff_hour, tx_cnt / self.tx_per_staff_hour)),
                    )
                    if wanted > self.max_staff_cap:
                        capped_hours += 1

        summary = {
            "total_weekly_sales": round(total_weekly_sales, 2),
            "total_weekly_transactions": total_weekly_tx,
            "peak_hour": self._find_peak_hour(hourly_sales),
            "open_hours": f"{open_hour:02d}:00–{close_hour:02d}:00",
            "max_staff_cap": self.max_staff_cap,
            "hours_limited_by_staff_cap": capped_hours,
        }

        return demand_matrix, summary

    def _find_peak_hour(self, hourly_sales: List[List[float]]) -> Dict[str, Any]:
        max_sales = -1.0
        peak_day = 0
        peak_hr = 0
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        for d in range(7):
            for h in range(24):
                if hourly_sales[d][h] > max_sales:
                    max_sales = hourly_sales[d][h]
                    peak_day = d
                    peak_hr = h
        return {
            "day": days[peak_day],
            "hour": f"{peak_hr:02d}:00",
            "sales": round(max_sales, 2),
        }
