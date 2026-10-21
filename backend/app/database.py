"""Database session and repository management for ShiftFlow Studio SQLite entities."""

import json
import logging
import os
import sqlite3
from typing import Any, Dict, Generator, List, Optional
import uuid

logger = logging.getLogger("shiftflow.database")

# Marks an update argument the caller did not pass, so an explicit None can clear a stored value.
_NOT_SENT = object()

# SQLite file. Set SHIFTFLOW_DB_PATH to a path on a mounted volume in containers.
#
# Serverless platforms (e.g. Vercel) only allow writes under /tmp, so that is the default
# there when no path is configured. THAT DEFAULT LOSES DATA. On a serverless platform /tmp
# is local to one function instance and does not survive a cold start, so:
#   - every row written through it can disappear without warning, and
#   - user accounts live in it too, so an account created on one instance is unknown to
#     another: a valid session cookie then fails the user-exists check in app/auth.py and
#     the person is signed out, or their sign-up appears to vanish.
# There is no code fix for this inside SQLite; it needs either a network database
# (PostgreSQL) or a deployment target with a persistent disk. See DEPLOYMENT_GUIDE.md
# section 5, "Data durability", for the options and what each one costs.
DB_FILE = os.environ.get(
    "SHIFTFLOW_DB_PATH",
    os.path.join("/tmp", "shiftflow.db") if os.environ.get("VERCEL") else os.path.join("data", "shiftflow.db"),
)


def db_is_ephemeral() -> bool:
    """True when the configured database file cannot be relied on to survive a restart.

    A path under /tmp is the case that matters: it is the serverless default and it is
    not durable. Reported by /health/readiness and warned about once at startup so an
    operator is not told everything is fine while their records are being thrown away.
    """
    return os.path.abspath(DB_FILE).startswith(os.path.abspath("/tmp") + os.sep)


def get_db_connection() -> sqlite3.Connection:
    """Creates a configured sqlite3 connection with dictionary row access."""
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def get_db() -> Generator[sqlite3.Connection, None, None]:
    """FastAPI dependency for yielding database connections."""
    conn = get_db_connection()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Initializes the SQLite schema if not already present."""
    if db_is_ephemeral():
        logger.warning(
            "ShiftFlow is storing its database at %s. On a serverless platform that path "
            "is local to one function instance and is lost on a cold start: schedules, "
            "staff records, separation audits and USER ACCOUNTS can all disappear without "
            "warning. Set SHIFTFLOW_DB_PATH to a persistent disk, or move to PostgreSQL. "
            "See DEPLOYMENT_GUIDE.md section 5.",
            DB_FILE,
        )
    db_dir = os.path.dirname(DB_FILE)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS facilities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        operating_hours TEXT NOT NULL,
        demand_matrix_json TEXT NOT NULL,
        shift_templates_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        wage REAL NOT NULL DEFAULT 16.50,
        active INTEGER NOT NULL DEFAULT 1,
        available_days_json TEXT NOT NULL,
        assigned_line INTEGER,
        accommodation_type TEXT NOT NULL DEFAULT 'none',
        statutory_notes TEXT,
        separation_category TEXT,
        separation_reason TEXT,
        separation_timestamp TEXT,
        recorded_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (facility_id) REFERENCES facilities(id)
    );

    CREATE TABLE IF NOT EXISTS separation_audits (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        facility_id TEXT NOT NULL,
        employee_name TEXT NOT NULL,
        separation_category TEXT NOT NULL,
        separation_reason TEXT NOT NULL,
        recorded_by TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS roster_snapshots (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        rotation_offset INTEGER NOT NULL DEFAULT 0,
        schedule_data_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (facility_id) REFERENCES facilities(id)
    );

    CREATE TABLE IF NOT EXISTS labor_analyses (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        week_number INTEGER NOT NULL,
        total_regular_hours REAL NOT NULL,
        total_overtime_hours REAL NOT NULL,
        total_payroll REAL NOT NULL,
        daily_breakdown_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (facility_id) REFERENCES facilities(id)
    );

    CREATE TABLE IF NOT EXISTS pos_transactions (
        id TEXT PRIMARY KEY,
        facility_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        day_of_week INTEGER NOT NULL,
        hour_of_day INTEGER NOT NULL,
        transaction_amount REAL NOT NULL,
        items_count INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (facility_id) REFERENCES facilities(id)
    );

    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        throttle_key TEXT NOT NULL,
        failed_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_failures_key ON login_failures (throttle_key, failed_at);

    CREATE TABLE IF NOT EXISTS idempotency_records (
        key TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status_code INTEGER,
        response_headers_json TEXT,
        response_body TEXT,
        in_flight INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at REAL,
        -- When the in-flight LOCK on this key expires, as distinct from expires_at, which
        -- is when the stored response stops being replayable. A row still marked in_flight
        -- past this time belonged to a process that died, and the lock is reclaimed. See
        -- IN_FLIGHT_LEASE_SECONDS in app/middleware.py.
        in_flight_expires_at REAL
    );
    """)

    # CREATE TABLE IF NOT EXISTS does not add columns to an existing employees
    # table, so add any employee columns that an older database is missing.
    existing_employee_columns = {
        row[1] for row in cursor.execute("PRAGMA table_info(employees)").fetchall()
    }
    employee_column_additions = {
        "accommodation_type": "TEXT NOT NULL DEFAULT 'none'",
        "statutory_notes": "TEXT",
        "separation_category": "TEXT",
        "separation_reason": "TEXT",
        "separation_timestamp": "TEXT",
        "recorded_by": "TEXT",
    }
    for column, definition in employee_column_additions.items():
        if column not in existing_employee_columns:
            cursor.execute(f"ALTER TABLE employees ADD COLUMN {column} {definition}")

    # Same for the in-flight lock lease on an existing idempotency table. Rows already
    # present get NULL, which app/middleware.py falls back to the record's own start time
    # for, so an orphan written before this column existed is still recoverable.
    existing_idempotency_columns = {
        row[1] for row in cursor.execute("PRAGMA table_info(idempotency_records)").fetchall()
    }
    if "in_flight_expires_at" not in existing_idempotency_columns:
        cursor.execute("ALTER TABLE idempotency_records ADD COLUMN in_flight_expires_at REAL")

    conn.commit()
    conn.close()


class SeparationAuditExistsError(Exception):
    """Raised when deleting an employee whose separation audit rows must be retained."""


class ShiftFlowRepository:
    """Repository handling CRUD operations for facilities, staff, rosters, and POS data.

    With owner_id set, the repository is scoped to one signed-in user. Facility ids that
    callers pass in and read back are the user's own ("FAC-OMAHA-01"); they are stored
    under an owner prefix so two accounts can use the same facility id without ever
    seeing each other's rows, and an employee id that belongs to another account behaves
    exactly like one that does not exist. With owner_id None (login explicitly disabled
    for local development) ids are stored as given.
    """

    def __init__(self, conn: sqlite3.Connection, owner_id: Optional[str] = None):
        self.conn = conn
        self.owner_id = owner_id

    # -------------------------------------------------------------
    # Owner scoping
    # -------------------------------------------------------------
    def _stored_facility_id(self, facility_id: str) -> str:
        return f"{self.owner_id}:{facility_id}" if self.owner_id else facility_id

    def _caller_facility_id(self, stored_facility_id: str) -> str:
        if self.owner_id:
            prefix = f"{self.owner_id}:"
            if stored_facility_id.startswith(prefix):
                return stored_facility_id[len(prefix):]
        return stored_facility_id

    def _owns_stored_facility(self, stored_facility_id: str) -> bool:
        if not self.owner_id:
            return True
        return stored_facility_id.startswith(f"{self.owner_id}:")

    # -------------------------------------------------------------
    # Facility Operations
    # -------------------------------------------------------------
    def get_facility(self, facility_id: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM facilities WHERE id = ?", (self._stored_facility_id(facility_id),))
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": self._caller_facility_id(row["id"]),
            "name": row["name"],
            "location": row["location"],
            "operating_hours": row["operating_hours"],
            "demand_matrix": json.loads(row["demand_matrix_json"]),
            "shift_templates": json.loads(row["shift_templates_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def upsert_facility(
        self,
        facility_id: str,
        name: str,
        location: str,
        operating_hours: str,
        demand_matrix: List[List[int]],
        shift_templates: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO facilities (id, name, location, operating_hours, demand_matrix_json, shift_templates_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                location = excluded.location,
                operating_hours = excluded.operating_hours,
                demand_matrix_json = excluded.demand_matrix_json,
                shift_templates_json = excluded.shift_templates_json,
                updated_at = CURRENT_TIMESTAMP;
            """,
            (
                self._stored_facility_id(facility_id),
                name,
                location,
                operating_hours,
                json.dumps(demand_matrix),
                json.dumps(shift_templates),
            ),
        )
        self.conn.commit()
        return self.get_facility(facility_id)  # type: ignore

    # -------------------------------------------------------------
    # Employee Operations (with Title VII/ADA Accommodations & Audit)
    # -------------------------------------------------------------
    def _employee_dict(self, r: sqlite3.Row) -> Dict[str, Any]:
        keys = r.keys()
        return {
            "id": r["id"],
            "facility_id": self._caller_facility_id(r["facility_id"]),
            "name": r["name"],
            "role": r["role"],
            "wage": float(r["wage"]),
            "active": bool(r["active"]),
            "available_days": json.loads(r["available_days_json"]),
            "assigned_line": r["assigned_line"],
            "accommodation_type": r["accommodation_type"] if "accommodation_type" in keys else "none",
            "statutory_notes": r["statutory_notes"] if "statutory_notes" in keys else None,
            "separation_category": r["separation_category"] if "separation_category" in keys else None,
            "separation_reason": r["separation_reason"] if "separation_reason" in keys else None,
            "separation_timestamp": r["separation_timestamp"] if "separation_timestamp" in keys else None,
            "recorded_by": r["recorded_by"] if "recorded_by" in keys else None,
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }

    def _employee_row(self, employee_id: str) -> Optional[sqlite3.Row]:
        """The raw employee row, or None when it does not exist or belongs to another account."""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM employees WHERE id = ?", (employee_id,))
        r = cursor.fetchone()
        if r is None or not self._owns_stored_facility(r["facility_id"]):
            return None
        return r

    def list_employees(self, facility_id: str, active_only: bool = False) -> List[Dict[str, Any]]:
        cursor = self.conn.cursor()
        stored_facility_id = self._stored_facility_id(facility_id)
        if active_only:
            cursor.execute(
                "SELECT * FROM employees WHERE facility_id = ? AND active = 1 ORDER BY assigned_line ASC, name ASC",
                (stored_facility_id,),
            )
        else:
            cursor.execute(
                "SELECT * FROM employees WHERE facility_id = ? ORDER BY active DESC, assigned_line ASC, name ASC",
                (stored_facility_id,),
            )
        return [self._employee_dict(r) for r in cursor.fetchall()]

    def get_employee(self, employee_id: str) -> Optional[Dict[str, Any]]:
        r = self._employee_row(employee_id)
        return self._employee_dict(r) if r is not None else None

    def create_employee(
        self,
        facility_id: str,
        name: str,
        role: str,
        wage: float,
        available_days: List[int],
        assigned_line: Optional[int] = None,
        accommodation_type: str = "none",
        statutory_notes: Optional[str] = None,
        employee_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        emp_id = employee_id or f"EMP-{uuid.uuid4().hex[:6].upper()}"
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO employees (id, facility_id, name, role, wage, active, available_days_json, assigned_line, accommodation_type, statutory_notes)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?);
            """,
            (
                emp_id,
                self._stored_facility_id(facility_id),
                name,
                role,
                wage,
                json.dumps(available_days),
                assigned_line,
                accommodation_type,
                statutory_notes,
            ),
        )
        self.conn.commit()
        return self.get_employee(emp_id)  # type: ignore

    def update_employee(
        self,
        employee_id: str,
        name: Optional[str] = None,
        role: Optional[str] = None,
        wage: Optional[float] = None,
        active: Optional[bool] = None,
        available_days: Optional[List[int]] = None,
        assigned_line: Any = _NOT_SENT,
        accommodation_type: Optional[str] = None,
        statutory_notes: Any = _NOT_SENT,
    ) -> Optional[Dict[str, Any]]:
        """Updates the given fields. Omitted args keep the stored value.

        assigned_line and statutory_notes accept an explicit None, which clears the stored value.
        """
        existing = self.get_employee(employee_id)
        if not existing:
            return None
        if active is False:
            # Separation requires a category, reason and recorder, so it is written only by deactivate_employee.
            raise ValueError("Use deactivate_employee to separate staff; update_employee cannot set active=False")

        new_name = name if name is not None else existing["name"]
        new_role = role if role is not None else existing["role"]
        new_wage = wage if wage is not None else existing["wage"]
        new_active = 1 if (active if active is not None else existing["active"]) else 0
        new_days = available_days if available_days is not None else existing["available_days"]
        new_line = existing["assigned_line"] if assigned_line is _NOT_SENT else assigned_line
        new_accom = accommodation_type if accommodation_type is not None else existing.get("accommodation_type", "none")
        new_notes = existing.get("statutory_notes") if statutory_notes is _NOT_SENT else statutory_notes

        cursor = self.conn.cursor()
        cursor.execute(
            """
            UPDATE employees
            SET name = ?, role = ?, wage = ?, active = ?, available_days_json = ?, assigned_line = ?, accommodation_type = ?, statutory_notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
            """,
            (new_name, new_role, new_wage, new_active, json.dumps(new_days), new_line, new_accom, new_notes, employee_id),
        )
        self.conn.commit()
        return self.get_employee(employee_id)

    def deactivate_employee(
        self,
        employee_id: str,
        separation_category: str,
        separation_reason: str,
        recorded_by: str,
    ) -> Optional[Dict[str, Any]]:
        """Deactivates employee, unassigns line, and records contemporaneous legal separation audit."""
        row = self._employee_row(employee_id)
        if row is None:
            return None
        emp = self._employee_dict(row)
        if not emp["active"]:
            # Already separated: no second audit row and no overwrite of the first record.
            return emp

        cursor = self.conn.cursor()
        # 1. Update employee record
        cursor.execute(
            """
            UPDATE employees
            SET active = 0, assigned_line = NULL, separation_category = ?, separation_reason = ?, separation_timestamp = CURRENT_TIMESTAMP, recorded_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?;
            """,
            (separation_category, separation_reason, recorded_by, employee_id),
        )

        # 2. Log the separation audit (stored under the same owner-scoped facility id as the
        # employee). No code path updates or deletes this row, and delete_employee refuses
        # while one exists, so it is append-only within the database. It is not "immutable"
        # in any stronger sense: it is as durable as the database file underneath it.
        audit_id = f"SEP-{uuid.uuid4().hex[:8].upper()}"
        cursor.execute(
            """
            INSERT INTO separation_audits (id, employee_id, facility_id, employee_name, separation_category, separation_reason, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            (audit_id, employee_id, row["facility_id"], emp["name"], separation_category, separation_reason, recorded_by),
        )

        self.conn.commit()
        return self.get_employee(employee_id)

    def list_separation_audits(self, facility_id: str) -> List[Dict[str, Any]]:
        """Lists historical separation records for defense in wrongful termination / retaliation claims."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM separation_audits WHERE facility_id = ? ORDER BY timestamp DESC",
            (self._stored_facility_id(facility_id),),
        )
        rows = cursor.fetchall()
        return [
            {
                "id": r["id"],
                "employee_id": r["employee_id"],
                "facility_id": self._caller_facility_id(r["facility_id"]),
                "employee_name": r["employee_name"],
                "separation_category": r["separation_category"],
                "separation_reason": r["separation_reason"],
                "recorded_by": r["recorded_by"],
                "timestamp": r["timestamp"],
            }
            for r in rows
        ]

    def delete_employee(self, employee_id: str) -> bool:
        """Deletes an employee record. Refused while separation audits exist (FLSA/Title VII retention)."""
        if self._employee_row(employee_id) is None:
            return False
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM separation_audits WHERE employee_id = ?", (employee_id,))
        if cursor.fetchone()[0] > 0:
            raise SeparationAuditExistsError(
                f"Employee {employee_id} has separation audit records and cannot be deleted"
            )
        cursor.execute("DELETE FROM employees WHERE id = ?", (employee_id,))
        self.conn.commit()
        return cursor.rowcount > 0

    # -------------------------------------------------------------
    # User Accounts
    # -------------------------------------------------------------
    def create_user(self, email: str, password_hash: str) -> Dict[str, Any]:
        user_id = f"USR-{uuid.uuid4().hex[:8].upper()}"
        cursor = self.conn.cursor()
        cursor.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?);",
            (user_id, email, password_hash),
        )
        self.conn.commit()
        return self.get_user_by_id(user_id)  # type: ignore

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    # -------------------------------------------------------------
    # Login throttling (failed sign-ins per email)
    # -------------------------------------------------------------
    def count_login_failures(self, throttle_key: str, since: float) -> int:
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM login_failures WHERE throttle_key = ? AND failed_at > ?",
            (throttle_key, since),
        )
        return int(cursor.fetchone()[0])

    def record_login_failure(self, throttle_key: str, now: float, prune_before: float) -> None:
        """Records one failed sign-in and drops failures older than prune_before, so the table stays small."""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM login_failures WHERE failed_at <= ?", (prune_before,))
        cursor.execute(
            "INSERT INTO login_failures (throttle_key, failed_at) VALUES (?, ?);",
            (throttle_key, now),
        )
        self.conn.commit()

    def clear_login_failures(self, throttle_key: str) -> None:
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM login_failures WHERE throttle_key = ?", (throttle_key,))
        self.conn.commit()

    # -------------------------------------------------------------
    # Roster snapshots and labor audits
    #
    # This section header used to read "(3-Year FLSA Retention)". Nothing here provides a
    # retention guarantee: rows live in one SQLite file whose durability is entirely a
    # property of where it is deployed, and on the serverless default (/tmp) they do not
    # survive a cold start at all. Snapshots are append-only in the sense that no code
    # path updates or deletes them, which is not the same as being immune to loss.
    # Retention is a deployment decision; see DEPLOYMENT_GUIDE.md section 5.
    # -------------------------------------------------------------
    def save_roster_snapshot(
        self,
        facility_id: str,
        week_number: int,
        rotation_offset: int,
        schedule_data: Dict[str, Any],
    ) -> str:
        snapshot_id = f"SNAP-{uuid.uuid4().hex[:8].upper()}"
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO roster_snapshots (id, facility_id, week_number, rotation_offset, schedule_data_json)
            VALUES (?, ?, ?, ?, ?);
            """,
            (snapshot_id, self._stored_facility_id(facility_id), week_number, rotation_offset, json.dumps(schedule_data)),
        )
        self.conn.commit()
        return snapshot_id

    def list_roster_snapshots(self, facility_id: str) -> List[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT id, facility_id, week_number, rotation_offset, created_at FROM roster_snapshots WHERE facility_id = ? ORDER BY created_at DESC",
            (self._stored_facility_id(facility_id),),
        )
        rows = cursor.fetchall()
        snapshots = [dict(r) for r in rows]
        for snap in snapshots:
            snap["facility_id"] = self._caller_facility_id(snap["facility_id"])
        return snapshots

    def get_latest_roster_snapshot(self, facility_id: str) -> Optional[Dict[str, Any]]:
        """Returns the most recently saved roster snapshot for a facility, or None.

        Read-only companion to save_roster_snapshot, for exports that must describe
        the schedule the manager saved rather than a fresh re-solve. Scoped through
        _stored_facility_id like every other read here, so one owner's snapshot is
        never visible to another.
        """
        cursor = self.conn.cursor()
        cursor.execute(
            """
            SELECT id, facility_id, week_number, rotation_offset, schedule_data_json, created_at
            FROM roster_snapshots
            WHERE facility_id = ?
            ORDER BY created_at DESC, rowid DESC
            LIMIT 1
            """,
            (self._stored_facility_id(facility_id),),
        )
        row = cursor.fetchone()
        if not row:
            return None
        try:
            schedule_data = json.loads(row["schedule_data_json"])
        except (json.JSONDecodeError, TypeError):
            # A snapshot we cannot parse is not a schedule. Report none rather
            # than let a caller treat corrupt JSON as the saved roster.
            return None
        return {
            "id": row["id"],
            "facility_id": self._caller_facility_id(row["facility_id"]),
            "week_number": row["week_number"],
            "rotation_offset": row["rotation_offset"],
            "schedule_data": schedule_data,
            "created_at": row["created_at"],
        }

    def save_labor_analysis(
        self,
        facility_id: str,
        week_number: int,
        total_regular_hours: float,
        total_overtime_hours: float,
        total_payroll: float,
        daily_breakdown: List[Dict[str, Any]],
    ) -> str:
        analysis_id = f"LABOR-{uuid.uuid4().hex[:8].upper()}"
        cursor = self.conn.cursor()
        cursor.execute(
            """
            INSERT INTO labor_analyses (id, facility_id, week_number, total_regular_hours, total_overtime_hours, total_payroll, daily_breakdown_json)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            (
                analysis_id,
                self._stored_facility_id(facility_id),
                week_number,
                total_regular_hours,
                total_overtime_hours,
                total_payroll,
                json.dumps(daily_breakdown),
            ),
        )
        self.conn.commit()
        return analysis_id
