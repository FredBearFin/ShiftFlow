"""Coverage fidelity: how far placed shifts are from the per-day targets.

WP-2.3a recorded the gap before any fix (docs/forensics/coverage_20261022.md); WP-2.3b added
the pair-order placement step and these tests now bound the gap at the measured value plus 10%.
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

    def test_gap_at_most_8h_morning_evening_night(self):
        """8-hour M/E/N on flat demand: lines and an upper bound on understaffed hours.

        Bound = measured value plus 10%. Measured after the pair-order placement (WP-2.3b):
        64, 56, 136, 104, 128 understaffed hours for demand 2 to 6.
        """
        measured = {2: (9, 64), 3: (14, 56), 4: (18, 136), 5: (23, 104), 6: (27, 128)}
        for level, (lines, under) in measured.items():
            with self.subTest(level=level):
                _, sol = solve(MORNING_EVENING_NIGHT, flat_demand(level))
                self.assertEqual(sol.employee_count, lines)
                self.assertEqual(coverage_gap(sol)[0], coverage_gap(sol)[1])
                self.assertLessEqual(coverage_gap(sol)[0], under * 1.1)

    def test_gap_at_most_12h_day_night(self):
        """12-hour D/N at 11 hours rest on flat demand; bound = measured plus 10%.

        Measured: 108, 120, 108, 228, 276 understaffed hours for demand 2 to 6.
        """
        measured = {2: (6, 108), 3: (9, 120), 4: (12, 108), 5: (15, 228), 6: (18, 276)}
        for level, (lines, under) in measured.items():
            with self.subTest(level=level):
                _, sol = solve(DAY_NIGHT_12H, flat_demand(level), ErgonomicGuardrailsSchema(min_rest_hours=11))
                self.assertEqual(sol.employee_count, lines)
                self.assertLessEqual(coverage_gap(sol)[0], under * 1.1)

    def test_understaffing_share_on_flat_demand_8h(self):
        """The plan's target was at most 10% of required hours understaffed. It is NOT reached:
        the worst measured case is 20.2% (demand 4), the best 11.1% (demand 3). The bound below
        is the measured worst case plus 10%, not the target."""
        for level in (2, 3, 4, 5, 6):
            with self.subTest(level=level):
                _, sol = solve(MORNING_EVENING_NIGHT, flat_demand(level))
                required = 7 * 24 * level
                self.assertLessEqual(coverage_gap(sol)[0] / required, 0.202 * 1.1)

    def test_gap_shipped_presets_at_most(self):
        """Understaffed and overstaffed hours of each shipped preset at 0% leeway; bound = measured plus 10%."""
        measured = {
            "custom": (56, 96),
            "downtown_foodmart_omaha": (102, 122),
            "retail_grocery": (102, 122),
            "healthcare_24_7": (32, 156),
            "manufacturing_24_7": (64, 64),
            "emergency_services": (96, 180),
            "continuous_ops_12h": (108, 108),
        }
        for key, (under, over) in measured.items():
            with self.subTest(preset=key):
                preset = ARCHETYPE_PRESETS[key]
                _, sol = solve(preset.templates, preset.demand_matrix, preset.guardrails)
                got_under, got_over = coverage_gap(sol)
                self.assertLessEqual(got_under, under * 1.1)
                self.assertLessEqual(got_over, over * 1.1)
                self.assertEqual(sol.ergonomics_audit.clopening_violations, 0)

    def test_weekends_off_count_matches_the_roster(self):
        """full_weekends_off_count equals a recount of lines whose Saturday and Sunday are both off."""
        for key in ("manufacturing_24_7", "healthcare_24_7", "downtown_foodmart_omaha"):
            with self.subTest(preset=key):
                preset = ARCHETYPE_PRESETS[key]
                _, sol = solve(preset.templates, preset.demand_matrix, preset.guardrails)
                recount = sum(
                    1
                    for line in sol.roster_lines
                    if line.days[5].shift_code == "OFF" and line.days[6].shift_code == "OFF"
                )
                self.assertEqual(sol.ergonomics_audit.full_weekends_off_count, recount)

    def test_rotation_descent_bound_8h_flat4(self):
        """Rotating whole lines on the output grid would still beat the placement (and break continuity)."""
        demand = flat_demand(4)
        _, sol = solve(MORNING_EVENING_NIGHT, demand)
        self.assertEqual(sum(coverage_gap(sol)), 272)
        self.assertEqual(rotation_descent(sol, demand), 96)



if __name__ == "__main__":
    unittest.main()
