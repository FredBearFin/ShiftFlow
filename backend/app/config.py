"""Configuration settings for ShiftFlow Studio."""

from pydantic import BaseModel


class ShiftDesignWeights(BaseModel):
    """How much each part of the shift design cost counts toward the total."""
    w_employees: float = 5.0       # Cost per employee scheduled
    w_shift_types: float = 60.0    # Cost per distinct shift type used
    w_overstaffing: float = 1.0    # Cost per hour scheduled above what's needed
    w_understaffing: float = 1.0   # Cost per hour scheduled below what's needed


class ErgonomicsWeights(BaseModel):
    """How much each workload/fatigue check counts toward the ergonomics score."""
    w_shift_length: float = 1.0          # Shifts longer than 9 hours
    w_morning_start: float = 1.0         # Shifts starting before 6:00am
    w_consecutive_days: float = 4.0      # Work stretches outside the ideal 3-5 days
    w_consecutive_nights: float = 3.0    # 3 or more night shifts in a row
    w_consecutive_evenings: float = 1.0  # 4 or more evening shifts in a row
    w_single_night: float = 4.0          # A single night shift on its own
    w_weekend_work: float = 4.0          # Weekend work duties
    w_single_rest: float = 1.0           # A single day off on its own


class AppConfig(BaseModel):
    """Global application configuration for ShiftFlow Studio."""
    app_name: str = "ShiftFlow Studio"
    version: str = "2.6.0"
    api_prefix: str = "/api/v1"
    planning_days: int = 7
    intervals_per_day: int = 24
    min_rest_hours_between_shifts: int = 16
    shift_weights: ShiftDesignWeights = ShiftDesignWeights()
    ergo_weights: ErgonomicsWeights = ErgonomicsWeights()


settings = AppConfig()
DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
TEMPLATE_ORDER = {"M": 0, "D": 1, "E": 2, "N": 3}
