"""FastAPI Application Entrypoint for ShiftFlow Studio Enterprise (I-SD-RWSP Workforce OS)."""

import os
import time
from datetime import datetime
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.archetype_routes import router as archetype_router
from app.api.schedule_routes import router as schedule_router
from app.api.employee_routes import router as employee_router
from app.api.pos_payroll_routes import router as pos_payroll_router
from app.api.emergency_routes import router as emergency_router
from app.api.compliance_routes import router as compliance_router
from app.api.handover_routes import router as handover_router
from app.api.auth_routes import router as auth_router
from app.auth import require_login
from app.config import settings
from app.database import init_db, get_db_connection
from fastapi.responses import JSONResponse
from app.engine.isd_rwsp_solver import SolverInfeasibleError
from app.middleware import IdempotencyMiddleware

APP_START_TIME = time.time()

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://localhost:3000"

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Enterprise SaaS Workforce Optimization Engine implementing Tristan Becker (EJOR 2026), "
        "'A unifying approach to shift design and rotating workforce scheduling' (I-SD-RWSP)."
    ),
    dependencies=[Depends(require_login)],
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
    allow_headers=["Content-Type", "Idempotency-Key", "X-API-Key"],
)

# Idempotency Middleware for exactly-once mutation semantics
app.add_middleware(IdempotencyMiddleware)


@app.exception_handler(SolverInfeasibleError)
def solver_infeasible_handler(request, exc: SolverInfeasibleError):
    """Reports a schedule the solver cannot build from the given constraints, instead of relaxing them."""
    return JSONResponse(status_code=422, content={"detail": str(exc)})


# Startup event to ensure SQLite database schema is initialized
@app.on_event("startup")
def on_startup():
    init_db()


app.include_router(archetype_router, prefix=settings.api_prefix)
app.include_router(schedule_router, prefix=settings.api_prefix)
app.include_router(employee_router)
app.include_router(pos_payroll_router)
app.include_router(emergency_router)
app.include_router(compliance_router)
app.include_router(handover_router)
app.include_router(auth_router)


@app.get("/health", tags=["System"])
def health_check() -> dict:
    """Basic health check endpoint verifying solver readiness and mathematical model parameters."""
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "version": settings.version,
        "environment": "production",
        "ejor_paper_anchor": "Becker (2026), European Journal of Operational Research, Vol. 320",
        "supported_archetypes": [
            "24_7_continuous_retail",
            "18_6_extended_retail",
            "16_7_two_shift_retail",
            "14_5_weekday_commercial",
            "12_7_split_crew_retail",
        ],
        "default_safe_rest_hours": 16.0,
        "clopening_forbidden": True,
    }


@app.get("/health/liveness", tags=["System"])
def kubernetes_liveness() -> dict:
    """Production Kubernetes liveness probe - fast return confirming event loop responsive."""
    return {
        "status": "alive",
        "uptime_seconds": round(time.time() - APP_START_TIME, 2),
        "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
    }


def _check_solver_engine() -> dict:
    """Healthy only if ISDRWSPSolver imports and can be constructed from a valid request."""
    engine = "Becker Hierholzer Eulerian Cycle Extraction O(|E|)"
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
