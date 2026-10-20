"""POS ingestion and Payroll export REST endpoints."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import sqlite3

from app.database import get_db, ShiftFlowRepository
from app.engine.pos_sync import POSDemandForecaster
from app.engine.payroll_export import PayrollExportEngine
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.schemas import SolveRequestSchema, ShiftTemplateSchema

router = APIRouter(prefix="/api", tags=["POS & Payroll Integrations"])

MAX_POS_UPLOAD_BYTES = 1_000_000


class POSUploadResponseSchema(BaseModel):
    status: str
    records_parsed: int
    weekly_sales: float
    weekly_transactions: int
    peak_period: Dict[str, Any]
    suggested_demand_matrix: List[List[int]]


@router.post("/pos/upload-csv", summary="Upload POS transaction CSV to recalibrate register demand")
async def upload_pos_csv(
    file: UploadFile = File(...),
    facility_id: str = Query(default="FAC-OMAHA-01", max_length=64),
    open_hour: int = Query(default=6, ge=0, le=23),
    close_hour: int = Query(default=24, ge=1, le=24),
    db: sqlite3.Connection = Depends(get_db),
):
    if open_hour >= close_hour:
        raise HTTPException(status_code=422, detail="open_hour must be earlier than close_hour.")

    repo = ShiftFlowRepository(db)
    fac = repo.get_facility(facility_id)
    if not fac:
        raise HTTPException(status_code=404, detail=f"Facility '{facility_id}' not found. Nothing was saved.")

    contents = await file.read(MAX_POS_UPLOAD_BYTES + 1)
    if len(contents) > MAX_POS_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"POS CSV must be {MAX_POS_UPLOAD_BYTES} bytes or smaller.")
    try:
        csv_text = contents.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="POS CSV must be UTF-8 text.")

    forecaster = POSDemandForecaster()
    records = forecaster.parse_pos_csv(csv_text)
    if not records:
        raise HTTPException(
            status_code=400,
            detail="Could not parse valid POS transaction rows. Check CSV column names (amount, day_of_week, hour_of_day).",
        )

    demand_matrix, summary = forecaster.calculate_demand_matrix(
        records, open_hour=open_hour, close_hour=close_hour
    )

    repo.upsert_facility(
        facility_id=facility_id,
        name=fac["name"],
        location=fac["location"],
        operating_hours=fac["operating_hours"],
        demand_matrix=demand_matrix,
        shift_templates=fac["shift_templates"],
    )

    return {
        "status": "success",
        "records_parsed": len(records),
        "weekly_sales": summary["total_weekly_sales"],
        "weekly_transactions": summary["total_weekly_transactions"],
        "peak_period": summary["peak_hour"],
        "suggested_demand_matrix": demand_matrix,
    }


def _require_payroll_inputs(repo: ShiftFlowRepository, facility_id: str) -> Dict[str, Any]:
    """Returns the facility for a payroll export, or refuses when there is nothing to pay."""
    fac = repo.get_facility(facility_id)
    if not fac:
        raise HTTPException(status_code=404, detail=f"Facility '{facility_id}' not found.")
    if not repo.list_employees(facility_id=facility_id, active_only=True):
        raise HTTPException(
            status_code=409,
            detail="No active staff records for this facility. Add staff before exporting payroll.",
        )
    return fac


def _get_default_templates() -> List[ShiftTemplateSchema]:
    return [
        ShiftTemplateSchema(
            code="M",
            name="Opening Shift — 6a-2p (M)",
            earliest_start=5,
            latest_end=15,
            preferred_start=6,
            preferred_duration=8,
        ),
        ShiftTemplateSchema(
            code="D",
            name="Midday Rush — 11a-7p (D)",
            earliest_start=10,
            latest_end=20,
            preferred_start=11,
            preferred_duration=8,
        ),
        ShiftTemplateSchema(
            code="E",
            name="Closing Shift — 4p-12a (E)",
            earliest_start=15,
            latest_end=25,
            preferred_start=16,
            preferred_duration=8,
        ),
    ]


@router.get("/payroll/export/gusto", summary="Export Gusto-formatted payroll CSV")
def export_gusto_payroll(
    facility_id: str = "FAC-OMAHA-01",
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    fac = _require_payroll_inputs(repo, facility_id)

    templates = _get_default_templates()
    solver = ISDRWSPSolver(
        SolveRequestSchema(
            demand_matrix=fac["demand_matrix"],
            templates=templates,
            facility_name=fac["name"],
        )
    )
    result = solver.solve()
    roster_lines = [line.dict() for line in result.roster_lines]

    csv_data = PayrollExportEngine.export_gusto_csv(roster_lines)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=shiftflow_gusto_payroll.csv"},
    )


@router.get("/payroll/export/adp", summary="Export ADP Workforce Now-formatted payroll CSV")
def export_adp_payroll(
    facility_id: str = "FAC-OMAHA-01",
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    fac = _require_payroll_inputs(repo, facility_id)

    templates = _get_default_templates()
    solver = ISDRWSPSolver(
        SolveRequestSchema(
            demand_matrix=fac["demand_matrix"],
            templates=templates,
            facility_name=fac["name"],
        )
    )
    result = solver.solve()
    roster_lines = [line.dict() for line in result.roster_lines]

    csv_data = PayrollExportEngine.export_adp_workforce_csv(roster_lines)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=shiftflow_adp_payroll.csv"},
    )
