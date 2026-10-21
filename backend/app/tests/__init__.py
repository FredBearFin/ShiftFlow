"""Automated Unit and Integration Test Suite for ShiftFlow Studio."""

import importlib.machinery
import importlib.util
import os
import sys

_tests_dir = os.path.dirname(os.path.abspath(__file__))

# The app fails closed: login is on unless explicitly disabled. Most tests exercise routes,
# not accounts, so they run with login disabled. Tests that need login (test_auth,
# test_tenant_isolation) set their own SHIFTFLOW_SESSION_SECRET, which turns login on.
os.environ["SHIFTFLOW_AUTH_DISABLED"] = "1"

_modules = [
    "test_solver",
    "test_persistence_and_integrations",
    "test_legal_compliance",
    "test_emergency_workflows",
    "test_distributed_architecture",
    "test_idempotency",
    "test_timecard_audit",
    "test_auth",
    "test_tenant_isolation",
    "test_input_validation",
    "test_solver_contracts",
    "test_pos_payroll_routes",
    "test_payroll_uses_saved_schedule",
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
