"""Coverage fidelity: characterization of how far placed shifts are from the per-day targets.

These tests only record what the generator does today (WP-2.3a). They fix nothing.
See docs/forensics/coverage_20261022.md. Values are exact, so any change to the
generator's placement shows up here; WP-2.3b tightens them if a fix is approved.
"""

import unittest

from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.schemas import ErgonomicGuardrailsSchema, ShiftTemplateSchema, SolveRequestSchema


def _template(code, earliest_start, latest_end, duration, preferred_start):
    return ShiftTemplateSchema(
        code=code,
        name=code,
        earliest_start=earliest_start,
        latest_end=latest_end,
        min_duration=duration,
        max_duration=duration,
        preferred_start=preferred_start,
        preferred_duration=duration,
    )


MORNING_EVENING_NIGHT = [_template("M", 6, 14, 8, 6), _template("E", 14, 22, 8, 14), _template("N", 22, 30, 8, 22)]
DAY_NIGHT_12H = [_template("D", 6, 20, 12, 7), _template("N", 18, 31, 12, 19)]


def flat_demand(level):
    return [[level] * 24 for _ in range(7)]


def solve(templates, demand, guardrails=None):
    req = SolveRequestSchema(
        archetype_id="custom",
        facility_name="Coverage fidelity",
        demand_matrix=demand,
        templates=templates,
        guardrails=guardrails or ErgonomicGuardrailsSchema(),
        pareto_leeway_pct=0.0,
    )
    solver = ISDRWSPSolver(req, include_pareto_frontier=False)
    return solver, solver.solve()


def target_counts(solver):
    """Per template code, the targeted number of shifts starting on each weekday."""
    shift_types = solver._build_shift_types()
    targets = solver._solve_daily_shift_counts(shift_types)
    return {
        st["template_code"]: [targets.get((g, st["type_id"]), 0) for g in range(7)]
        for st in shift_types
    }


def actual_counts(solution):
    return {st.template_code: list(st.daily_counts) for st in solution.shift_types}


def abs_count_gap(solver, solution):
    targets, actual = target_counts(solver), actual_counts(solution)
    return sum(abs(a - t) for code in targets for a, t in zip(actual[code], targets[code]))


def coverage_gap(solution):
    return (
        sum(c.understaffing for c in solution.interval_coverage),
        sum(c.overstaffing for c in solution.interval_coverage),
    )


def grid_gap(grid, shift_windows, demand):
    """Understaffed plus overstaffed hours for a roster grid (lines x 7 days of shift codes)."""
    cover = [[0] * 24 for _ in range(7)]
    for row in grid:
        for day, code in enumerate(row):
            if code == "OFF":
                continue
            start, duration = shift_windows[code]
            for offset in range(duration):
                absolute = start + offset
                cover[(day + absolute // 24) % 7][absolute % 24] += 1
    return sum(abs(cover[d][h] - demand[d][h]) for d in range(7) for h in range(24))


def rotation_descent(solution, demand):
    """Coordinate descent over each line's 7 rotation offsets, on the output grid.

    This is an optimistic estimate only: rotating one line on its own breaks the rest and
    work-stretch continuity between that line and its neighbours in the cycle.
    """
    windows = {st.template_code: (st.start_hour, st.duration_hours) for st in solution.shift_types}
    grid = [[cell.shift_code for cell in line.days] for line in solution.roster_lines]
    best = grid_gap(grid, windows, demand)
    improved = True
    while improved:
        improved = False
        for i in range(len(grid)):
            original = grid[i]
            for shift in range(1, 7):
                candidate = original[shift:] + original[:shift]
                grid[i] = candidate
                gap = grid_gap(grid, windows, demand)
                if gap < best:
                    best, original, improved = gap, candidate, True
            grid[i] = original
    return best


class CoverageFidelityTests(unittest.TestCase):
    def test_targets_alone_leave_no_gap_on_flat_demand(self):
        """The per-day targets are right: on flat demand they cover every hour exactly."""
        for name, templates, guardrails in (
            ("8h M/E/N", MORNING_EVENING_NIGHT, ErgonomicGuardrailsSchema()),
            ("12h D/N", DAY_NIGHT_12H, ErgonomicGuardrailsSchema(min_rest_hours=11)),
        ):
            for level in (2, 3, 4, 5, 6):
                with self.subTest(templates=name, level=level):
                    demand = flat_demand(level)
                    solver, _ = solve(templates, demand, guardrails)
                    targets = target_counts(solver)
                    self.assertEqual({tuple(v) for v in targets.values()}, {(level,) * 7})

    def test_current_gap_8h_morning_evening_night(self):
        """Current placement gap, 8-hour M/E/N on flat demand: (lines, |actual-target|, under, over)."""
        expected = {2: (9, 26, 104, 104), 3: (14, 20, 80, 80), 4: (18, 40, 160, 160), 5: (23, 32, 128, 128), 6: (27, 44, 176, 176)}
        for level, want in expected.items():
            with self.subTest(level=level):
                solver, sol = solve(MORNING_EVENING_NIGHT, flat_demand(level))
                self.assertEqual((sol.employee_count, abs_count_gap(solver, sol)) + coverage_gap(sol), want)

    def test_current_gap_12h_day_night(self):
        """Current placement gap, 12-hour D/N at 11 hours rest: (lines, |actual-target|, under, over)."""
        expected = {2: (6, 20, 120, 120), 3: (9, 20, 120, 120), 4: (12, 22, 132, 132), 5: (15, 40, 240, 240), 6: (18, 46, 276, 276)}
        for level, want in expected.items():
            with self.subTest(level=level):
                solver, sol = solve(DAY_NIGHT_12H, flat_demand(level), ErgonomicGuardrailsSchema(min_rest_hours=11))
                self.assertEqual((sol.employee_count, abs_count_gap(solver, sol)) + coverage_gap(sol), want)

    def test_current_gap_shipped_presets(self):
        """Current understaffed and overstaffed hours of each shipped preset at 0% leeway."""
        expected = {
            "custom": (72, 112),
            "downtown_foodmart_omaha": (102, 122),
            "retail_grocery": (102, 122),
            "healthcare_24_7": (76, 200),
            "manufacturing_24_7": (112, 112),
            "emergency_services": (116, 200),
            "continuous_ops_12h": (132, 132),
        }
        for key, want in expected.items():
            with self.subTest(preset=key):
                preset = ARCHETYPE_PRESETS[key]
                _, sol = solve(preset.templates, preset.demand_matrix, preset.guardrails)
                self.assertEqual(coverage_gap(sol), want)

    def test_current_rotation_descent_bound_8h_flat4(self):
        """Rotating whole lines on the output grid cannot close the gap (and would break continuity)."""
        demand = flat_demand(4)
        _, sol = solve(MORNING_EVENING_NIGHT, demand)
        self.assertEqual(sum(coverage_gap(sol)), 320)
        self.assertEqual(rotation_descent(sol, demand), ROTATION_DESCENT_8H_FLAT4)


ROTATION_DESCENT_8H_FLAT4 = 128


if __name__ == "__main__":
    unittest.main()
