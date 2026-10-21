"""Creates a ShiftFlow Studio account from the command line.

Use this when SHIFTFLOW_ALLOW_SIGNUP=false (public sign-up closed). From the backend directory:

    python -m app.create_user someone@example.com

The password is prompted for, never passed on the command line. In Docker:

    docker compose exec backend python -m app.create_user someone@example.com
"""

import getpass
import re
import sys

from app.auth import hash_password
from app.database import ShiftFlowRepository, get_db_connection, init_db

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def main(argv: list) -> int:
    if len(argv) != 2:
        print("Usage: python -m app.create_user EMAIL", file=sys.stderr)
        return 2
    email = argv[1].strip().lower()
    if not _EMAIL_RE.match(email):
        print("Enter a valid email address.", file=sys.stderr)
        return 2

    password = getpass.getpass("Password (at least 8 characters): ")
    if len(password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 2
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 2

    init_db()
    conn = get_db_connection()
    try:
        repo = ShiftFlowRepository(conn)
        if repo.get_user_by_email(email):
            print(f"An account for {email} already exists.", file=sys.stderr)
            return 1
        repo.create_user(email, hash_password(password))
    finally:
        conn.close()
    print(f"Created account for {email}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
