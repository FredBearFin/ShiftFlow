"""Benchmark harness: synthetic instances solve, and no unverified citation is committed."""

import glob
import json
import math
import os
import sys
import unittest

_bench = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "benchmarks"))
sys.path.insert(0, _bench)
import runner  # noqa: E402

# Lower bound on lines worked out by hand in each instance's notes: ceil(shifts a week / 5).
HAND_BOUND = {"synthetic_flat1": 5, "synthetic_flat2": 9, "synthetic_weekday_day": 3}
WEEKLY_SHIFTS = {"synthetic_flat1": 21, "synthetic_flat2": 42, "synthetic_weekday_day": 15}


class SyntheticInstanceTests(unittest.TestCase):
    def test_three_instances_exist(self):
        """The three hand-checked instances are present."""
        names = {os.path.basename(p)[:-5] for p in glob.glob(os.path.join(_bench, "instances", "synthetic_*.json"))}
        self.assertEqual(names, set(HAND_BOUND))

    def test_hand_bounds_follow_from_the_shift_counts(self):
        """The bound in each note is ceil(weekly shifts / 5)."""
        for name, shifts in WEEKLY_SHIFTS.items():
            self.assertEqual(math.ceil(shifts / 5), HAND_BOUND[name])

    def test_instances_solve_at_zero_leeway_with_no_short_rest(self):
        """Each instance returns a feasible schedule with zero short-rest gaps; the gap to the hand bound is printed."""
        for name, bound in HAND_BOUND.items():
            with self.subTest(instance=name):
                inst = runner.load_instance(os.path.join(_bench, "instances", f"{name}.json"))
                row = runner.run_instance(inst)[0]
                self.assertNotIn("error", row)
                self.assertEqual(row["clopening"], 0)
                print(f"\n[benchmark] {name}: {row['employees']} lines against a hand bound of {bound} "
                      f"(gap {row['employees'] - bound}); understaffed {row['understaffed']} h")

    def test_runner_prints_a_table(self):
        """The table has a header and one row per leeway."""
        inst = runner.load_instance(os.path.join(_bench, "instances", "synthetic_weekday_day.json"))
        text = runner.format_table(inst["name"], runner.run_instance(inst))
        self.assertIn("leeway  employees", text)
        self.assertGreaterEqual(len(text.splitlines()), 9)


class PublishedResultsGuardTests(unittest.TestCase):
    def test_template_has_no_source_url(self):
        """A deliberately blunt guard: no citation URL is committed until the owner has verified a source.

        Remove this test when verified data is added to published_results.template.json.
        """
        with open(os.path.join(_bench, "published_results.template.json")) as fh:
            data = json.load(fh)
        for row in data["results"]:
            self.assertEqual(row["source_url"], "")


if __name__ == "__main__":
    unittest.main()
