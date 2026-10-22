"""Configuration settings for ShiftFlow Studio."""

import os

from pydantic import BaseModel, Field


def _env_flag(name: str, default: bool) -> bool:
    """Reads a boolean feature flag from the environment (same convention as app/auth.py).

    Unset or blank keeps the default; "0"/"false"/"no"/"off" (any case) means off,
    anything else means on.
    """
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


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
    # A schedule counts as having comparable coverage when its understaffed hours are at most the
    # no-extra-cost schedule's plus this many hours.
    coverage_tolerance_hours: int = 2
    shift_weights: ShiftDesignWeights = ShiftDesignWeights()
    ergo_weights: ErgonomicsWeights = ErgonomicsWeights()

    # Feature flags for modules built during an earlier "enterprise workforce OS" phase.
    # They are kept (not deleted) but default off, outside the V1 "happy path" product
    # surface for small independent retail/food-service managers. Flip on via env var,
    # e.g. SHIFTFLOW_ENABLE_POS_INTEGRATION=1, for anyone who wants that functionality.
    enable_pos_integration: bool = Field(
        default_factory=lambda: _env_flag("SHIFTFLOW_ENABLE_POS_INTEGRATION", False)
    )
    enable_emergency_workflows: bool = Field(
        default_factory=lambda: _env_flag("SHIFTFLOW_ENABLE_EMERGENCY_WORKFLOWS", False)
    )
    enable_shift_handover: bool = Field(
        default_factory=lambda: _env_flag("SHIFTFLOW_ENABLE_SHIFT_HANDOVER", False)
    )

    # Closed by default (same fail-closed default this app already uses for login and
    # cookie security) - this session's pentest flagged the interactive /docs console and
    # /openapi.json's full request/response schema as reachable with no login and no way
    # to turn them off. Most deployments never need the browsable docs; anyone who does can
    # opt in with SHIFTFLOW_ENABLE_API_DOCS=1. See app/main.py's _docs_urls().
    enable_api_docs: bool = Field(
        default_factory=lambda: _env_flag("SHIFTFLOW_ENABLE_API_DOCS", False)
    )


settings = AppConfig()
DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
TEMPLATE_ORDER = {"M": 0, "D": 1, "E": 2, "N": 3}
