"""Frontier dominance flags, coverage comparability and the coverage-adjusted improvement."""

import unittest

from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.engine.pareto import generate_pareto_frontier, mark_dominance
from app.schemas import ParetoPointSchema, SolveRequestSchema


def point(employees, ergo, under, over, leeway=0.0):
    return ParetoPointSchema(
        point_index=0,
        leeway_pct=leeway,
        obj_shift=0.0,
        obj_ergo=ergo,
        ergo_improvement_pct=0.0,
        employee_count=employees,
        active_shift_types_count=3,
        total_understaffing_hours=under,
        total_overstaffing_hours=over,
        full_weekends_off_pct=0.0,
        is_knee_point=False,
        is_selected=False,
        label="x",
    )


def request(key, leeway):
    preset = ARCHETYPE_PRESETS[key]
    return SolveRequestSchema(
        archetype_id=preset.id,
        facility_name=preset.name,
        demand_matrix=preset.demand_matrix,
        templates=preset.templates,
        guardrails=preset.guardrails,
        pareto_leeway_pct=leeway,
    )


class DominanceLogicTests(unittest.TestCase):
    def test_strictly_worse_point_is_dominated(self):
        """More staff, more strain and a bigger coverage gap than another point means dominated."""
        a, b = point(10, 20.0, 5, 5), point(12, 30.0, 8, 8)
        mark_dominance([a, b])
        self.assertTrue(a.non_dominated)
        self.assertFalse(b.non_dominated)

    def test_trade_offs_are_both_kept(self):
        """A point that is better on one axis and worse on another is not dominated."""
        a, b = point(10, 30.0, 5, 5), point(12, 20.0, 5, 5)
        mark_dominance([a, b])
        self.assertTrue(a.non_dominated)
        self.assertTrue(b.non_dominated)

    def test_identical_points_are_both_kept(self):
        """Ties on every axis do not dominate each other."""
        a, b = point(10, 20.0, 5, 5), point(10, 20.0, 5, 5)
        mark_dominance([a, b])
        self.assertTrue(a.non_dominated and b.non_dominated)

    def test_equal_on_two_axes_and_better_on_one_dominates(self):
        """Less than or equal everywhere and strictly less on one axis is enough."""
        a, b = point(10, 20.0, 5, 5), point(10, 20.0, 6, 5)
        mark_dominance([a, b])
        self.assertTrue(a.non_dominated)
        self.assertFalse(b.non_dominated)


class FrontierTests(unittest.TestCase):
    def test_every_point_still_returned_and_flagged(self):
        """The filter flags points and never removes them."""
        frontier = generate_pareto_frontier(request("downtown_foodmart_omaha", 5.0), 5.0)
        self.assertGreaterEqual(len(frontier), 6)
        self.assertTrue(any(not p.non_dominated for p in frontier))
        baseline = frontier[0]
        for p in frontier:
            self.assertEqual(
                p.coverage_comparable,
                p.total_understaffing_hours <= baseline.total_understaffing_hours + 2,
            )

    def test_knee_is_non_dominated_and_comparable_for_every_preset(self):
        """The best-value point is never a dominated one or one with clearly worse coverage."""
        for key in ARCHETYPE_PRESETS:
            with self.subTest(preset=key):
                frontier = generate_pareto_frontier(request(key, 5.0), 5.0)
                for p in frontier:
                    if p.is_knee_point:
                        self.assertTrue(p.non_dominated)
                        self.assertTrue(p.coverage_comparable)

    def test_foodmart_50_percent_improvement_is_not_credited(self):
        """A 50% leeway schedule that is far more understaffed than the baseline reports no improvement."""
        sol = ISDRWSPSolver(request("downtown_foodmart_omaha", 50.0), include_pareto_frontier=False).solve()
        base = ISDRWSPSolver(request("downtown_foodmart_omaha", 0.0), include_pareto_frontier=False).solve()
        under = sum(c.understaffing for c in sol.interval_coverage)
        base_under = sum(c.understaffing for c in base.interval_coverage)
        self.assertGreater(under, base_under + 2, "precondition: coverage is clearly worse")
        self.assertEqual(sol.ergonomics_audit.ergo_improvement_pct, 0.0)
        self.assertTrue(sol.ergonomics_audit.improvement_coverage_adjusted)

    def test_baseline_is_never_adjusted(self):
        """The 0% schedule is its own baseline and is not flagged."""
        sol = ISDRWSPSolver(request("manufacturing_24_7", 0.0), include_pareto_frontier=False).solve()
        self.assertFalse(sol.ergonomics_audit.improvement_coverage_adjusted)



class ScheduledHoursTests(unittest.TestCase):
    def test_scheduled_hours_match_each_points_own_solve(self):
        """Each frontier point's scheduled_hours equals the paid hours of a direct solve at its leeway."""
        frontier = generate_pareto_frontier(request("manufacturing_24_7", 5.0), 5.0)
        for p in frontier:
            with self.subTest(leeway=p.leeway_pct):
                direct = ISDRWSPSolver(
                    request("manufacturing_24_7", p.leeway_pct), include_pareto_frontier=False
                ).solve()
                self.assertGreater(p.scheduled_hours, 0)
                self.assertEqual(p.scheduled_hours, direct.labor_analysis.total_scheduled_hours)

if __name__ == "__main__":
    unittest.main()
