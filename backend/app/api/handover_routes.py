"""
ShiftFlow Studio Enterprise - Shift Handover & Floor Operations REST Endpoints
-----------------------------------------------------------------------------
Exposes shift handover metrics, checklists, cash till reconciliation,
and overlap buffer friction analyses for retail shift supervisors.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from app.engine.shift_handover import (
    ShiftHandoverEngine,
    ShiftHandoverAuditReport,
    ChecklistItem,
    CashTillAudit,
    OverlapWindowMetric
)

router = APIRouter(prefix="/api/handover", tags=["Shift Handover & Operations"])


class ChecklistToggleRequest(BaseModel):
    item_id: str
    facility_id: str = "FAC-OMAHA-01"
    new_status: str  # completed, pending, flagged
    verified_by: str
    notes: Optional[str] = None


class TillSubmitRequest(BaseModel):
    register_id: str
    facility_id: str = "FAC-OMAHA-01"
    opening_float: float
    closing_cash_counted: float
    cash_dropped_to_safe: float
    expected_system_cash: float
    audited_by: str
    witnessed_by: str


class CreateCustomTaskRequest(BaseModel):
    checklist_type: str = "morning_to_midday"  # morning_to_midday or closing_to_opening
    category: str
    task: str
    responsible_shift: str
    verified_by_shift: Optional[str] = "Incoming Shift Lead"
    assigned_role: Optional[str] = "Frontline Associate"
    notes: Optional[str] = "Supervisor configured turnover task"


@router.get("/audit/{facility_id}")
def get_shift_handover_audit(facility_id: str):
    """
    Returns 501: no stored shift, overlap, or till data, so no handover audit is generated.
    """
    raise HTTPException(status_code=501, detail="not implemented: no source data")


@router.get("/checklists/{facility_id}")
def get_handover_checklists(facility_id: str):
    """
    Returns the standardized opening, midday handover, and closing checklists,
    including any custom tasks configured by the store supervisor.
    """
    return ShiftHandoverEngine.get_standard_handover_checklists()


@router.post("/task", response_model=ChecklistItem)
def create_custom_turnover_task(request: CreateCustomTaskRequest):
    """
    Allows a store supervisor to input custom turnover/handover tasks
    (e.g., checking ice merchandisers, cleaning coffee carafes, or auditing propane tanks).
    """
    if request.checklist_type not in ["morning_to_midday", "closing_to_opening"]:
        raise HTTPException(
            status_code=400,
            detail="checklist_type must be 'morning_to_midday' or 'closing_to_opening'"
        )

    return ShiftHandoverEngine.add_custom_task(
        checklist_type=request.checklist_type,
        category=request.category,
        task=request.task,
        responsible_shift=request.responsible_shift,
        verified_by_shift=request.verified_by_shift or "Incoming Shift Lead",
        assigned_role=request.assigned_role or "Frontline Associate",
        notes=request.notes or "Custom supervisor task"
    )


@router.get("/overlap-analysis")
def get_overlap_analysis():
    """
    Returns 501: no stored shift or overlap data, so no overlap metrics are computed.
    """
    raise HTTPException(status_code=501, detail="not implemented: no source data")


@router.post("/checklist-toggle")
def toggle_checklist_item(request: ChecklistToggleRequest):
    """
    Toggles a checklist item's status with supervisor verification tracking.
    Returns 501: no checklist state is persisted, so a toggle cannot be recorded.
    """
    if request.new_status not in ["completed", "pending", "flagged"]:
        raise HTTPException(status_code=400, detail="Invalid status. Must be completed, pending, or flagged.")

    raise HTTPException(status_code=501, detail="not implemented: no source data")


@router.post("/till-audit")
def submit_till_audit(request: TillSubmitRequest):
    """
    Submits a cash drawer till audit and computes cash variance against the POS system total.
    No receipt is issued: nothing is persisted.
    """
    retained_float = request.opening_float
    total_reconciled = request.cash_dropped_to_safe + retained_float
    variance = round(request.closing_cash_counted - request.expected_system_cash, 2)

    status = "balanced"
    if variance < -2.00:
        status = "under"
    elif variance > 2.00:
        status = "over"

    return {
        "status": "success",
        "register_id": request.register_id,
        "opening_float": request.opening_float,
        "retained_float": retained_float,
        "cash_dropped_to_safe": request.cash_dropped_to_safe,
        "expected_system_cash": request.expected_system_cash,
        "variance": variance,
        "reconciliation_status": status,
        "audited_by": request.audited_by,
        "witnessed_by": request.witnessed_by,
        "message": f"Cash drawer status: {status}. Variance {variance:+.2f}. Float retained at ${retained_float:.2f}."
    }
