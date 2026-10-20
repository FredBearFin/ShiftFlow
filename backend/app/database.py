"""Database session and repository management for ShiftFlow Studio SQLite entities."""

import json
import os
import sqlite3
from typing import Any, Dict, Generator, List, Optional
import uuid

# Durable SQLite file. Set SHIFTFLOW_DB_PATH to a path on a mounted volume in containers.
DB_FILE = os.environ.get(
    "SHIFTFLOW_DB_PATH",
    os.path.join("data", "shiftflow.db"),
)


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
        expires_at REAL
    );
    """)

    conn.commit()
    conn.close()


class SeparationAuditExistsError(Exception):
    """Raised when deleting an employee whose separation audit rows must be retained."""


class ShiftFlowRepository:
    """Repository handling CRUD operations for facilities, staff, rosters, and POS data."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # -------------------------------------------------------------
    # Facility Operations
    # -------------------------------------------------------------
    def get_facility(self, facility_id: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM facilities WHERE id = ?", (facility_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
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
                facility_id,
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
    def list_employees(self, facility_id: str, active_only: bool = False) -> List[Dict[str, Any]]:
        cursor = self.conn.cursor()
        if active_only:
            cursor.execute(
                "SELECT * FROM employees WHERE facility_id = ? AND active = 1 ORDER BY assigned_line ASC, name ASC",
                (facility_id,),
            )
        else:
            cursor.execute(
                "SELECT * FROM employees WHERE facility_id = ? ORDER BY active DESC, assigned_line ASC, name ASC",
                (facility_id,),
            )
        rows = cursor.fetchall()
        return [
            {
                "id": r["id"],
                "facility_id": r["facility_id"],
                "name": r["name"],
                "role": r["role"],
                "wage": float(r["wage"]),
                "active": bool(r["active"]),
                "available_days": json.loads(r["available_days_json"]),
                "assigned_line": r["assigned_line"],
                "accommodation_type": r["accommodation_type"] if "accommodation_type" in r.keys() else "none",
                "statutory_notes": r["statutory_notes"] if "statutory_notes" in r.keys() else None,
                "separation_category": r["separation_category"] if "separation_category" in r.keys() else None,
                "separation_reason": r["separation_reason"] if "separation_reason" in r.keys() else None,
                "separation_timestamp": r["separation_timestamp"] if "separation_timestamp" in r.keys() else None,
                "recorded_by": r["recorded_by"] if "recorded_by" in r.keys() else None,
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]

    def get_employee(self, employee_id: str) -> Optional[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM employees WHERE id = ?", (employee_id,))
        r = cursor.fetchone()
        if not r:
            return None
        return {
            "id": r["id"],
            "facility_id": r["facility_id"],
            "name": r["name"],
            "role": r["role"],
            "wage": float(r["wage"]),
            "active": bool(r["active"]),
            "available_days": json.loads(r["available_days_json"]),
            "assigned_line": r["assigned_line"],
            "accommodation_type": r["accommodation_type"] if "accommodation_type" in r.keys() else "none",
            "statutory_notes": r["statutory_notes"] if "statutory_notes" in r.keys() else None,
            "separation_category": r["separation_category"] if "separation_category" in r.keys() else None,
            "separation_reason": r["separation_reason"] if "separation_reason" in r.keys() else None,
            "separation_timestamp": r["separation_timestamp"] if "separation_timestamp" in r.keys() else None,
            "recorded_by": r["recorded_by"] if "recorded_by" in r.keys() else None,
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }

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
            (emp_id, facility_id, name, role, wage, json.dumps(available_days), assigned_line, accommodation_type, statutory_notes),
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
        assigned_line: Optional[int] = None,
        accommodation_type: Optional[str] = None,
        statutory_notes: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
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
        new_line = assigned_line if assigned_line is not None else existing["assigned_line"]
        new_accom = accommodation_type if accommodation_type is not None else existing.get("accommodation_type", "none")
        new_notes = statutory_notes if statutory_notes is not None else existing.get("statutory_notes")

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
        separation_category: str = "voluntary_resignation",
        separation_reason: str = "Employee voluntary separation",
        recorded_by: str = "Store Manager",
    ) -> Optional[Dict[str, Any]]:
        """Deactivates employee, unassigns line, and records contemporaneous legal separation audit."""
        emp = self.get_employee(employee_id)
        if not emp:
            return None
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

        # 2. Log immutable separation audit
        audit_id = f"SEP-{uuid.uuid4().hex[:8].upper()}"
        cursor.execute(
            """
            INSERT INTO separation_audits (id, employee_id, facility_id, employee_name, separation_category, separation_reason, recorded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            (audit_id, employee_id, emp["facility_id"], emp["name"], separation_category, separation_reason, recorded_by),
        )

        self.conn.commit()
        return self.get_employee(employee_id)

    def list_separation_audits(self, facility_id: str) -> List[Dict[str, Any]]:
        """Lists historical separation records for defense in wrongful termination / retaliation claims."""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM separation_audits WHERE facility_id = ? ORDER BY timestamp DESC",
            (facility_id,),
        )
        rows = cursor.fetchall()
        return [
            {
                "id": r["id"],
                "employee_id": r["employee_id"],
                "facility_id": r["facility_id"],
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
    # Roster Snapshots & Labor Audits (3-Year FLSA Retention)
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
            (snapshot_id, facility_id, week_number, rotation_offset, json.dumps(schedule_data)),
        )
        self.conn.commit()
        return snapshot_id

    def list_roster_snapshots(self, facility_id: str) -> List[Dict[str, Any]]:
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT id, facility_id, week_number, rotation_offset, created_at FROM roster_snapshots WHERE facility_id = ? ORDER BY created_at DESC",
            (facility_id,),
        )
        rows = cursor.fetchall()
        return [dict(r) for r in rows]

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
                facility_id,
                week_number,
                total_regular_hours,
                total_overtime_hours,
                total_payroll,
                json.dumps(daily_breakdown),
            ),
        )
        self.conn.commit()
        return analysis_id
