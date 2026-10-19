"""Database seed script to populate realistic retail facilities, employees, and historical POS demand."""

import os
import sys

# Ensure app is in path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.database import init_db, get_db_connection, ShiftFlowRepository


def seed():
    print("Initializing ShiftFlow SQLite schema...")
    init_db()
    conn = get_db_connection()
    repo = ShiftFlowRepository(conn)

    print("Seeding Retail Facilities...")

    # 1. Downtown Foodmart
    fac1_demand = [
        [0,0,0,0,0,0, 3,3,3,3,3, 4,4,4,4,4, 4,4,4,3,3, 0,0,0] if day < 5
        else [0,0,0,0,0,0, 4,4,4,4,4, 5,5,5,5,5, 5,5,5,4,4, 0,0,0]
        for day in range(7)
    ]
    fac1_templates = [
        {"code": "M", "name": "Opening Shift — 6a-2p (M)", "start_hour": 6, "duration_hours": 8},
        {"code": "D", "name": "Midday Rush — 11a-7p (D)", "start_hour": 11, "duration_hours": 8},
        {"code": "E", "name": "Closing Shift — 4p-12a (E)", "start_hour": 16, "duration_hours": 8},
    ]
    repo.upsert_facility(
        facility_id="FAC-OMAHA-01",
        name="Downtown Foodmart",
        location="16th & Farnam, Omaha, NE",
        operating_hours="06:00–24:00 Daily",
        demand_matrix=fac1_demand,
        shift_templates=fac1_templates,
    )

    # 2. CloudNine Vapor Lounge
    fac2_demand = [
        [0,0,0,0,0,0,0,0,0,0, 2,2, 3,3,3,3, 3,3,3,2, 0,0,0,0] if day < 4
        else [0,0,0,0,0,0,0,0,0,0, 2,2, 4,4,4,4, 4,4,4,3, 0,0,0,0]
        for day in range(7)
    ]
    fac2_templates = [
        {"code": "M", "name": "Opening Shift — 10a-6p (M)", "start_hour": 10, "duration_hours": 8},
        {"code": "E", "name": "Closing Rush — 2p-10p (E)", "start_hour": 14, "duration_hours": 8},
    ]
    repo.upsert_facility(
        facility_id="FAC-VAPE-01",
        name="CloudNine Vapor & Smoke",
        location="72nd & Dodge St, Omaha, NE",
        operating_hours="10:00–22:00 Daily",
        demand_matrix=fac2_demand,
        shift_templates=fac2_templates,
    )

    # 3. West Center Spirits & Wine
    fac3_demand = [
        [0,0,0,0,0,0,0,0,0, 2,2, 3,3,3, 4,4,4,4, 3,3,3, 0,0,0] if day < 4
        else [0,0,0,0,0,0,0,0,0, 3,3, 4,4,4, 5,5,5,5, 4,4,4, 0,0,0]
        for day in range(7)
    ]
    fac3_templates = [
        {"code": "M", "name": "Morning Stock & Cash — 9a-5p (M)", "start_hour": 9, "duration_hours": 8},
        {"code": "D", "name": "Midday Peak — 12p-8p (D)", "start_hour": 12, "duration_hours": 8},
        {"code": "E", "name": "Evening Volume & Close — 4p-12a (E)", "start_hour": 16, "duration_hours": 8},
    ]
    repo.upsert_facility(
        facility_id="FAC-LIQUOR-01",
        name="West Center Spirits & Wine",
        location="132nd & Center Rd, Omaha, NE",
        operating_hours="09:00–24:00 Daily",
        demand_matrix=fac3_demand,
        shift_templates=fac3_templates,
    )

    print("Seeding Associate Roster...")
    employees_data = [
        ("EMP-01", "FAC-OMAHA-01", "Marcus Vance", "Store Lead", 22.00, [0, 1, 2, 3, 4, 5, 6], 1),
        ("EMP-02", "FAC-OMAHA-01", "Sarah Kowalski", "Shift Supervisor", 19.50, [0, 1, 2, 3, 4, 5, 6], 2),
        ("EMP-03", "FAC-OMAHA-01", "Devon Taylor", "Senior Clerk / Cash", 17.50, [0, 1, 2, 3, 4, 5, 6], 3),
        ("EMP-04", "FAC-OMAHA-01", "Carlos Morales", "Inventory Specialist", 17.00, [0, 1, 2, 3, 4, 5, 6], 4),
        ("EMP-05", "FAC-OMAHA-01", "Priya Patel", "Customer Service Clerk", 16.50, [0, 1, 2, 3, 4, 5, 6], 5),
        ("EMP-06", "FAC-OMAHA-01", "Elena Rodriguez", "Weekend Cashier", 16.50, [3, 4, 5, 6], 6),
        ("EMP-07", "FAC-OMAHA-01", "Jordan Brooks", "Floor Associate", 16.00, [0, 1, 2, 3, 4, 5, 6], None),
        ("EMP-08", "FAC-OMAHA-01", "Samira Hassan", "Closing Associate", 16.00, [1, 2, 3, 4, 5, 6], None),

        # CloudNine Staff
        ("EMP-V1", "FAC-VAPE-01", "Tyler Schmidt", "General Manager", 23.50, [0, 1, 2, 3, 4, 5, 6], 1),
        ("EMP-V2", "FAC-VAPE-01", "Aaliyah Washington", "Assistant Manager", 19.00, [0, 1, 2, 3, 4, 5, 6], 2),
        ("EMP-V3", "FAC-VAPE-01", "Zachary Chen", "Sales Specialist", 17.00, [0, 1, 2, 3, 4, 5, 6], 3),
        ("EMP-V4", "FAC-VAPE-01", "Kaitlyn Miller", "Vape Tech Associate", 16.50, [2, 3, 4, 5, 6], 4),
        ("EMP-V5", "FAC-VAPE-01", "Mason Davis", "Part-Time Clerk", 16.00, [4, 5, 6], 5),
    ]

    for emp_id, fac_id, name, role, wage, days, line in employees_data:
        existing = repo.get_employee(emp_id)
        if not existing:
            repo.create_employee(
                facility_id=fac_id,
                name=name,
                role=role,
                wage=wage,
                available_days=days,
                assigned_line=line,
                employee_id=emp_id,
            )

    conn.close()
    print("Database seeding completed successfully.")


if __name__ == "__main__":
    seed()
