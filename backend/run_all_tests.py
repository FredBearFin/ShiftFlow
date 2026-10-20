"""Test runner executing the complete ShiftFlow Studio automated test suite."""

import sys
import unittest

import app.tests.test_solver
import app.tests.test_persistence_and_integrations
import app.tests.test_legal_compliance
import app.tests.test_emergency_workflows
import app.tests.test_distributed_architecture
import app.tests.test_chaos_resilience
import app.tests.test_timecard_audit
import app.tests.test_shift_handover


def main():
    suite = unittest.TestSuite()
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_solver))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_persistence_and_integrations))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_legal_compliance))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_emergency_workflows))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_distributed_architecture))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_chaos_resilience))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_timecard_audit))
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(app.tests.test_shift_handover))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    main()
