"""FastAPI application entrypoint for ShiftFlow Studio."""

import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.archetype_routes import router as archetype_router
from app.api.schedule_routes import router as schedule_router
from app.api.employee_routes import router as employee_router
from app.api.pos_payroll_routes import router as pos_payroll_router
from app.api.emergency_routes import router as emergency_router
from app.api.handover_routes import router as handover_router
from app.api.auth_routes import router as auth_router
from app.auth import require_login, validate_auth_config
from app.config import settings
from app.database import init_db, get_db_connection
from fastapi.responses import JSONResponse
from app.engine.isd_rwsp_solver import SolverInfeasibleError
from app.middleware import IdempotencyMiddleware

APP_START_TIME = time.time()

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://localhost:3000"


def current_environment() -> str:
    """The environment this process is actually running in, as the operator declared it.

    SHIFTFLOW_ENV is the documented name; APP_ENV is accepted because docker-compose.yml
    already passes it. Unset means nobody declared one, and "development" is the safe
    thing to say then — /health previously answered "production" unconditionally, which
    told an operator checking which deployment they had reached exactly nothing.
    """
    declared = os.environ.get("SHIFTFLOW_ENV") or os.environ.get("APP_ENV") or ""
    return declared.strip() or "development"


# Startup runs validate_auth_config() BEFORE init_db(). That order is load-bearing: a
# deployment with login on but no usable SHIFTFLOW_SESSION_SECRET must refuse to boot
# before it touches, creates or migrates any database. test_auth.py asserts the refusal.
@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_auth_config()
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Build and compare weekly staff rotations, balancing payroll cost against workload strain.",
    dependencies=[Depends(require_login)],
    lifespan=lifespan,
)

cors_origins = [
    origin.strip()
    for origin in os.environ.get("SHIFTFLOW_CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)

# Idempotency Middleware for exactly-once mutation semantics
app.add_middleware(IdempotencyMiddleware)


@app.exception_handler(SolverInfeasibleError)
def solver_infeasible_handler(request, exc: SolverInfeasibleError):
    """Reports a schedule the solver cannot build from the given constraints, instead of relaxing them."""
    return JSONResponse(status_code=422, content={"detail": str(exc)})


app.include_router(archetype_router, prefix=settings.api_prefix)
app.include_router(schedule_router, prefix=settings.api_prefix)
app.include_router(employee_router)
app.include_router(pos_payroll_router)
app.include_router(emergency_router)
app.include_router(handover_router)
app.include_router(auth_router)


@app.get("/health", tags=["System"])
def health_check() -> dict:
    """Reports the app name, version, declared environment and scheduling parameters."""
    from app.api.archetype_routes import ARCHETYPE_PRESETS

    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "version": settings.version,
        "environment": current_environment(),
        # The real registered preset ids. This previously listed five ids
        # ("24_7_continuous_retail" and friends) that match no preset in the app.
        "supported_archetypes": sorted(ARCHETYPE_PRESETS),
        "default_safe_rest_hours": float(settings.min_rest_hours_between_shifts),
        "clopening_forbidden": True,
    }


@app.get("/health/liveness", tags=["System"])
def kubernetes_liveness() -> dict:
    """Production Kubernetes liveness probe - fast return confirming event loop responsive."""
    return {
        "status": "alive",
        "uptime_seconds": round(time.time() - APP_START_TIME, 2),
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
    }


def _check_solver_engine() -> dict:
    """Healthy only if ISDRWSPSolver imports and can be constructed from a valid request."""
    engine = "ShiftFlow rotation builder"
    try:
        from app.api.archetype_routes import ARCHETYPE_PRESETS
        from app.engine.isd_rwsp_solver import ISDRWSPSolver
        from app.schemas import SolveRequestSchema

        preset = ARCHETYPE_PRESETS["downtown_foodmart_omaha"]
        req = SolveRequestSchema(
            archetype_id=preset.id,
            facility_name=preset.name,
            demand_matrix=preset.demand_matrix,
            templates=preset.templates,
            guardrails=preset.guardrails,
            pareto_leeway_pct=10.0,
        )
        ISDRWSPSolver(req)
        return {"status": "healthy", "engine": engine}
    except Exception as e:
        return {"status": "unhealthy", "engine": engine, "error": type(e).__name__}


def _check_idempotency_store() -> dict:
    """Healthy only if the idempotency_records table exists and a SELECT on it succeeds."""
    backend = "SQLite / PostgreSQL append-only"
    try:
        conn = get_db_connection()
        try:
            table = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'idempotency_records';"
            ).fetchone()
            if table is None:
                return {"status": "unhealthy", "backend": backend, "error": "table_missing"}
            conn.execute("SELECT key FROM idempotency_records LIMIT 1;").fetchall()
        finally:
            conn.close()
        return {"status": "healthy", "backend": backend}
    except Exception as e:
        return {"status": "unhealthy", "backend": backend, "error": type(e).__name__}


@app.get("/health/readiness", tags=["System"])
def kubernetes_readiness():
    """Production Kubernetes readiness probe - validates database connectivity and solver worker status."""
    db_ok = False
    db_latency_ms = 0.0
    t0 = time.time()
    try:
        conn = get_db_connection()
        try:
            conn.execute("SELECT 1;").fetchone()
        finally:
            conn.close()
        db_latency_ms = round((time.time() - t0) * 1000, 3)
        db_ok = True
    except Exception as e:
        db_ok = False

    solver_check = _check_solver_engine()
    idempotency_check = _check_idempotency_store()
    checks = {
        "database": {
            "status": "healthy" if db_ok else "unhealthy",
            "latency_ms": db_latency_ms,
        },
        "solver_engine": solver_check,
        "idempotency_store": idempotency_check,
    }

    if not db_ok or solver_check["status"] != "healthy" or idempotency_check["status"] != "healthy":
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "checks": checks},
        )

    return {
        "status": "ready",
        "checks": checks,
    }
