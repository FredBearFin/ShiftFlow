# Scope: what is active, what is switched off, what is a stub

No README line, marketing page or sales document may describe a module in the second or third table until it is implemented and tested. This file records what the code does today; it deletes nothing.

## Active (in the product described in the README)

| Module | Where | What it does |
|---|---|---|
| Schedule generator (solver) | `backend/app/engine/isd_rwsp_solver.py` | Builds a weekly rotating schedule from demand, templates and rules |
| Ergonomics scoring | `backend/app/engine/ergonomics.py` | Scores a schedule against eight strain checks and a rough 0 to 100 comfort score |
| Cost versus strain frontier | `backend/app/engine/pareto.py` | Re-solves at several staffing levels |
| Roster audit | `backend/app/engine/roster_audit.py`, `backend/app/audit_schemas.py` | Rule-based check of a repeating roster of 7 to 56 days; rules in `docs/audit_rules.md` |
| Rotation examples | `backend/app/engine/rotation_patterns.py` | Three 12-hour rotations checked for exact coverage |
| Solver-to-audit adapter | `backend/app/engine/solver_to_audit.py` | Lets the audit read the generator's output; backs the compare route |
| Archetypes (presets) | `backend/app/api/archetype_routes.py` | Starting profiles, 24/7 first |
| Schedules and audit routes | `backend/app/api/schedule_routes.py`, `backend/app/api/audit_routes.py` | Solve, frontier, CSV export, audit, compare |
| Accounts and login | `backend/app/api/auth_routes.py`, `backend/app/auth.py` | Email and password sessions |
| Facility configuration | `backend/app/api/facility_config_routes.py` | Saves the setup per facility |
| Employees | `backend/app/api/employee_routes.py` | Staff records that the generator can assign to lines |
| Owner access | `backend/app/api/owner_routes.py` | A manager can invite an owner to the same facility |

## Built but switched off by default (feature flags in `backend/app/config.py`)

| Module | Flag | Where |
|---|---|---|
| POS import and payroll export | `SHIFTFLOW_ENABLE_POS_INTEGRATION` | `backend/app/api/pos_payroll_routes.py`, `engine/pos_sync.py`, `engine/payroll_export.py`, `engine/timecard_audit.py` |
| Emergency workflows | `SHIFTFLOW_ENABLE_EMERGENCY_WORKFLOWS` | `backend/app/api/emergency_routes.py` |
| Shift handover | `SHIFTFLOW_ENABLE_SHIFT_HANDOVER` | `backend/app/api/handover_routes.py`, `engine/shift_handover.py` |

When a flag is off the routes answer 404.

## Stub or mostly not implemented

| Module | Status |
|---|---|
| Emergency routes | The two endpoints return HTTP 501: no stored shift or rest data to work from |
| Shift handover routes | The handover, checklist and till endpoints return HTTP 501: no source data is stored |
| Billing | `backend/app/api/billing_routes.py` is a checkout stub; no payment processor is called |

## Also true

- The interactive API documentation is off by default (`enable_api_docs` in `backend/app/config.py`).
- The audit route stores nothing and calls no outside service.
