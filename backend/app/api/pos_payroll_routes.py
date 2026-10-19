"""POS ingestion and Payroll export REST endpoints."""

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import sqlite3

from app.database import get_db, ShiftFlowRepository
from app.engine.pos_sync import POSDemandForecaster
from app.engine.payroll_export import PayrollExportEngine
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.schemas import SolveRequestSchema, ShiftTemplateSchema

router = APIRouter(prefix="/api", tags=["POS & Payroll Integrations"])


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
    facility_id: str = "FAC-OMAHA-01",
    open_hour: int = 6,
    close_hour: int = 24,
    db: sqlite3.Connection = Depends(get_db),
):
    contents = await file.read()
    csv_text = contents.decode("utf-8", errors="replace")

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

    repo = ShiftFlowRepository(db)
    fac = repo.get_facility(facility_id)
    if fac:
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
    employees = repo.list_employees(facility_id=facility_id, active_only=True)
    fac = repo.get_facility(facility_id)

    templates = _get_default_templates()
    demand = fac["demand_matrix"] if fac else [[2]*24 for _ in range(7)]

    solver = ISDRWSPSolver(
        SolveRequestSchema(
            demand_matrix=demand,
            templates=templates,
            facility_name="Downtown Foodmart",
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
    employees = repo.list_employees(facility_id=facility_id, active_only=True)
    fac = repo.get_facility(facility_id)

    templates = _get_default_templates()
    demand = fac["demand_matrix"] if fac else [[2]*24 for _ in range(7)]

    solver = ISDRWSPSolver(
        SolveRequestSchema(
            demand_matrix=demand,
            templates=templates,
            facility_name="Downtown Foodmart",
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
