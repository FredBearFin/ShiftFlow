"""POS ingestion and Payroll export REST endpoints."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

from app.database import ShiftFlowRepository
from app.deps import get_repo
from app.engine.pos_sync import DEFAULT_MAX_STAFF_PER_HOUR, POSDemandForecaster
from app.engine.payroll_export import PayrollExportEngine
from app.engine.isd_rwsp_solver import ISDRWSPSolver
from app.schemas import (
    MAX_DEMAND_PER_INTERVAL,
    EmployeeRecord,
    SolveRequestSchema,
    ShiftTemplateSchema,
)

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
    max_staff_per_hour: int = Query(
        default=DEFAULT_MAX_STAFF_PER_HOUR,
        ge=1,
        le=MAX_DEMAND_PER_INTERVAL,
        description=(
            "Most people the forecast will ask for in any one hour. The default of 6 fits a "
            "small retail floor; a hospital ward or plant line needs a higher value or its "
            "peak hours come back understated."
        ),
    ),
    repo: ShiftFlowRepository = Depends(get_repo),
):
    if open_hour >= close_hour:
        raise HTTPException(status_code=422, detail="open_hour must be earlier than close_hour.")

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

    forecaster = POSDemandForecaster(max_staff_cap=max_staff_per_hour)
    try:
        records = forecaster.parse_pos_csv(csv_text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{exc} Nothing was saved.")
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
        "max_staff_per_hour": summary["max_staff_cap"],
        "hours_limited_by_staff_cap": summary["hours_limited_by_staff_cap"],
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


def _solver_staff(repo: ShiftFlowRepository, facility_id: str) -> tuple[List[EmployeeRecord], List[str]]:
    """Returns the facility's active staff as solver input, plus the employee IDs of staff left out for a null wage.

    A staff member with no stored wage is not paid a placeholder; they are skipped and their IDs returned instead.
    """
    staff: List[EmployeeRecord] = []
    excluded: List[str] = []
    for e in repo.list_employees(facility_id=facility_id, active_only=True):
        if e["wage"] is None:
            excluded.append(str(e["id"]))
            continue
        staff.append(
            EmployeeRecord(
                employee_id=str(e["id"]),
                name=e["name"],
                role=e["role"],
                hourly_wage=e["wage"],
                is_active=True,
                available_days=e["available_days"],
                assigned_line_id=e["assigned_line"],
                accommodation_type=e["accommodation_type"],
                statutory_notes=e["statutory_notes"],
            )
        )
    return staff, excluded


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


def _facility_templates(fac: Dict[str, Any]) -> tuple[List[ShiftTemplateSchema], bool]:
    """Returns the facility's own stored shift templates, falling back to the built-in set.

    Both payroll routes used to call _get_default_templates() unconditionally, so a
    facility that had configured its own shifts got a CSV priced against three
    hardcoded 8-hour shifts it does not run. The second return value says whether the
    fallback was used, so the response can admit it rather than let the numbers pass
    for the facility's own.
    """
    stored = fac.get("shift_templates") or []
    templates: List[ShiftTemplateSchema] = []
    for raw in stored:
        try:
            templates.append(ShiftTemplateSchema.model_validate(raw))
        except Exception:
            # A stored template we cannot read is skipped rather than guessed at.
            continue
    if templates:
        return templates, False
    return _get_default_templates(), True


def _payroll_rows(
    repo: ShiftFlowRepository, facility_id: str
) -> tuple[List[Dict[str, Any]], List[str], Dict[str, str]]:
    """Builds the payroll rows for a facility, from its saved schedule where there is one.

    Shared by both export routes, which were near-duplicates of each other.

    Source of the figures, in order:
      1. The newest saved roster snapshot — the schedule the manager actually built.
      2. Failing that, a solve over the facility's *stored* templates and demand.

    Returns the rows, the employee IDs excluded for a null wage, and provenance
    headers so the caller can tell which of the two it got.
    """
    fac = _require_payroll_inputs(repo, facility_id)
    staff, excluded = _solver_staff(repo, facility_id)

    snapshot = repo.get_latest_roster_snapshot(facility_id)
    snapshot_lines = []
    if snapshot:
        data = snapshot.get("schedule_data") or {}
        if isinstance(data, dict):
            candidate = data.get("roster_lines") or data.get("lines") or []
            if isinstance(candidate, list):
                snapshot_lines = [line for line in candidate if isinstance(line, dict)]

    if snapshot_lines:
        rows = snapshot_lines
        headers = {
            "X-Payroll-Source": "saved-roster-snapshot",
            "X-Payroll-Snapshot-Id": str(snapshot["id"]),
            "X-Payroll-Basis": (
                "Scheduled hours from the roster saved on "
                f"{snapshot.get('created_at')}. Projection, not hours worked."
            ),
        }
    else:
        templates, used_defaults = _facility_templates(fac)
        result = ISDRWSPSolver(
            SolveRequestSchema(
                demand_matrix=fac["demand_matrix"],
                templates=templates,
                facility_name=fac["name"],
                employees=staff,
            )
        ).solve()
        rows = [line.model_dump() for line in result.roster_lines]
        headers = {
            "X-Payroll-Source": "resolved-from-stored-templates",
            "X-Payroll-Basis": (
                "No saved roster for this facility; figures are a fresh solve over the "
                "facility's stored shift templates and demand. Projection, not hours worked."
            ),
        }
        if used_defaults:
            headers["X-Payroll-Source"] = "resolved-from-built-in-templates"
            headers["X-Payroll-Basis"] = (
                "No saved roster and no shift templates stored for this facility; figures "
                "are a fresh solve over ShiftFlow's built-in 8-hour shifts, which may not "
                "be the shifts this facility runs. Projection, not hours worked."
            )

    # A rotation line nobody is assigned to is not a payable person. Left in, the
    # export engine labels it "Associate 3" / "Shift Pattern 3" and gives it a
    # fabricated employee ID, so a row of invented hours reads as a real paycheck.
    payable = [r for r in rows if (r.get("assigned_person") or "").strip()]
    return payable, excluded, headers


def _payroll_response(csv_data: str, filename: str, excluded: List[str], provenance: Dict[str, str]) -> Response:
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Excluded-Staff": ",".join(excluded),
            **provenance,
        },
    )


@router.get("/payroll/export/gusto", summary="Export Gusto-formatted payroll CSV")
def export_gusto_payroll(
    facility_id: str = "FAC-OMAHA-01",
    repo: ShiftFlowRepository = Depends(get_repo),
):
    rows, excluded, provenance = _payroll_rows(repo, facility_id)
    return _payroll_response(
        PayrollExportEngine.export_gusto_csv(rows),
        "shiftflow_gusto_payroll.csv",
        excluded,
        provenance,
    )


@router.get("/payroll/export/adp", summary="Export ADP Workforce Now-formatted payroll CSV")
def export_adp_payroll(
    facility_id: str = "FAC-OMAHA-01",
    repo: ShiftFlowRepository = Depends(get_repo),
):
    rows, excluded, provenance = _payroll_rows(repo, facility_id)
    return _payroll_response(
        PayrollExportEngine.export_adp_workforce_csv(rows),
        "shiftflow_adp_payroll.csv",
        excluded,
        provenance,
    )
