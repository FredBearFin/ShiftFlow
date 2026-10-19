"""Engine package for ShiftFlow Studio."""

import importlib.machinery
import importlib.util
import os
import sys

_engine_dir = os.path.dirname(os.path.abspath(__file__))
_modules = ["isd_rwsp_solver", "ergonomics", "pareto", "pos_sync", "payroll_export"]

for _mod in _modules:
    _fpath = os.path.join(_engine_dir, f"{_mod}.py")
    _mod_name = f"app.engine.{_mod}"
    if os.path.exists(_fpath) and _mod_name not in sys.modules:
        _loader = importlib.machinery.SourceFileLoader(_mod_name, _fpath)
        _spec = importlib.util.spec_from_loader(_mod_name, _loader)
        if _spec:
            _module = importlib.util.module_from_spec(_spec)
            sys.modules[_mod_name] = _module
            setattr(sys.modules[__name__], _mod, _module)
            _loader.exec_module(_module)
