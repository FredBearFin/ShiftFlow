"""Shared pytest fixtures.

Every test's TestClient reaches the app through request.client.host == "testclient" -
there is no way for two tests in the same run to look like different IPs. Several existing
tests (test_facility_owners.py, test_tenant_isolation.py, etc.) sign up several throwaway
accounts each to set up manager/owner/stranger scenarios. Once signup is throttled per
client IP (SIGNUP_MAX_ATTEMPTS_PER_IP in app/api/auth_routes.py), those accumulate against
one shared "testclient" bucket across the whole test run - and because the backing table
lives in the same on-disk sqlite file tests normally use, they also accumulate across
separate pytest invocations within the same real-world hour. Clearing the throttle state
before every test keeps each test's signups scoped to itself, the same way a real deployment
sees them scoped to one physical IP, without weakening the limit itself.
"""

import pytest

from app.database import get_db_connection, init_db

init_db()


@pytest.fixture(autouse=True)
def _reset_ip_and_email_throttles():
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM signup_attempts")
        conn.execute("DELETE FROM login_failures WHERE throttle_key LIKE 'pwreset:%'")
        conn.commit()
    finally:
        conn.close()
    yield
