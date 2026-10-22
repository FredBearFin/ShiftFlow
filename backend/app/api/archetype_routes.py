"""Industry Archetype Presets for the 5-Step Onboarding Wizard."""

from typing import Dict, List
from fastapi import APIRouter, HTTPException
from app.schemas import (
    ArchetypePresetSchema,
    ErgonomicGuardrailsSchema,
    ShiftTemplateSchema,
)

router = APIRouter(prefix="/archetypes", tags=["Archetypes"])


def _build_foodmart_demand(mode: str = "normal") -> List[List[int]]:
    matrix: List[List[int]] = []
    for g in range(7):
        row = [0] * 24
        if mode == "chiHealthRush":
            is_rush_day = g in (3, 4, 5)
            for hr in range(6, 24):
                if hr < 11:
                    row[hr] = 3
                elif hr < 14:
                    row[hr] = 4 if is_rush_day else 3
                elif hr < 22:
                    row[hr] = 5 if is_rush_day else 4
                else:
                    row[hr] = 3
        elif mode == "cwsWeek":
            for hr in range(6, 24):
                if hr < 10:
                    row[hr] = 4
                elif hr < 22:
                    row[hr] = 6 if g >= 4 else 5
                else:
                    row[hr] = 4
        else:
            is_weekend = g >= 5
            for hr in range(6, 24):
                if hr < 11:
                    row[hr] = 3
                elif hr < 19:
                    row[hr] = 4 if is_weekend else 3
                else:
                    row[hr] = 4 if is_weekend else 3
        matrix.append(row)
    return matrix


def _build_24_7_demand(
    night_lvl: int, morning_lvl: int, day_lvl: int, eve_lvl: int, wknd_delta: int = -1
) -> List[List[int]]:
    matrix: List[List[int]] = []
    for g in range(7):
        is_wknd = g >= 5
        delta = wknd_delta if is_wknd else 0
        row: List[int] = []
        for hr in range(24):
            if 0 <= hr < 6:
                val = max(1, night_lvl)
            elif 6 <= hr < 14:
                val = max(1, morning_lvl + delta)
            elif 14 <= hr < 22:
                val = max(1, eve_lvl + delta)
            else:
                val = max(1, night_lvl)
            if 10 <= hr < 14 and day_lvl > morning_lvl:
                val = max(val, day_lvl + delta)
            row.append(val)
        matrix.append(row)
    return matrix


FOODMART_PRESET = ArchetypePresetSchema(
    id="downtown_foodmart_omaha",
    name="Downtown Grocery Store (Sample Profile)",
    sector="Urban Retail & Convenience",
    tagline="18-hour daily grocery/market floor (6am–12am) with CHI Arena & CWS event presets",
    description=(
        "Sample profile for a downtown grocery and market floor. "
        "Operates daily from 06:00 unlock to 12:00 AM midnight. Integrates Opening (6a–2p), "
        "Midday Rush (11a–7p), and Closing (4p–12a) shifts into a continuous forward rotation. "
        "The zero-clopening guardrail is enabled."
    ),
    operating_hours_label="06:00–12:00 AM Daily (126 hrs/wk)",
    typical_crew_size="6–8 Rotation Lines",
    default_leeway_pct=10.0,
    demand_matrix=_build_foodmart_demand("normal"),
    templates=[
        ShiftTemplateSchema(code="M", name="Opening Shift — 6a-2p (M)", earliest_start=6, latest_end=15, min_duration=7, max_duration=9, preferred_start=6, preferred_duration=8, enabled=True),
        ShiftTemplateSchema(code="D", name="Midday Rush — 11a-7p (D)", earliest_start=10, latest_end=20, min_duration=7, max_duration=9, preferred_start=11, preferred_duration=8, enabled=True),
        ShiftTemplateSchema(code="E", name="Closing Shift — 4p-12a (E)", earliest_start=15, latest_end=24, min_duration=7, max_duration=9, preferred_start=16, preferred_duration=8, enabled=True),
        ShiftTemplateSchema(code="N", name="Night Freight / Restock (N)", earliest_start=22, latest_end=31, min_duration=7, max_duration=9, preferred_start=23, preferred_duration=8, enabled=False),
    ],
    guardrails=ErgonomicGuardrailsSchema(
        min_consecutive_work_days=3,
        max_consecutive_work_days=5,
        min_consecutive_rest_days=2,
        max_consecutive_rest_days=3,
        max_consecutive_nights=2,
        max_consecutive_evenings=3,
        enforce_forward_rotation=True,
        enforce_zero_clopening=True,
        avoid_single_rest_days=True,
        avoid_single_night_shifts=True,
        prioritize_free_weekends=True,
    ),
)


ARCHETYPE_PRESETS: Dict[str, ArchetypePresetSchema] = {
    "downtown_foodmart_omaha": FOODMART_PRESET,
    "retail_grocery": FOODMART_PRESET.model_copy(update={"id": "retail_grocery", "name": "Extended-Hours Retail, Grocery & Fulfillment"}),
    "healthcare_24_7": ArchetypePresetSchema(
        id="healthcare_24_7",
        name="24/7 Acute Healthcare & ICU Nursing",
        sector="Healthcare",
        tagline="Patient-ratio compliant 24/7 clinical telemetry & acute care staffing",
        description="Continuous 24-hour hospital ward coverage with Morning, Mid, Evening, and Night templates.",
        operating_hours_label="24/7 Continuous (168 hrs/wk)",
        typical_crew_size="12–18 Rotation Lines",
        default_leeway_pct=5.0,
        demand_matrix=_build_24_7_demand(2, 4, 5, 3, -1),
        templates=[
            ShiftTemplateSchema(code="M", name="Morning Clinical (M)", earliest_start=5, latest_end=15, min_duration=8, max_duration=9, preferred_start=6, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="D", name="Day Rounds / Mid (D)", earliest_start=8, latest_end=19, min_duration=8, max_duration=9, preferred_start=10, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="E", name="Evening Charge (E)", earliest_start=13, latest_end=23, min_duration=8, max_duration=9, preferred_start=14, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="N", name="Night Telemetry (N)", earliest_start=21, latest_end=31, min_duration=8, max_duration=9, preferred_start=22, preferred_duration=8, enabled=True),
        ],
        guardrails=ErgonomicGuardrailsSchema(),
    ),
    "manufacturing_24_7": ArchetypePresetSchema(
        id="manufacturing_24_7",
        name="Continuous Process & Semiconductor Manufacturing",
        sector="Manufacturing",
        tagline="3-shift 24/7 plant line rotation with union-grade weekend equity",
        description="Continuous plant line operations with 3-shift 8-hour rotations.",
        operating_hours_label="24/7 Three-Shift Plant (168 hrs/wk)",
        typical_crew_size="14–20 Rotation Lines",
        default_leeway_pct=5.0,
        demand_matrix=_build_24_7_demand(3, 4, 4, 4, -1),
        templates=[
            ShiftTemplateSchema(code="M", name="Shift 1 — Early Line (M)", earliest_start=5, latest_end=15, min_duration=8, max_duration=9, preferred_start=6, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="D", name="Day Maintenance (D)", earliest_start=8, latest_end=18, min_duration=8, max_duration=9, preferred_start=9, preferred_duration=8, enabled=False),
            ShiftTemplateSchema(code="E", name="Shift 2 — Swing Line (E)", earliest_start=13, latest_end=23, min_duration=8, max_duration=9, preferred_start=14, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="N", name="Shift 3 — Graveyard Line (N)", earliest_start=21, latest_end=31, min_duration=8, max_duration=9, preferred_start=22, preferred_duration=8, enabled=True),
        ],
        guardrails=ErgonomicGuardrailsSchema(),
    ),
    "continuous_ops_12h": ArchetypePresetSchema(
        id="continuous_ops_12h",
        name="Continuous Operations (12-hour days and nights)",
        sector="Continuous Operations",
        tagline="Plants, utilities and control rooms that run 12-hour day and night crews",
        description="Round-the-clock coverage with one 12-hour day shift and one 12-hour night shift, and an 11-hour minimum rest between shifts.",
        operating_hours_label="24/7 Continuous (168 hrs/wk)",
        typical_crew_size="10–14 Rotation Lines",
        default_leeway_pct=5.0,
        demand_matrix=_build_24_7_demand(4, 4, 4, 4, 0),
        templates=[
            ShiftTemplateSchema(code="D", name="12-Hour Day (D)", earliest_start=6, latest_end=20, min_duration=12, max_duration=12, preferred_start=7, preferred_duration=12, enabled=True),
            ShiftTemplateSchema(code="N", name="12-Hour Night (N)", earliest_start=18, latest_end=31, min_duration=12, max_duration=12, preferred_start=19, preferred_duration=12, enabled=True),
        ],
        # 11 hours, not the default 16: a repeated 12-hour shift leaves exactly 12 hours of rest.
        guardrails=ErgonomicGuardrailsSchema(min_rest_hours=11),
    ),
    "emergency_services": ArchetypePresetSchema(
        id="emergency_services",
        name="Emergency Dispatch, EMS & Public Safety",
        sector="Public Safety",
        tagline="High-vigilance 24/7 emergency response with strict fatigue caps",
        description="24/7 mission critical public safety response with strict fatigue limits.",
        operating_hours_label="24/7 Mission Critical (168 hrs/wk)",
        typical_crew_size="10–16 Rotation Lines",
        default_leeway_pct=5.0,
        demand_matrix=_build_24_7_demand(3, 3, 4, 4, 0),
        templates=[
            ShiftTemplateSchema(code="M", name="Alpha Watch — Morning (M)", earliest_start=6, latest_end=15, min_duration=8, max_duration=9, preferred_start=6, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="D", name="Bravo Watch — Tactical Day (D)", earliest_start=9, latest_end=19, min_duration=8, max_duration=9, preferred_start=10, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="E", name="Charlie Watch — Evening (E)", earliest_start=14, latest_end=23, min_duration=8, max_duration=9, preferred_start=14, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="N", name="Delta Watch — Midnight (N)", earliest_start=22, latest_end=31, min_duration=8, max_duration=9, preferred_start=22, preferred_duration=8, enabled=True),
        ],
        guardrails=ErgonomicGuardrailsSchema(),
    ),
    "custom": ArchetypePresetSchema(
        id="custom",
        name="Custom Schedule",
        sector="Custom Operations",
        tagline="Fully customizable 24-hour interval demand matrix and shift templates",
        description="Configure bespoke operating windows and demand from scratch.",
        operating_hours_label="Configurable (Up to 168 hrs/wk)",
        typical_crew_size="Dynamic",
        default_leeway_pct=5.0,
        demand_matrix=_build_24_7_demand(1, 3, 3, 2, -1),
        templates=[
            ShiftTemplateSchema(code="M", name="Morning Shift (M)", earliest_start=5, latest_end=15, min_duration=7, max_duration=9, preferred_start=6, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="D", name="Day / Mid Shift (D)", earliest_start=8, latest_end=19, min_duration=7, max_duration=9, preferred_start=10, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="E", name="Evening Shift (E)", earliest_start=13, latest_end=23, min_duration=7, max_duration=9, preferred_start=14, preferred_duration=8, enabled=True),
            ShiftTemplateSchema(code="N", name="Night Shift (N)", earliest_start=21, latest_end=31, min_duration=7, max_duration=9, preferred_start=22, preferred_duration=8, enabled=True),
        ],
        guardrails=ErgonomicGuardrailsSchema(),
    ),
}


@router.get("", response_model=List[ArchetypePresetSchema])
def list_archetypes() -> List[ArchetypePresetSchema]:
    return list(ARCHETYPE_PRESETS.values())


@router.get("/{archetype_id}", response_model=ArchetypePresetSchema)
def get_archetype(archetype_id: str) -> ArchetypePresetSchema:
    preset = ARCHETYPE_PRESETS.get(archetype_id)
    if not preset:
        raise HTTPException(
            status_code=404, detail=f"Archetype '{archetype_id}' not found."
        )
    return preset
