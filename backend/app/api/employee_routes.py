"""Employee and workforce management REST routes for ShiftFlow Studio."""

from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
import sqlite3

from app.database import get_db, ShiftFlowRepository, SeparationAuditExistsError

router = APIRouter(prefix="/api/employees", tags=["Workforce & Employees"])

AccommodationType = Literal["none", "religious", "medical", "academic"]
SeparationCategory = Literal["voluntary_resignation", "mutual_agreement", "involuntary_for_cause", "layoff_reduction"]


class EmployeeCreateSchema(BaseModel):
    facility_id: str = Field(default="FAC-OMAHA-01", description="Store facility ID")
    name: str = Field(..., example="Marcus Vance")
    role: str = Field(default="Frontline Clerk", example="Shift Lead")
    wage: float = Field(default=16.50, ge=7.25, le=150.0, description="Hourly wage rate ($)")
    available_days: List[int] = Field(default=[0, 1, 2, 3, 4, 5, 6], description="Day indices 0=Mon..6=Sun")
    assigned_line: Optional[int] = Field(default=None, description="Assigned cyclic rotation line (1..N)")
    accommodation_type: AccommodationType = Field(
        default="none",
        description="Statutory accommodation protection: none, religious (Title VII), medical (ADA), academic",
    )
    statutory_notes: Optional[str] = Field(default=None, description="Legal accommodation documentation notes")


class EmployeeUpdateSchema(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    wage: Optional[float] = Field(default=None, ge=7.25, le=150.0)
    active: Optional[bool] = None
    available_days: Optional[List[int]] = None
    assigned_line: Optional[int] = None
    accommodation_type: Optional[AccommodationType] = None
    statutory_notes: Optional[str] = None

    @model_validator(mode="after")
    def required_fields_not_null(self):
        # An explicit null clears assigned_line and statutory_notes. On the other fields it is refused.
        for field in ("name", "role", "wage", "available_days", "active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class EmployeeDeactivateSchema(BaseModel):
    separation_category: SeparationCategory = Field(
        default="voluntary_resignation",
        description="Legal separation classification to controvert pretextual retaliation claims under FLSA § 15(a)(3)",
    )
    separation_reason: str = Field(
        default="Voluntary separation initiated by employee",
        description="Contemporaneous business justification and factual narrative",
    )
    recorded_by: str = Field(
        default="Store Manager",
        description="Manager or administrator certifying the separation",
    )


@router.get("", summary="List workforce employees")
def list_employees(
    facility_id: str = Query("FAC-OMAHA-01"),
    active_only: bool = Query(False),
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    return repo.list_employees(facility_id=facility_id, active_only=active_only)


@router.post("", summary="Add new workforce associate with Title VII/ADA protections")
def create_employee(
    payload: EmployeeCreateSchema,
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    if repo.get_facility(payload.facility_id) is None:
        raise HTTPException(status_code=404, detail=f"Facility {payload.facility_id} not found.")
    emp = repo.create_employee(
        facility_id=payload.facility_id,
        name=payload.name,
        role=payload.role,
        wage=payload.wage,
        available_days=payload.available_days,
        assigned_line=payload.assigned_line,
        accommodation_type=payload.accommodation_type,
        statutory_notes=payload.statutory_notes,
    )
    return emp


@router.get("/audits/separations", summary="List historical separation audits for retaliation defense")
def list_separation_audits(
    facility_id: str = Query("FAC-OMAHA-01"),
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    return repo.list_separation_audits(facility_id=facility_id)


@router.get("/{employee_id}", summary="Get employee by ID")
def get_employee(
    employee_id: str,
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    emp = repo.get_employee(employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")
    return emp


@router.put("/{employee_id}", summary="Update employee profile, accommodation & availability")
def update_employee(
    employee_id: str,
    payload: EmployeeUpdateSchema,
    db: sqlite3.Connection = Depends(get_db),
):
    if payload.active is False:
        raise HTTPException(status_code=422, detail="Use the separation route to deactivate staff")
    repo = ShiftFlowRepository(db)
    # Pass only the fields the client sent, so an omitted field is left unchanged and an explicit null is seen as null.
    sent = {field: getattr(payload, field) for field in payload.model_fields_set}
    updated = repo.update_employee(employee_id=employee_id, **sent)
    if not updated:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")
    return updated


@router.post("/{employee_id}/deactivate", summary="Deactivate or separate employee with contemporaneous legal audit")
def deactivate_employee(
    employee_id: str,
    payload: Optional[EmployeeDeactivateSchema] = None,
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    sep_cat = payload.separation_category if payload else "voluntary_resignation"
    sep_reason = payload.separation_reason if payload else "Employee voluntary separation"
    recorded_by = payload.recorded_by if payload else "Store Manager"

    deactivated = repo.deactivate_employee(
        employee_id=employee_id,
        separation_category=sep_cat,
        separation_reason=sep_reason,
        recorded_by=recorded_by,
    )
    if not deactivated:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")
    return {"status": "deactivated", "employee": deactivated}


@router.delete("/{employee_id}", summary="Permanently delete employee")
def delete_employee(
    employee_id: str,
    db: sqlite3.Connection = Depends(get_db),
):
    repo = ShiftFlowRepository(db)
    try:
        success = repo.delete_employee(employee_id)
    except SeparationAuditExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if not success:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")
    return {"status": "deleted", "id": employee_id}
