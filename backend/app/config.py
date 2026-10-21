"""Configuration settings and mathematical constants for ShiftFlow Studio (I-SD-RWSP)."""

from pydantic import BaseModel


class ShiftDesignWeights(BaseModel):
    """Becker (2026) Table 3 Shift Design Objective Weights (Musliu et al., 2004)."""
    w_employees: float = 5.0       # W^E: Weight for number of employees (e)
    w_shift_types: float = 60.0    # W^NS: Weight for distinct shift types used (sum phi_t)
    w_overstaffing: float = 1.0    # W^O: Weight for overstaffing per interval (omega_gi)
    w_understaffing: float = 1.0   # W^U: Weight for understaffing per interval (tau_gi)


class ErgonomicsWeights(BaseModel):
    """Becker (2026) Table 4 Ergonomics Objective Weights (Nurmi et al., 2024)."""
    w_shift_length: float = 1.0          # W^SL_t: Penalize shifts > 9h (component 0..3)
    w_morning_start: float = 1.0         # W^MS_t: Penalize morning shifts starting < 06:00 (component 0..1)
    w_consecutive_days: float = 4.0      # W^CD_b: Ideal 3-5 days; penalize <3 or >5 (component 0..3)
    w_consecutive_nights: float = 3.0    # W^CN_b: Ideal <=2; penalize >=3 consecutive nights (component 0..3)
    w_consecutive_evenings: float = 1.0  # W^CE_b: Ideal <=3; penalize >=4 consecutive evenings (component 0..4)
    w_single_night: float = 4.0          # W^SN_b: Avoid isolated single night shifts (component 0..1)
    w_weekend_work: float = 4.0          # W^WW_gb, W^WR_gh: Avoid weekend work duties (component 0..1)
    w_single_rest: float = 1.0           # W^SR_h: Avoid single-day rest periods (component 0..1)


class AppConfig(BaseModel):
    """Global application configuration for ShiftFlow Studio."""
    app_name: str = "ShiftFlow Studio Enterprise (I-SD-RWSP Workforce OS)"
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
