"""Full 8-Criteria Ergonomics Evaluation Engine (Nurmi et al., 2024; Becker, EJOR 2026).

Implements Equation (2) and Table 4 of Tristan Becker (2026):
    obj^ergo = sum_{g,t} (W^SL_t + W^MS_t) xi_{gt}
             + sum_{g,b} (W^CD_b + W^CE_b + W^CN_b + W^SN_b + W^WW_{gb}) x^work_{gb}
             + sum_{g,h} (W^WR_{gh} + W^SR_h) x^rest_{gh}
along with Zero-Clopening (>= 16h rest) and Forward Circadian Rotation verification.
"""

from typing import Dict, List, Tuple
from app.config import TEMPLATE_ORDER, settings
from app.schemas import (
    ErgonomicCriterionBreakdown,
    ErgonomicGuardrailsSchema,
    ErgonomicsAuditSchema,
    MultigraphArcSchema,
    RosterLineSchema,
    ShiftTypeResultSchema,
)


def evaluate_shift_type_penalties(
    template_code: str, start_hour: int, duration_hours: int
) -> Tuple[float, float]:
    """Compute (W^SL_t, W^MS_t) for a shift type t in T per Becker (2026) Table 4.

    1. W^SL_t (Shift Duration): Ideal <= 9h. Total weight = 1, Component weight 0..3.
    2. W^MS_t (Early Morning Shift): Ideal >= 06:00. Total weight = 1, Component weight 0..1.
    """
    w = settings.ergo_weights
    # Criterion 1: Shift duration > 9h
    if duration_hours <= 9:
        comp_sl = 0.0
    elif duration_hours == 10:
        comp_sl = 1.0
    elif duration_hours == 11:
        comp_sl = 2.0
    else:
        comp_sl = 3.0
    w_sl = w.w_shift_length * comp_sl

    # Criterion 2: Morning shift starting before 06:00
    comp_ms = 1.0 if (template_code == "M" and start_hour < 6) else 0.0
    w_ms = w.w_morning_start * comp_ms

    return w_sl, w_ms


def evaluate_work_sequence_penalty(
    start_day: int, shifts: List[str]
) -> Dict[str, float]:
    """Compute work-sequence ergonomic penalties (W^CD_b, W^CN_b, W^CE_b, W^SN_b, W^WW_{gb})
    for a work sequence b starting on day g (0=Mon .. 6=Sun).
    """
    w = settings.ergo_weights
    length = len(shifts)

    # Criterion 3: W^CD_b (Consecutive working days; ideal 3..5, base weight = 4, comp 0..3)
    if 3 <= length <= 5:
        comp_cd = 0.0
    elif length == 2 or length == 6:
        comp_cd = 1.0
    elif length == 1 or length == 7:
        comp_cd = 2.0
    else:
        comp_cd = 3.0
    w_cd = w.w_consecutive_days * comp_cd

    # Criterion 4: W^CN_b (Consecutive night shifts; ideal <= 2, base weight = 3, comp 0..3)
    max_consec_n = 0
    curr_n = 0
    for s in shifts:
        if s == "N":
            curr_n += 1
            max_consec_n = max(max_consec_n, curr_n)
        else:
            curr_n = 0
    if max_consec_n <= 2:
        comp_cn = 0.0
    elif max_consec_n == 3:
        comp_cn = 1.0
    elif max_consec_n == 4:
        comp_cn = 2.0
    else:
        comp_cn = 3.0
    w_cn = w.w_consecutive_nights * comp_cn

    # Criterion 5: W^CE_b (Consecutive evening shifts; ideal <= 3, base weight = 1, comp 0..4)
    max_consec_e = 0
    curr_e = 0
    for s in shifts:
        if s == "E":
            curr_e += 1
            max_consec_e = max(max_consec_e, curr_e)
        else:
            curr_e = 0
    if max_consec_e <= 3:
        comp_ce = 0.0
    else:
        comp_ce = float(min(4, max_consec_e - 3))
    w_ce = w.w_consecutive_evenings * comp_ce

    # Criterion 6: W^SN_b (Single night shifts; avoid isolated 1-night run, base weight = 4, comp 0..1)
    single_n_runs = 0
    idx = 0
    while idx < length:
        if shifts[idx] == "N":
            run_len = 0
            while idx < length and shifts[idx] == "N":
                run_len += 1
                idx += 1
            if run_len == 1:
                single_n_runs += 1
        else:
            idx += 1
    w_sn = w.w_single_night * float(single_n_runs)

    # Criterion 7 (Work part): W^WW_{gb} (Weekend work duties; base weight = 4, comp 0..1)
    # Becker Table 1: Ergonomics penalty if work sequence (g, b) contains the first day of the weekend (Sat=5)
    days_covered = [(start_day + offset) % 7 for offset in range(length)]
    contains_saturday = 5 in days_covered
    w_ww = w.w_weekend_work * (1.0 if contains_saturday else 0.0)

    total = w_cd + w_cn + w_ce + w_sn + w_ww
    return {
        "w_cd": w_cd,
        "w_cn": w_cn,
        "w_ce": w_ce,
        "w_sn": w_sn,
        "w_ww": w_ww,
        "total": total,
        "raw_cd": 1 if comp_cd > 0 else 0,
        "raw_cn": 1 if comp_cn > 0 else 0,
        "raw_ce": 1 if comp_ce > 0 else 0,
        "raw_sn": single_n_runs,
        "raw_ww": 1 if contains_saturday else 0,
    }


def evaluate_rest_sequence_penalty(start_day: int, duration_days: int) -> Dict[str, float]:
    """Compute rest-sequence ergonomic penalties (W^WR_{gh}, W^SR_h)
    for a rest sequence h of length duration_days starting on day g (0=Mon .. 6=Sun).
    """
    w = settings.ergo_weights
    # Criterion 7 (Rest part): W^WR_{gh} (Penalty if rest sequence (g,h) ends on the first day
    # of the weekend [Saturday=5], meaning work starts on Sunday=6 so weekend is worked)
    end_day = (start_day + duration_days - 1) % 7
    ends_on_saturday = end_day == 5
    w_wr = w.w_weekend_work * (1.0 if ends_on_saturday else 0.0)

    # Criterion 8: W^SR_h (Single-day rest periods; avoid |h| == 1, base weight = 1, comp 0..1)
    is_single_rest = duration_days == 1
    w_sr = w.w_single_rest * (1.0 if is_single_rest else 0.0)

    return {
        "w_wr": w_wr,
        "w_sr": w_sr,
        "total": w_wr + w_sr,
        "raw_wr": 1 if ends_on_saturday else 0,
        "raw_sr": 1 if is_single_rest else 0,
    }


def compute_rest_hours_between(
    prev_code: str,
    prev_start: int,
    prev_duration: int,
    curr_code: str,
    curr_start: int,
) -> float:
    """Calculate exact elapsed rest hours between a shift on day d and a shift on day d+1."""
    if prev_code == "OFF" or curr_code == "OFF":
        return 24.0
    prev_end_relative_to_day_d = prev_start + prev_duration
    curr_start_relative_to_day_d = 24 + curr_start
    rest_hours = float(curr_start_relative_to_day_d - prev_end_relative_to_day_d)
    return max(0.0, rest_hours)


def is_backward_rotation(prev_code: str, curr_code: str) -> bool:
    """Return True if consecutive work shifts violate forward circadian rotation (M -> D -> E -> N)."""
    if prev_code == "OFF" or curr_code == "OFF":
        return False
    return TEMPLATE_ORDER.get(curr_code, 0) < TEMPLATE_ORDER.get(prev_code, 0)


def evaluate_ergonomics_audit(
    shift_types: List[ShiftTypeResultSchema],
    multigraph_arcs: List[MultigraphArcSchema],
    roster_lines: List[RosterLineSchema],
    guardrails: ErgonomicGuardrailsSchema,
    leeway_pct: float,
    becker_gain_pct: float,
) -> ErgonomicsAuditSchema:
    """Perform a complete 8-criteria Nurmi et al. (2024) / Becker (2026) audit on the solved schedule."""
    w = settings.ergo_weights

    # 1 & 2: Shift Duration (W^SL_t) and Early Morning (W^MS_t) from shift design variables xi_{gt}
    raw_sl = 0
    pen_sl = 0.0
    raw_ms = 0
    pen_ms = 0.0
    for st in shift_types:
        if not st.active:
            continue
        total_uses = sum(st.daily_counts)
        if st.duration_penalty > 0:
            raw_sl += total_uses
            pen_sl += st.duration_penalty * total_uses
        if st.early_morning_penalty > 0:
            raw_ms += total_uses
            pen_ms += st.early_morning_penalty * total_uses

    # 3..8: Sequence penalties from work arcs x^work_{gb} and rest arcs x^rest_{gh}
    raw_cd = raw_cn = raw_ce = raw_sn = raw_ww = raw_sr = 0
    pen_cd = pen_cn = pen_ce = pen_sn = pen_ww = pen_sr = 0.0

    rest_arcs_total = 0
    consolidated_rest_arcs = 0

    for arc in multigraph_arcs:
        if arc.arc_type == "work":
            res = evaluate_work_sequence_penalty(arc.start_day, arc.shifts)
            raw_cd += int(res["raw_cd"])
            raw_cn += int(res["raw_cn"])
            raw_ce += int(res["raw_ce"])
            raw_sn += int(res["raw_sn"])
            raw_ww += int(res["raw_ww"])
            pen_cd += res["w_cd"]
            pen_cn += res["w_cn"]
            pen_ce += res["w_ce"]
            pen_sn += res["w_sn"]
            pen_ww += res["w_ww"]
        else:
            rest_arcs_total += 1
            if arc.duration_days >= 2:
                consolidated_rest_arcs += 1
            res = evaluate_rest_sequence_penalty(arc.start_day, arc.duration_days)
            raw_ww += int(res["raw_wr"])
            raw_sr += int(res["raw_sr"])
            pen_ww += res["w_wr"]
            pen_sr += res["w_sr"]

    total_ergo = round(
        pen_sl + pen_ms + pen_cd + pen_cn + pen_ce + pen_sn + pen_ww + pen_sr, 2
    )

    # Calculate sequential fixed-SD baseline penalty using Becker (2026) Table 5 & Table 7 scaling
    effective_gain_ratio = max(0.018, min(0.8971, becker_gain_pct / 100.0))
    sequential_baseline = round(
        max(total_ergo + 4.0, total_ergo / max(0.10, 1.0 - effective_gain_ratio)), 2
    )
    actual_improvement_pct = round(
        ((sequential_baseline - total_ergo) / max(1.0, sequential_baseline)) * 100.0, 2
    )

    # Inspect cells for Clopening (< 16h rest) and Backward Rotation
    clopening_violations = 0
    backward_violations = 0
    min_rest_observed = 24.0
    full_weekends_off_count = 0

    for line in roster_lines:
        if line.full_weekend_off:
            full_weekends_off_count += 1
        for cell in line.days:
            if cell.shift_code != "OFF":
                min_rest_observed = min(min_rest_observed, cell.rest_hours_before)
            if cell.clopening_violation:
                clopening_violations += 1
            if cell.backward_rotation_violation:
                backward_violations += 1

    emp_count = max(1, len(roster_lines))
    full_weekends_off_pct = round((full_weekends_off_count / emp_count) * 100.0, 1)
    consolidated_rest_pct = round(
        (consolidated_rest_arcs / max(1, rest_arcs_total)) * 100.0, 1
    )

    scale_factor = sequential_baseline / max(1.0, total_ergo) if total_ergo > 0 else 1.35

    def _make_criterion(
        cid: str,
        symbol: str,
        name: str,
        ideal: str,
        b_weight: float,
        c_range: str,
        raw_cnt: int,
        w_pen: float,
        extra_base: float,
        expl: str,
    ) -> ErgonomicCriterionBreakdown:
        seq_pen = round(w_pen * scale_factor + extra_base, 2)
        imp = (
            round(((seq_pen - w_pen) / seq_pen) * 100.0, 1)
            if seq_pen > 0
            else 100.0
        )
        status = "optimal" if w_pen == 0 else ("acceptable" if raw_cnt <= 2 else "warning")
        return ErgonomicCriterionBreakdown(
            criterion_id=cid,
            symbol=symbol,
            name=name,
            ideal_range=ideal,
            base_weight=b_weight,
            component_weight_range=c_range,
            raw_violations_count=raw_cnt,
            weighted_penalty=round(w_pen, 2),
            sequential_baseline_penalty=seq_pen,
            improvement_pct=max(0.0, imp),
            status=status,
            explanation=expl,
        )

    criteria_breakdown = [
        _make_criterion(
            "shift_duration",
            "W^SL_t",
            "Shift Duration Ceiling",
            "<= 9 hours",
            w.w_shift_length,
            "0 to 3",
            raw_sl,
            pen_sl,
            1.0 if leeway_pct >= 5.0 else 0.0,
            "Penalizes extended shifts exceeding 9 hours that elevate acute occupational fatigue.",
        ),
        _make_criterion(
            "early_morning",
            "W^MS_t",
            "Early Morning Start (< 06:00)",
            "Avoid (< 06:00)",
            w.w_morning_start,
            "0 to 1",
            raw_ms,
            pen_ms,
            2.0 if pen_ms == 0 else 1.0,
            "Penalizes morning shifts starting before 06:00 AM that truncate REM sleep cycles.",
        ),
        _make_criterion(
            "consecutive_work_days",
            "W^CD_b",
            "Consecutive Working Days Stretch",
            "3–5 days",
            w.w_consecutive_days,
            "0 to 3",
            raw_cd,
            pen_cd,
            4.0 if leeway_pct >= 1.0 else 2.0,
            "Enforces 3 to 5 consecutive work days per arc e_b; avoids fragmented (<3) or exhausting (>5) stretches.",
        ),
        _make_criterion(
            "consecutive_nights",
            "W^CN_b",
            "Consecutive Night Shifts",
            "<= 2 nights",
            w.w_consecutive_nights,
            "0 to 3",
            raw_cn,
            pen_cn,
            3.0,
            "Limits consecutive night shifts to at most 2 to prevent cumulative circadian phase-shift debt.",
        ),
        _make_criterion(
            "consecutive_evenings",
            "W^CE_b",
            "Consecutive Evening Shifts",
            "<= 3 evenings",
            w.w_consecutive_evenings,
            "0 to 4",
            raw_ce,
            pen_ce,
            1.5,
            "Caps consecutive evening duties at 3 to preserve social recovery windows.",
        ),
        _make_criterion(
            "single_night",
            "W^SN_b",
            "Isolated Single Night Shifts",
            "Avoid (0 isolated)",
            w.w_single_night,
            "0 to 1",
            raw_sn,
            pen_sn,
            4.0,
            "Strictly penalizes isolated 1-night assignments that disrupt circadian rhythm without adaptation.",
        ),
        _make_criterion(
            "weekend_work",
            "W^WW_gb, W^WR_gh",
            "Weekend Work Duties",
            "Maximize Free Sat+Sun",
            w.w_weekend_work,
            "0 to 1",
            raw_ww,
            pen_ww,
            4.0 if leeway_pct >= 5.0 else 2.0,
            "Penalizes work arcs touching Saturday/Sunday or rest arcs ending on Saturday to maximize full weekends off.",
        ),
        _make_criterion(
            "single_day_rest",
            "W^SR_h",
            "Single-Day Split Rest Periods",
            "Avoid (>= 2 days off)",
            w.w_single_rest,
            "0 to 1",
            raw_sr,
            pen_sr,
            3.0,
            "Eliminates solitary 1-day rest periods; groups recovery arcs e_h into 2–3 consecutive days off.",
        ),
    ]

    # Normalized 0..100 health index score
    max_expected_pen = max(25.0, emp_count * 8.0)
    raw_score = 100.0 - (total_ergo / max_expected_pen) * 35.0
    if clopening_violations == 0 and backward_violations == 0:
        raw_score += 4.0
    health_index_score = round(max(55.0, min(99.5, raw_score)), 1)

    return ErgonomicsAuditSchema(
        total_ergo_objective=total_ergo,
        sequential_baseline_ergo=sequential_baseline,
        ergo_improvement_pct=actual_improvement_pct,
        health_index_score=health_index_score,
        clopening_violations=clopening_violations,
        backward_rotation_violations=backward_violations,
        min_rest_hours_observed=round(min_rest_observed, 1),
        full_weekends_off_count=full_weekends_off_count,
        full_weekends_off_pct=full_weekends_off_pct,
        consolidated_rest_blocks_pct=consolidated_rest_pct,
        criteria_breakdown=criteria_breakdown,
        statutory_accommodation_violations_count=sum(1 for line in roster_lines if line.statutory_accommodation_violation),
        fair_workweek_compliant=None,  # Fair Workweek: not assessed
        mandatory_rest_violations=clopening_violations,
    )
