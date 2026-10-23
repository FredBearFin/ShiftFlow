"""FastAPI Idempotency Key Middleware for ShiftFlow Studio Enterprise.

Guarantees exactly-once execution semantics for state-mutating HTTP operations
(POST, PUT, DELETE, PATCH), preventing duplicate emergency callouts, cashier
trades, employee terminations, or roster advancements during client/mobile
network retries or distributed broker redelivery.

Implemented as a pure ASGI middleware to guarantee zero-deadlock streaming compatibility.
"""

import hashlib
import json
import os
import sqlite3
import threading
import time
from typing import Dict, Optional
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

from app.auth import cookie_secure, current_user_id, require_login
from app.config import settings
from app.database import get_db_connection


class IdempotencyStore:
    """Thread-safe and SQLite-backed idempotency persistence store."""

    _lock = threading.Lock()

    @classmethod
    def get_record(cls, key: str) -> Optional[dict]:
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT key, method, path, request_hash, status_code, response_headers_json, response_body, in_flight, created_at, expires_at FROM idempotency_records WHERE key = ?",
                    (key,),
                )
                row = cursor.fetchone()
                if not row:
                    return None
                record = dict(row)
                expires_at = record.get("expires_at")
                if expires_at is not None and expires_at < time.time():
                    cursor.execute("DELETE FROM idempotency_records WHERE key = ?", (key,))
                    conn.commit()
                    return None
                return record
            finally:
                conn.close()

    @classmethod
    def start_request(cls, key: str, method: str, path: str, request_hash: str, ttl_seconds: int = 86400) -> bool:
        """Attempts to register an in-flight request. Returns True if registered, False if collision."""
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT in_flight, created_at, expires_at FROM idempotency_records WHERE key = ?",
                    (key,),
                )
                row = cursor.fetchone()
                now = time.time()
                if row:
                    if row["in_flight"] == 1:
                        return False
                    return False

                expires_at = now + ttl_seconds
                cursor.execute(
                    """
                    INSERT INTO idempotency_records (key, method, path, request_hash, in_flight, created_at, expires_at)
                    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?);
                    """,
                    (key, method, path, request_hash, expires_at),
                )
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                return False
            finally:
                conn.close()

    @classmethod
    def complete_request(
        cls,
        key: str,
        status_code: int,
        response_headers: dict,
        response_body: str,
    ) -> None:
        """Stores the response and marks the key as complete."""
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    UPDATE idempotency_records
                    SET in_flight = 0,
                        status_code = ?,
                        response_headers_json = ?,
                        response_body = ?
                    WHERE key = ?;
                    """,
                    (status_code, json.dumps(response_headers), response_body, key),
                )
                conn.commit()
            finally:
                conn.close()

    @classmethod
    def clear_failed_request(cls, key: str) -> None:
        """Cleans up a failed in-flight request so client can retry."""
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM idempotency_records WHERE key = ? AND in_flight = 1", (key,))
                conn.commit()
            finally:
                conn.close()

    @classmethod
    def clear_all(cls) -> None:
        """Utility for test suite isolation."""
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM idempotency_records;")
                conn.commit()
            finally:
                conn.close()


class IdempotencyMiddleware:
    """Pure ASGI middleware intercepting mutating requests with Idempotency-Key header."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        if method not in ("POST", "PUT", "DELETE", "PATCH"):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        idempotency_key = None
        for h_key, h_val in headers.items():
            if h_key.lower() in (b"idempotency-key", b"x-idempotency-key"):
                idempotency_key = h_val.decode("utf-8")
                break

        if not idempotency_key:
            await self.app(scope, receive, send)
            return

        # Authenticate before any replay lookup or store write. Reuses the route dependency
        # (app.auth.require_login) so the login policy is defined in one place.
        try:
            require_login(Request(scope))
        except HTTPException as exc:
            resp = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
            await resp(scope, receive, send)
            return

        # With login on, each user's keys live in their own namespace, so one user can never
        # replay (or collide with) another user's stored response by reusing a key.
        owner_id = scope.get("state", {}).get("user_id")
        store_key = f"{owner_id}:{idempotency_key}" if owner_id else idempotency_key

        # Buffer the incoming request body and hash it, so a replay can be checked against the stored request
        body_messages = []
        request_body = b""
        more_body = True
        while more_body:
            msg = await receive()
            body_messages.append(msg)
            request_body += msg.get("body", b"")
            more_body = msg.get("more_body", False)

        body_hash = hashlib.sha256(request_body).hexdigest()

        # Check existing record in persistence store
        record = IdempotencyStore.get_record(store_key)
        if record:
            if (
                record["request_hash"] != body_hash
                or record["method"] != method
                or record["path"] != scope.get("path", "")
            ):
                resp = JSONResponse(
                    status_code=422,
                    content={
                        "error": "IdempotencyKeyReuseMismatch",
                        "detail": f"Idempotency-Key '{idempotency_key}' was already used with a different request body.",
                    },
                )
                await resp(scope, receive, send)
                return

            if record["in_flight"] == 1:
                resp = JSONResponse(
                    status_code=409,
                    content={
                        "error": "IdempotentRequestInFlight",
                        "detail": f"A request with Idempotency-Key '{idempotency_key}' is currently executing.",
                    },
                    headers={"Retry-After": "2"},
                )
                await resp(scope, receive, send)
                return

            stored_headers = json.loads(record["response_headers_json"] or "{}")
            stored_headers["X-Cache-Lookup"] = "HIT-IDEMPOTENT"
            stored_headers["Idempotency-Key"] = idempotency_key
            media_type = stored_headers.get("content-type", "application/json")
            resp = Response(
                content=record["response_body"],
                status_code=record["status_code"],
                headers=stored_headers,
                media_type=media_type,
            )
            await resp(scope, receive, send)
            return

        started = IdempotencyStore.start_request(
            key=store_key,
            method=method,
            path=scope.get("path", ""),
            request_hash=body_hash,
        )
        if not started:
            resp = JSONResponse(
                status_code=409,
                content={
                    "error": "IdempotentRequestInFlight",
                    "detail": f"A concurrent request with Idempotency-Key '{idempotency_key}' was detected.",
                },
                headers={"Retry-After": "2"},
            )
            await resp(scope, receive, send)
            return

        msg_idx = 0

        async def custom_receive():
            nonlocal msg_idx
            if msg_idx < len(body_messages):
                m = body_messages[msg_idx]
                msg_idx += 1
                return m
            return {"type": "http.request", "body": b"", "more_body": False}

        response_status = 200
        response_headers = []
        response_body = b""

        async def custom_send(message):
            nonlocal response_status, response_headers, response_body
            if message["type"] == "http.response.start":
                response_status = message["status"]
                response_headers = list(message.get("headers", []))
                response_headers.append((b"x-cache-lookup", b"MISS-STORED"))
                response_headers.append((b"idempotency-key", idempotency_key.encode("utf-8")))
                message["headers"] = response_headers
                await send(message)
            elif message["type"] == "http.response.body":
                response_body += message.get("body", b"")
                await send(message)
                if not message.get("more_body", False):
                    if response_status < 500:
                        header_dict = {k.decode("utf-8"): v.decode("utf-8") for k, v in response_headers}
                        header_dict.pop("content-length", None)
                        header_dict.pop("x-cache-lookup", None)
                        header_dict.pop("X-Cache-Lookup", None)
                        header_dict.pop("idempotency-key", None)
                        header_dict.pop("Idempotency-Key", None)
                        IdempotencyStore.complete_request(
                            key=store_key,
                            status_code=response_status,
                            response_headers=header_dict,
                            response_body=response_body.decode("utf-8", errors="replace"),
                        )
                    else:
                        IdempotencyStore.clear_failed_request(store_key)
            else:
                await send(message)

        try:
            await self.app(scope, custom_receive, custom_send)
        except Exception:
            IdempotencyStore.clear_failed_request(store_key)
            raise


class SecurityHeadersMiddleware:
    """Pure ASGI middleware adding baseline security headers to every response.

    Scoped to headers that are safe to apply uniformly across the JSON API and
    the docs pages, without needing to know any one route's content:

    - X-Content-Type-Options: nosniff - stops a browser from sniffing a
      response's type away from its declared Content-Type.
    - X-Frame-Options / Content-Security-Policy (frame-ancestors) - stops this
      origin's pages (sign-in, sign-up, and the pricing-page checkout in
      app/api/billing_routes.py) from being embedded in another site's iframe
      for a clickjacking attack.
    - Referrer-Policy - keeps the full request path out of the Referer header
      sent to third-party links.
    - Strict-Transport-Security - only sent when SHIFTFLOW_COOKIE_SECURE is on
      (the operator's own signal that this deployment is reached over https);
      skipped otherwise so a plain-http deployment is never told to upgrade.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def add_security_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-content-type-options", b"nosniff"))
                headers.append((b"x-frame-options", b"DENY"))
                headers.append((b"content-security-policy", b"frame-ancestors 'none'"))
                headers.append((b"referrer-policy", b"strict-origin-when-cross-origin"))
                if cookie_secure():
                    headers.append(
                        (b"strict-transport-security", b"max-age=63072000; includeSubDomains")
                    )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, add_security_headers)


def _max_concurrent_solves_per_caller() -> int:
    """How many solver requests one account may have in flight at once.

    Overridable via SHIFTFLOW_MAX_CONCURRENT_SOLVES_PER_CALLER for ops tuning;
    defaults to 2, which is generous for normal interactive use (a user
    comparing two archetypes side by side) while still bounding how much of
    the shared solver threadpool any single account can occupy.
    """
    raw = os.environ.get("SHIFTFLOW_MAX_CONCURRENT_SOLVES_PER_CALLER", "")
    try:
        value = int(raw)
        if value > 0:
            return value
    except ValueError:
        pass
    return 2


class SolveConcurrencyLimitMiddleware:
    """Caps concurrent in-flight requests to the solver endpoints, per caller.

    /api/.../schedules/solve, /pareto-frontier, /export-csv and
    /default-solution/* all run the real ISD-RWSP optimization engine
    synchronously, so FastAPI executes each one on a worker thread from
    Starlette's shared threadpool. A security audit measured a single
    authenticated account firing ~30 concurrent /solve requests driving a
    normally ~0.1s solve up to ~3.6s each, and an unrelated /health check
    issued during that storm up to ~3.7s (vs. ~3ms idle) - i.e. one account,
    even a free tier one, can starve the threadpool and degrade every other
    tenant on the same backend process, with no rate limiting previously in
    place (see app/resilience.py, which covers DB retries/circuit-breaking
    only, not request throughput).

    This bounds concurrency per caller instead of queueing or throttling
    globally, so one noisy account gets fast 429s instead of slowing down
    everyone else. The caller is identified by their signed-in user id
    (never a client-supplied header, so one account cannot dodge or frame
    another's limit); when login is disabled (local dev only) it falls back
    to the client's host.
    """

    _lock = threading.Lock()
    _in_flight: Dict[str, int] = {}

    _EXACT_PATHS = {
        f"{settings.api_prefix}/schedules/solve",
        f"{settings.api_prefix}/schedules/pareto-frontier",
        f"{settings.api_prefix}/schedules/export-csv",
        f"{settings.api_prefix}/schedules/audit/compare",  # runs a solve
    }
    _PREFIX_PATH = f"{settings.api_prefix}/schedules/default-solution/"

    def __init__(self, app):
        self.app = app

    @classmethod
    def _is_solve_path(cls, path: str) -> bool:
        return path in cls._EXACT_PATHS or path.startswith(cls._PREFIX_PATH)

    @classmethod
    def _caller_key(cls, request: Request) -> str:
        user_id = current_user_id(request)
        if user_id:
            return f"user:{user_id}"
        client = request.client
        return f"ip:{client.host if client else 'unknown'}"

    @classmethod
    def _release(cls, key: str) -> None:
        with cls._lock:
            remaining = cls._in_flight.get(key, 1) - 1
            if remaining <= 0:
                cls._in_flight.pop(key, None)
            else:
                cls._in_flight[key] = remaining

    @classmethod
    def clear_all(cls) -> None:
        """Test-suite isolation helper, mirroring IdempotencyStore.clear_all."""
        with cls._lock:
            cls._in_flight.clear()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self._is_solve_path(scope.get("path", "")):
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        key = self._caller_key(request)
        limit = _max_concurrent_solves_per_caller()

        with self._lock:
            count = self._in_flight.get(key, 0)
            if count >= limit:
                resp = JSONResponse(
                    status_code=429,
                    content={
                        "error": "TooManyConcurrentSolveRequests",
                        "detail": (
                            f"Too many schedule-solve requests in flight for this account "
                            f"(max {limit} concurrent). Wait for one to finish, then retry."
                        ),
                    },
                    headers={"Retry-After": "1"},
                )
                await resp(scope, receive, send)
                return
            self._in_flight[key] = count + 1

        try:
            await self.app(scope, receive, send)
        finally:
            self._release(key)
