"""
ShiftFlow Studio Enterprise - Shift Handover & Floor Operations Engine
----------------------------------------------------------------------
Industry-agnostic shift handover, buffer analysis, and floor task engine.
Supports configurable industry archetypes (General Retail, Cashless Boutique,
Quick-Service / Cafe, Convenience / Specialty, and Blank Slate).
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ChecklistItem(BaseModel):
    id: str
    category: str  # Cash / Security / Facilities / Sanitation / Orders / Equipment
    task: str
    responsible_shift: str
    verified_by_shift: str = "Incoming Shift"
    status: str = "completed"  # completed, pending, flagged
    assigned_role: str = "Store Associate"
    verification_notes: str = ""
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"))


class CashTillAudit(BaseModel):
    register_id: str
    opening_float: float = 200.00
    closing_cash_counted: float
    cash_dropped_to_safe: float
    retained_float: float = 200.00
    expected_system_cash: float
    variance: float = 0.00
    status: str = "balanced"
    audited_by: str
    witnessed_by: str


class OverlapWindowMetric(BaseModel):
    transition_name: str
    outgoing_shift: str
    incoming_shift: str
    overlap_start: str
    overlap_end: str
    overlap_duration_hours: float
    staggered_lunch_coverage: bool
    register_handover_window: str
    friction_index_pct: float
    operational_status: str


class ShiftHandoverAuditReport(BaseModel):
    facility_id: str
    industry_profile: str = "general_retail"
    audit_timestamp: str
    overall_handover_health_score: float
    friction_index_pct: float
    overlap_metrics: List[OverlapWindowMetric]
    morning_to_midday_checklist: List[ChecklistItem]
    closing_to_opening_checklist: List[ChecklistItem]
    cash_till_audits: List[CashTillAudit]
    peer_accountability_score: float
    supervisor_notes: str


# Configurable industry presets for store handovers
INDUSTRY_HANDOVER_PRESETS: Dict[str, Dict[str, List[ChecklistItem]]] = {
    "general_retail": {
        "morning_to_midday": [
            ChecklistItem(
                id="CHK-GR-01",
                category="Cash & POS",
                task="Register Drawer Balance: Confirm base cash float; secure excess morning cash",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Cashier / Associate",
                verification_notes="Drawer balanced against mid-day POS register total."
            ),
            ChecklistItem(
                id="CHK-GR-02",
                category="Sales Floor",
                task="Floor Recovery & Restock: Straighten main display tables and restock bestsellers",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Floor Associate",
                verification_notes="Front promotional tables tidied; floor aisles swept."
            ),
            ChecklistItem(
                id="CHK-GR-03",
                category="Customer Orders",
                task="Pickup & Hold Shelf Audit: Tally pending customer pickup packages and staging area",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Customer Service Clerk",
                verification_notes="Incoming morning online orders tagged and staged on pickup shelf."
            ),
            ChecklistItem(
                id="CHK-GR-04",
                category="Front Counter Supplies",
                task="Register Supplies Replenishment: Shopping bags, receipt tape rolls, and counter wipe",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Associate",
                verification_notes="All registers restocked with bags and tape rolls."
            )
        ],
        "closing_to_opening": [
            ChecklistItem(
                id="CHK-GR-05",
                category="Closing Cash",
                task="End-of-Day Register Reconciliation: Run closing z-tapes and secure revenue deposit",
                responsible_shift="Closing Shift",
                verified_by_shift="Morning Shift",
                status="completed",
                assigned_role="Closing Lead",
                verification_notes="Daily revenue drop sealed in safe; floats preserved."
            ),
            ChecklistItem(
                id="CHK-GR-06",
                category="Facilities & Security",
                task="Perimeter Lockdown & Store Security: Deadbolt exterior doors and arm security system",
                responsible_shift="Closing Shift",
                verified_by_shift="Morning Shift",
                status="completed",
                assigned_role="Supervisor",
                verification_notes="All doors locked, alarms armed, lights set to night mode."
            ),
            ChecklistItem(
                id="CHK-GR-07",
                category="Sanitation",
                task="Trash & Waste Removal: Empty sales floor bins and sweep main entryway",
                responsible_shift="Closing Shift",
                verified_by_shift="Morning Shift",
                status="completed",
                assigned_role="Closing Associate",
                verification_notes="Trash disposed in exterior dumpster; front mats vacuumed."
            )
        ]
    },
    "cashless_boutique": {
        "morning_to_midday": [
            ChecklistItem(
                id="CHK-CB-01",
                category="POS & Mobile Tablets",
                task="Tablet Charging & System Check: Ensure mobile checkout scanners have >= 80% battery",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Sales Stylist",
                verification_notes="3 mobile POS units docked and updated."
            ),
            ChecklistItem(
                id="CHK-CB-02",
                category="Fitting Rooms & Floor",
                task="Fitting Room Sweep: Clear hung garments and return sizes to racks",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Sales Stylist",
                verification_notes="All 4 rooms cleared and disinfected."
            ),
            ChecklistItem(
                id="CHK-CB-03",
                category="Merchandising",
                task="Restock Hangers & Shopping Totes: Replenish customer carry bags and branded tissue paper",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Sales Associate",
                verification_notes="Wrap station fully stocked."
            )
        ],
        "closing_to_opening": [
            ChecklistItem(
                id="CHK-CB-04",
                category="Security & Systems",
                task="POS Daily Batch Settle: Close out digital card terminal batch and lock cash-free safe",
                responsible_shift="Closing Shift",
                verified_by_shift="Morning Shift",
                status="completed",
                assigned_role="Keyholder",
                verification_notes="Batch #4102 settled successfully."
            ),
            ChecklistItem(
                id="CHK-CB-05",
                category="Display Care",
                task="Window Display & Lighting: Turn off spotlights; set window timer for overnight",
                responsible_shift="Closing Shift",
                verified_by_shift="Morning Shift",
                status="completed",
                assigned_role="Keyholder",
                verification_notes="Window illumination set to timed night display."
            )
        ]
    },
    "food_beverage_cafe": {
        "morning_to_midday": [
            ChecklistItem(
                id="CHK-FB-01",
                category="Barista & Counter",
                task="Espresso Group Head Wipe & Steam Wand Purge: Clean drip trays and refill bean hoppers",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Lead Barista",
                verification_notes="Steam wands soaked and group heads brushed."
            ),
            ChecklistItem(
                id="CHK-FB-02",
                category="Food Safety",
                task="Milk & Dairy Cooler Temperature Check: Verify under-counter fridge <= 40.0°F",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Shift Supervisor",
                verification_notes="Logged at 37.2°F (Compliant)."
            ),
            ChecklistItem(
                id="CHK-FB-03",
                category="Sanitation",
                task="Sanitizer Bucket Refresh: Mix fresh quat sanitizer solution and test with test strip",
                responsible_shift="Morning Shift",
                verified_by_shift="Midday Shift",
                status="completed",
                assigned_role="Barista",
                verification_notes="Tested at 200 PPM active sanitizer."
            )
        ],
        "closing_to_opening": [
            ChecklistItem(
                id="CHK-FB-04",
                category="Equipment Care",
                task="Espresso Machine Chemical Backflush: Run Cafiza cycle and soak portafilters",
                responsible_shift="Closing Shift",
                verified_by_shift="Morning Shift",
                status="completed",
                assigned_role="Closing Barista",
                verification_notes="Pills dissolved, backflush completed cleanly."
            ),
            ChecklistItem(
                id="CHK-FB-05",
                category="Food Inventory",
                task="Pastry Case Discard & Wipe: Wrap day-old pastries for food donation and sanitize glass",
                responsible_shift="Closing Shift",
                verified_by_shift="Morning Shift",
                status="completed",
                assigned_role="Closing Associate",
                verification_notes="Case emptied, crumbs vacuumed, shelves sanitized."
            )
        ]
    },
    "convenience_specialty": {
        "morning_to_midday": [
            ChecklistItem(
                id="CHK-MM-01",
                category="Cash & Registers",
                task="Register 1 & 2 Cash Drawer Audit: Confirm base float; drop excess lunch cash to safe",
                responsible_shift="Morning (06:00–14:00)",
                verified_by_shift="Midday (11:00–19:00)",
                status="completed",
                assigned_role="Senior Clerk / Cashier",
                verification_notes="Register floats balanced at $200.00 exact."
            ),
            ChecklistItem(
                id="CHK-MM-02",
                category="Regulated Security",
                task="Lottery Scratch-Off & Regulated Goods Audit: Reconcile active dispenser ending numbers",
                responsible_shift="Morning (06:00–14:00)",
                verified_by_shift="Midday (11:00–19:00)",
                status="completed",
                assigned_role="Shift Supervisor",
                verification_notes="Active dispensers reconciled against terminal audit report."
            ),
            ChecklistItem(
                id="CHK-MM-03",
                category="Food Safety & Cold Chain",
                task="Walk-In Beverage/Dairy Cooler Temperature Log: Verify ambient temp <= 38.0°F",
                responsible_shift="Morning (06:00–14:00)",
                verified_by_shift="Midday (11:00–19:00)",
                status="completed",
                assigned_role="Inventory Specialist",
                verification_notes="Analog and digital probes verified at 36.4°F."
            ),
            ChecklistItem(
                id="CHK-MM-04",
                category="Floor Sanitation & Front End",
                task="Front-End Supplies: Thermal tape, bagging supplies, and belt scanners",
                responsible_shift="Morning (06:00–14:00)",
                verified_by_shift="Midday (11:00–19:00)",
                status="completed",
                assigned_role="Customer Service Clerk",
                verification_notes="Register tape and bags replenished."
            )
        ],
        "closing_to_opening": [
            ChecklistItem(
                id="CHK-CO-01",
                category="Cash & Safe Lockdown",
                task="Midnight Register Z-Report & Night Safe Deposit: Seal drops into drop safe",
                responsible_shift="Closing (16:00–24:00)",
                verified_by_shift="Morning (06:00–14:00)",
                status="completed",
                assigned_role="Closing Supervisor",
                verification_notes="Z-tapes run and stapled to safe drop envelope."
            ),
            ChecklistItem(
                id="CHK-CO-02",
                category="Perimeter Security",
                task="Exterior Store Lockdown & Perimeter Alarm: Deadbolt fire doors; arm alarm",
                responsible_shift="Closing (16:00–24:00)",
                verified_by_shift="Morning (06:00–14:00)",
                status="completed",
                assigned_role="Closing Supervisor",
                verification_notes="Perimeter secured and central station confirmed armed."
            )
        ]
    }
}

# User-added custom tasks
DYNAMIC_USER_TASKS: Dict[str, List[ChecklistItem]] = {
    "morning_to_midday": [],
    "closing_to_opening": []
}


class ShiftHandoverEngine:
    """
    Evaluates and coordinates shift handover mechanics across diverse retail types.
    """

    @classmethod
    def get_standard_handover_checklists(
        cls, profile: str = "general_retail"
    ) -> Dict[str, List[ChecklistItem]]:
        """
        Returns checklists for the requested industry profile, merged with custom user tasks.
        """
        base = INDUSTRY_HANDOVER_PRESETS.get(profile, INDUSTRY_HANDOVER_PRESETS["general_retail"])
        combined_mm = list(base.get("morning_to_midday", [])) + DYNAMIC_USER_TASKS.get("morning_to_midday", [])
        combined_co = list(base.get("closing_to_opening", [])) + DYNAMIC_USER_TASKS.get("closing_to_opening", [])

        return {
            "morning_to_midday": combined_mm,
            "closing_to_opening": combined_co
        }

    @classmethod
    def add_custom_task(
        cls,
        checklist_type: str,
        category: str,
        task: str,
        responsible_shift: str,
        verified_by_shift: str = "Incoming Shift",
        assigned_role: str = "Store Associate",
        notes: str = ""
    ) -> ChecklistItem:
        if checklist_type not in DYNAMIC_USER_TASKS:
            DYNAMIC_USER_TASKS[checklist_type] = []

        task_id = f"CHK-CUST-{len(DYNAMIC_USER_TASKS[checklist_type]) + 1:02d}"
        new_item = ChecklistItem(
            id=task_id,
            category=category,
            task=task,
            responsible_shift=responsible_shift,
            verified_by_shift=verified_by_shift,
            status="pending",
            assigned_role=assigned_role,
            verification_notes=notes or "Custom task added by manager."
        )
        DYNAMIC_USER_TASKS[checklist_type].append(new_item)
        return new_item

    @classmethod
    def remove_task(cls, checklist_type: str, task_id: str) -> bool:
        """Removes a task by ID from either preset or dynamic user tasks."""
        if checklist_type in DYNAMIC_USER_TASKS:
            before_len = len(DYNAMIC_USER_TASKS[checklist_type])
            DYNAMIC_USER_TASKS[checklist_type] = [
                t for t in DYNAMIC_USER_TASKS[checklist_type] if t.id != task_id
            ]
            if len(DYNAMIC_USER_TASKS[checklist_type]) < before_len:
                return True
        return False

    @staticmethod
    def calculate_overlap_metrics() -> List[OverlapWindowMetric]:
        return [
            OverlapWindowMetric(
                transition_name="Morning to Midday Shift Handoff",
                outgoing_shift="Morning Shift",
                incoming_shift="Midday Shift",
                overlap_start="11:00 AM",
                overlap_end="14:00 PM",
                overlap_duration_hours=3.0,
                staggered_lunch_coverage=True,
                register_handover_window="Structured Step-Down Window (Zero Register Stoppage)",
                friction_index_pct=2.1,
                operational_status="Frictionless (Scheduled Overlap Active)"
            ),
            OverlapWindowMetric(
                transition_name="Midday to Evening Closing Handoff",
                outgoing_shift="Midday Shift",
                incoming_shift="Closing Shift",
                overlap_start="16:00 PM",
                overlap_end="19:00 PM",
                overlap_duration_hours=3.0,
                staggered_lunch_coverage=True,
                register_handover_window="Evening Transition Window",
                friction_index_pct=2.4,
                operational_status="Frictionless (Scheduled Overlap Active)"
            ),
            OverlapWindowMetric(
                transition_name="Closing to Morning Turnaround",
                outgoing_shift="Closing Shift",
                incoming_shift="Next Morning Shift",
                overlap_start="24:00 PM",
                overlap_end="06:00 AM",
                overlap_duration_hours=0.0,
                staggered_lunch_coverage=False,
                register_handover_window="Overnight Safe & Key Transfer",
                friction_index_pct=3.8,
                operational_status="Controlled (Checklist Verified)"
            )
        ]

    @staticmethod
    def get_mock_till_audits() -> List[CashTillAudit]:
        return [
            CashTillAudit(
                register_id="Main Checkout / POS 1",
                opening_float=200.00,
                closing_cash_counted=1045.00,
                cash_dropped_to_safe=845.00,
                retained_float=200.00,
                expected_system_cash=1045.00,
                variance=0.00,
                status="balanced",
                audited_by="Lead Associate",
                witnessed_by="Incoming Clerk"
            )
        ]

    @classmethod
    def generate_handover_audit(
        cls, facility_id: str = "FAC-DEFAULT", profile: str = "general_retail"
    ) -> ShiftHandoverAuditReport:
        checklists = cls.get_standard_handover_checklists(profile=profile)
        overlap_metrics = cls.calculate_overlap_metrics()
        till_audits = cls.get_mock_till_audits()

        avg_friction = sum(m.friction_index_pct for m in overlap_metrics) / len(overlap_metrics)
        health_score = 100.0 - avg_friction

        return ShiftHandoverAuditReport(
            facility_id=facility_id,
            industry_profile=profile,
            audit_timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            overall_handover_health_score=round(health_score, 1),
            friction_index_pct=round(avg_friction, 1),
            overlap_metrics=overlap_metrics,
            morning_to_midday_checklist=checklists["morning_to_midday"],
            closing_to_opening_checklist=checklists["closing_to_opening"],
            cash_till_audits=till_audits,
            peer_accountability_score=98.5,
            supervisor_notes=(
                f"Shift Handover Operational Engine Active ({profile.replace('_', ' ').title()}). "
                "The scheduled shift overlap window decouples drawer counting, restocking, and "
                "closing duties from customer checkout lanes. Forward rotation lines ensure peer accountability."
            )
        )
