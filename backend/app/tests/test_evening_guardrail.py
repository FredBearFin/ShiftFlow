"""The consecutive-evening guardrail applies even when E is the only candidate left.

History: the check read `cand == "E" and len(candidates) > 1`, so whenever E was the
sole remaining code the limit was silently skipped and a rotation could exceed it. A
Judge ordered it applied unconditionally; the King deferred, because at the time the
code assigner had no backtracking - with one candidate and no way to back out, applying
the guard simply made presets infeasible and broke 12 tests.

That premise is gone. The assigner now backtracks out of dead ends, so refusing a
candidate makes it reconsider an earlier choice instead of failing. The guard is
unconditional, every bundled preset still solves at every flexibility level, and the
limit is actually enforced.
"""

import unittest

from app.api.archetype_routes import ARCHETYPE_PRESETS
from app.engine.isd_rwsp_solver import ISDRWSPSolver, SolverInfeasibleError
from app.schemas import SolveRequestSchema

LEEWAY_LEVELS = (0.0, 1.0, 5.0, 10.0, 20.0, 50.0, 75.0)


def _solve(preset, leeway):
    return ISDRWSPSolver(
        SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=leeway,
        )
    ).solve()


def _longest_evening_run(solution) -> int:
    """The longest run of E across the roster read as one continuous cycle.

    Walked twice so a run spanning the end of the last line into the first is counted;
    a line's Sunday is followed by the next line's Monday, not by its own.
    """
    flat = [cell.shift_code for line in solution.roster_lines for cell in line.days]
    if not flat:
        return 0
    longest = run = 0
    for i in range(len(flat) * 2):
        if flat[i % len(flat)] == "E":
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    return min(longest, len(flat))


class EveningGuardrailTests(unittest.TestCase):
    def test_no_preset_exceeds_its_consecutive_evening_limit(self):
        for preset_id, preset in ARCHETYPE_PRESETS.items():
            limit = preset.guardrails.max_consecutive_evenings
            for leeway in LEEWAY_LEVELS:
                with self.subTest(preset=preset_id, leeway=leeway):
                    solution = _solve(preset, leeway)
                    self.assertLessEqual(
                        _longest_evening_run(solution),
                        limit,
                        f"{preset_id} at {leeway}% exceeds max_consecutive_evenings={limit}",
                    )

    def test_applying_the_guard_did_not_make_any_preset_infeasible(self):
        """The deferral's stated cost. It no longer applies, and this is what proves it."""
        for preset_id, preset in ARCHETYPE_PRESETS.items():
            for leeway in LEEWAY_LEVELS:
                with self.subTest(preset=preset_id, leeway=leeway):
                    try:
                        _solve(preset, leeway)
                    except SolverInfeasibleError as exc:
                        self.fail(f"{preset_id} at {leeway}% became infeasible: {exc}")


if __name__ == "__main__":
    unittest.main()
