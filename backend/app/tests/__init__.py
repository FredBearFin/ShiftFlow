"""Automated Unit and Integration Test Suite for ShiftFlow Studio."""

import importlib.machinery
import importlib.util
import os
import sys

_tests_dir = os.path.dirname(os.path.abspath(__file__))

# Every test client sends this key. The app reads SHIFTFLOW_API_KEY per request.
TEST_API_KEY = "test-api-key-not-for-production"
TEST_HEADERS = {"X-API-Key": TEST_API_KEY}
os.environ["SHIFTFLOW_API_KEY"] = TEST_API_KEY

_modules = [
    "test_solver",
    "test_persistence_and_integrations",
    "test_legal_compliance",
    "test_emergency_workflows",
    "test_distributed_architecture",
    "test_idempotency",
    "test_chaos_resilience",
    "test_timecard_audit",
    "test_shift_handover",
    "test_auth",
    "test_input_validation",
    "test_solver_contracts",
]

for _mod in _modules:
    _fpath = os.path.join(_tests_dir, f"{_mod}.py")
    _mod_name = f"app.tests.{_mod}"
    if os.path.exists(_fpath) and _mod_name not in sys.modules:
        _loader = importlib.machinery.SourceFileLoader(_mod_name, _fpath)
        _spec = importlib.util.spec_from_loader(_mod_name, _loader)
        if _spec:
            _module = importlib.util.module_from_spec(_spec)
            sys.modules[_mod_name] = _module
            setattr(sys.modules[__name__], _mod, _module)
            _loader.exec_module(_module)
