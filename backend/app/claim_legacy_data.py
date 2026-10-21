"""Assigns facility data created before per-user accounts to one user.

Before accounts were isolated, facilities, staff, audits and rosters were stored under plain
facility ids such as "FAC-OMAHA-01". With login on, every signed-in user only sees rows stored
under their own prefix, so that older data would be invisible to everyone. Run this once, as
the user who should own it. From the backend directory:

    python -m app.claim_legacy_data someone@example.com

In Docker:

    docker compose exec backend python -m app.claim_legacy_data someone@example.com

Rows that already belong to an account are left alone, so it is safe to run again.
"""

import sqlite3
import sys
from typing import Dict

from app.database import ShiftFlowRepository, get_db_connection, init_db

# (table, column holding the facility id). Order does not matter: foreign keys are off while renaming.
_FACILITY_COLUMNS = (
    ("facilities", "id"),
    ("employees", "facility_id"),
    ("separation_audits", "facility_id"),
    ("roster_snapshots", "facility_id"),
    ("assignment_shifts", "facility_id"),
    ("labor_analyses", "facility_id"),
    ("pos_transactions", "facility_id"),
)

# Ids already owned by an account look like "USR-1A2B3C4D:FAC-OMAHA-01".
_OWNED_PATTERN = "USR-%:%"


def claim_legacy_data(conn: sqlite3.Connection, user_id: str) -> Dict[str, int]:
    """Moves every un-owned facility row to user_id. Returns how many rows moved per table."""
    prefix = f"{user_id}:"
    # Renaming a parent key needs foreign keys off; this must happen outside a transaction.
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF;")
    try:
        moved: Dict[str, int] = {}
        for table, column in _FACILITY_COLUMNS:
            cursor = conn.execute(
                f"UPDATE {table} SET {column} = ? || {column} WHERE {column} NOT LIKE ?",
                (prefix, _OWNED_PATTERN),
            )
            moved[table] = cursor.rowcount
        broken = conn.execute("PRAGMA foreign_key_check;").fetchall()
        if broken:
            conn.rollback()
            raise RuntimeError(f"Renaming would leave {len(broken)} broken references; nothing was changed.")
        conn.commit()
        return moved
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON;")


def main(argv: list) -> int:
    if len(argv) != 2:
        print("Usage: python -m app.claim_legacy_data EMAIL", file=sys.stderr)
        return 2
    email = argv[1].strip().lower()

    init_db()
    conn = get_db_connection()
    try:
        user = ShiftFlowRepository(conn).get_user_by_email(email)
        if not user:
            print(f"No account for {email}. Create it first (sign up, or python -m app.create_user).", file=sys.stderr)
            return 1
        moved = claim_legacy_data(conn, user["id"])
    finally:
        conn.close()

    total = sum(moved.values())
    if total == 0:
        print("Nothing to claim: no facility data without an owner.")
    else:
        print(f"Assigned {total} rows to {email}: " + ", ".join(f"{t} {n}" for t, n in moved.items() if n))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
