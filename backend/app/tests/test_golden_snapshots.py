"""Golden snapshots of preset solves.

Freezes what the solver produces today so any later change to schedules is visible.
Regenerate (app/tests/golden/regenerate.py) only with owner approval and only in a work
package that states which snapshot changes and why.
"""

import importlib.util
import json
import os
import unittest

from app.api.archetype_routes import ARCHETYPE_PRESETS

_golden_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden")
_spec = importlib.util.spec_from_file_location("golden_regenerate", os.path.join(_golden_dir, "regenerate.py"))
_regen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_regen)


class GoldenSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(_regen.GOLDEN_PATH) as fh:
            cls.golden = json.load(fh)

    def test_every_preset_and_leeway_matches(self):
        for key, preset in ARCHETYPE_PRESETS.items():
            for leeway in _regen.LEEWAYS:
                with self.subTest(preset=key, leeway=leeway):
                    expected = self.golden["solves"][key][str(leeway)]
                    actual = json.loads(json.dumps(_regen.snapshot_solve(preset, leeway)))
                    self.assertEqual(actual, expected)

    def test_golden_covers_every_preset(self):
        self.assertEqual(set(self.golden["solves"]), set(ARCHETYPE_PRESETS))

    def test_pareto_frontier_matches(self):
        key = _regen.FRONTIER_PRESET
        actual = json.loads(
            json.dumps(_regen.snapshot_frontier(ARCHETYPE_PRESETS[key], _regen.FRONTIER_SELECTED_LEEWAY))
        )
        self.assertEqual(actual, self.golden["frontier"][key])


if __name__ == "__main__":
    unittest.main()
