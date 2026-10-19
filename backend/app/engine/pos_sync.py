"""POS transaction ingestion and demand forecasting engine for ShiftFlow Studio."""

import csv
import io
import json
from typing import Any, Dict, List, Tuple


class POSDemandForecaster:
    """Ingests POS transaction records and converts sales velocity into hourly staffing demand R_gi."""

    def __init__(
        self,
        sales_per_staff_hour: float = 220.0,
        tx_per_staff_hour: float = 14.0,
        min_staff_open: int = 1,
        max_staff_cap: int = 6,
    ):
        self.sales_per_staff_hour = sales_per_staff_hour
        self.tx_per_staff_hour = tx_per_staff_hour
        self.min_staff_open = min_staff_open
        self.max_staff_cap = max_staff_cap

    def parse_pos_csv(self, csv_content: str) -> List[Dict[str, Any]]:
        """Parses generic POS export CSV (Square, Clover, Toast) into normalized transaction records."""
        records = []
        reader = csv.DictReader(io.StringIO(csv_content))
        for row in reader:
            # Flexible field matching across POS types
            amt_str = row.get("amount") or row.get("Total") or row.get("Net Sales") or row.get("Gross Sales") or "0"
            day_str = row.get("day_of_week") or row.get("Day") or "0"
            hr_str = row.get("hour_of_day") or row.get("Hour") or "0"
            
            try:
                amt = float(amt_str.replace("$", "").replace(",", "").strip())
                day = int(day_str)
                hr = int(hr_str)
                records.append({
                    "day_of_week": day % 7,
                    "hour_of_day": hr % 24,
                    "amount": amt,
                })
            except (ValueError, TypeError):
                continue
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
                    demand_matrix[d][h] = min(self.max_staff_cap, staff_int)

        summary = {
            "total_weekly_sales": round(total_weekly_sales, 2),
            "total_weekly_transactions": total_weekly_tx,
            "peak_hour": self._find_peak_hour(hourly_sales),
            "open_hours": f"{open_hour:02d}:00–{close_hour:02d}:00",
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
