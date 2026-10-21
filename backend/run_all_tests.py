"""Single test runner for the ShiftFlow Studio backend suite.

Every test module runs against its own temporary SQLite file. The file is
created before the module's tests start and removed after they finish, so no
module shares state with another and none touches /tmp/shiftflow.db.
"""

import importlib
import logging
import os
import sys
import tempfile
import unittest

import app.database as shiftflow_db
from app.tests import _modules

# Each module below deliberately runs against a throwaway file under /tmp, so init_db's
# "this database is not durable" warning is correct here and would just be 14 lines of
# noise in the gate output. One test asserts the warning still fires (see
# test_distributed_architecture.test_03c), which is why this silences the handler rather
# than removing the warning.
logging.getLogger("shiftflow.database").setLevel(logging.ERROR)


def run_module(name):
    """Runs one test module against a fresh temporary database."""
    module = importlib.import_module(f"app.tests.{name}")
    fd, db_path = tempfile.mkstemp(prefix=f"shiftflow_{name}_", suffix=".db")
    os.close(fd)
    previous_db = shiftflow_db.DB_FILE
    shiftflow_db.DB_FILE = db_path
    try:
        shiftflow_db.init_db()
        suite = unittest.defaultTestLoader.loadTestsFromModule(module)
        print(f"\n===== {name} (database: {db_path}) =====")
        return unittest.TextTestRunner(verbosity=2).run(suite)
    finally:
        shiftflow_db.DB_FILE = previous_db
        os.remove(db_path)


def main():
    results = [run_module(name) for name in _modules]
    ran = sum(r.testsRun for r in results)
    errors = sum(len(r.errors) for r in results)
    failures = sum(len(r.failures) for r in results)
    print(f"\nTOTAL: ran {ran} tests, {errors} errors, {failures} failures")
    if any(not r.wasSuccessful() for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
