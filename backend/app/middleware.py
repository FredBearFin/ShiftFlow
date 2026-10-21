"""FastAPI Idempotency Key Middleware for ShiftFlow Studio Enterprise.

Guarantees exactly-once execution semantics for state-mutating HTTP operations
(POST, PUT, DELETE, PATCH), preventing duplicate emergency callouts, cashier
trades, employee terminations, or roster advancements during client/mobile
network retries or distributed broker redelivery.

Implemented as a pure ASGI middleware to guarantee zero-deadlock streaming compatibility.

A key held by a request that never finished is reclaimed after
IN_FLIGHT_LEASE_SECONDS, so a process killed mid-mutation does not lock that key out
for the whole 24-hour record TTL. See IdempotencyStore below.
"""

import hashlib
import json
import logging
import sqlite3
import threading
import time
from typing import Optional
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response, JSONResponse

from app.auth import require_login
from app.database import get_db_connection

logger = logging.getLogger("shiftflow.idempotency")

# How long a stored response stays replayable under its key.
DEFAULT_RECORD_TTL_SECONDS = 86400


# How long one in-flight request may hold its key before the lock is presumed orphaned.
#
# The record itself lives for ttl_seconds (24h by default) so a completed response can be
# replayed. The LOCK is a separate, much shorter lease. Without it, a process killed
# mid-request left in_flight = 1 for the full 24 hours and every retry of that key got 409
# for a day - the "Orphan In-Flight Mutation Lock Recovery" the old resilience.py docstring
# promised but never contained.
#
# 120s is above any request this app can legitimately take (the longest work it does is a
# solve, which is milliseconds on the bundled presets) and far below the record TTL, so a
# genuinely concurrent duplicate is still refused while a crashed one recovers quickly.
IN_FLIGHT_LEASE_SECONDS = 120


class IdempotencyStore:
    """Thread-safe and SQLite-backed idempotency persistence store.

    The thread lock below serialises this process only. Two processes serving the same
    database still race, and the SQLite primary key on `key` is what actually prevents a
    double insert, so start_request treats an IntegrityError as a lost race.

    Keys arrive already namespaced per user by the caller (see store_key in
    IdempotencyMiddleware). Everything here treats `key` as opaque, so that namespacing
    is preserved whatever it contains.
    """

    _lock = threading.Lock()

    @staticmethod
    def _lock_is_stale(record: dict, now: float) -> bool:
        """True when this record claims to be in flight but its lease has run out."""
        if record.get("in_flight") != 1:
            return False
        lease = record.get("in_flight_expires_at")
        if lease is None:
            # Written before the lease column existed. Fall back to the record's own
            # start time, which is expires_at minus the TTL it was created with.
            expires_at = record.get("expires_at")
            if expires_at is None:
                return False
            lease = (expires_at - DEFAULT_RECORD_TTL_SECONDS) + IN_FLIGHT_LEASE_SECONDS
        return lease < now

    @classmethod
    def get_record(cls, key: str) -> Optional[dict]:
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT key, method, path, request_hash, status_code, response_headers_json, response_body, in_flight, created_at, expires_at, in_flight_expires_at FROM idempotency_records WHERE key = ?",
                    (key,),
                )
                row = cursor.fetchone()
                if not row:
                    return None
                record = dict(row)
                now = time.time()
                expires_at = record.get("expires_at")
                if expires_at is not None and expires_at < now:
                    cursor.execute("DELETE FROM idempotency_records WHERE key = ?", (key,))
                    conn.commit()
                    return None
                if cls._lock_is_stale(record, now):
                    # The process that held this key died before completing or clearing
                    # it. Drop the orphan so the caller can retry now instead of being
                    # told "already executing" until the 24-hour TTL expires. No response
                    # was ever stored under it, so nothing replayable is lost.
                    logger.warning(
                        "Reclaiming orphaned idempotency lock for key %r on %s %s: "
                        "in flight for more than %ss with no result.",
                        key,
                        record.get("method"),
                        record.get("path"),
                        IN_FLIGHT_LEASE_SECONDS,
                    )
                    cursor.execute(
                        "DELETE FROM idempotency_records WHERE key = ? AND in_flight = 1", (key,)
                    )
                    conn.commit()
                    return None
                return record
            finally:
                conn.close()

    @classmethod
    def start_request(
        cls,
        key: str,
        method: str,
        path: str,
        request_hash: str,
        ttl_seconds: int = DEFAULT_RECORD_TTL_SECONDS,
    ) -> bool:
        """Registers an in-flight request. True if this caller owns the key, False on collision.

        An existing record whose in-flight lease has run out is reclaimed rather than
        treated as a collision, so a key orphaned by a killed process becomes usable again
        after IN_FLIGHT_LEASE_SECONDS instead of after the record TTL.
        """
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT in_flight, created_at, expires_at, in_flight_expires_at FROM idempotency_records WHERE key = ?",
                    (key,),
                )
                row = cursor.fetchone()
                now = time.time()
                lease_expires_at = now + IN_FLIGHT_LEASE_SECONDS
                if row:
                    if not cls._lock_is_stale(dict(row), now):
                        # Either genuinely running right now, or already completed and
                        # replayable. Neither is this caller's to take.
                        return False
                    logger.warning(
                        "Taking over orphaned idempotency lock for key %r on %s %s.", key, method, path
                    )
                    cursor.execute(
                        """
                        UPDATE idempotency_records
                        SET method = ?, path = ?, request_hash = ?, in_flight = 1,
                            status_code = NULL, response_headers_json = NULL, response_body = NULL,
                            created_at = CURRENT_TIMESTAMP, expires_at = ?, in_flight_expires_at = ?
                        WHERE key = ? AND in_flight = 1;
                        """,
                        (method, path, request_hash, now + ttl_seconds, lease_expires_at, key),
                    )
                    conn.commit()
                    return cursor.rowcount == 1

                cursor.execute(
                    """
                    INSERT INTO idempotency_records (key, method, path, request_hash, in_flight, created_at, expires_at, in_flight_expires_at)
                    VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?, ?);
                    """,
                    (key, method, path, request_hash, now + ttl_seconds, lease_expires_at),
                )
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                # Another process inserted the same key between the SELECT and the INSERT.
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
        """Stores the response, marks the key complete, and releases the in-flight lease."""
        with cls._lock:
            conn = get_db_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    UPDATE idempotency_records
                    SET in_flight = 0,
                        in_flight_expires_at = NULL,
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
