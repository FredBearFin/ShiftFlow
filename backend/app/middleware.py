"""FastAPI Idempotency Key Middleware for ShiftFlow Studio Enterprise.

Guarantees exactly-once execution semantics for state-mutating HTTP operations
(POST, PUT, DELETE, PATCH), preventing duplicate emergency callouts, cashier
trades, employee terminations, or roster advancements during client/mobile
network retries or distributed broker redelivery.

Implemented as a pure ASGI middleware to guarantee zero-deadlock streaming compatibility.
"""

import hashlib
import json
import sqlite3
import threading
import time
from typing import Optional
from starlette.responses import Response, JSONResponse

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
                return dict(row)
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

        # Check existing record in persistence store
        record = IdempotencyStore.get_record(idempotency_key)
        if record:
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

        # Buffer the incoming request body
        body_messages = []
        request_body = b""
        more_body = True
        while more_body:
            msg = await receive()
            body_messages.append(msg)
            request_body += msg.get("body", b"")
            more_body = msg.get("more_body", False)

        body_hash = hashlib.sha256(request_body).hexdigest()
        started = IdempotencyStore.start_request(
            key=idempotency_key,
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
                            key=idempotency_key,
                            status_code=response_status,
                            response_headers=header_dict,
                            response_body=response_body.decode("utf-8", errors="replace"),
                        )
            else:
                await send(message)

        try:
            await self.app(scope, custom_receive, custom_send)
        except Exception:
            IdempotencyStore.clear_failed_request(idempotency_key)
            raise
