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

# POS integration, emergency workflows and shift handover are off by default outside the
# V1 product surface (see app/config.py), but several existing tests across this suite
# exercise those routes directly (not just test_pos_payroll_routes.py / test_emergency_
# workflows.py / test_shift_handover.py, which also toggle `settings` themselves). Default
# them on for the whole test session so those routes behave as before rather than 404ing.
# This mutates the already-constructed `settings` singleton (app/__init__.py imports
# app.config, constructing it, before this module runs) rather than setting the
# SHIFTFLOW_ENABLE_* env vars, which would be read too late to matter.
from app.config import settings as _settings  # noqa: E402

_settings.enable_pos_integration = True
_settings.enable_emergency_workflows = True
_settings.enable_shift_handover = True

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
    "test_tenant_isolation",
    "test_input_validation",
    "test_solver_contracts",
    "test_pos_payroll_routes",
    "test_golden_snapshots",
    "test_min_rest_guardrail",
    "test_coverage_fidelity",
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
