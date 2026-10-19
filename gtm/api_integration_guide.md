# ShiftFlow Studio: Point-of-Sale (POS) & Payroll API Integration Specification

ShiftFlow Studio is designed to integrate bidirectionally with Point-of-Sale systems (to ingest actual hourly sales/transaction velocity) and Payroll engines (to push finalized hours and earnings).

```text
       ┌──────────────────┐               ┌──────────────────┐
       │   Point-of-Sale  │               │     Payroll      │
       │ (Square, Clover, │               │ (Gusto, ADP,     │
       │  Toast, Lightspd)│               │  Paychex, QuickB)│
       └────────┬─────────┘               └────────▲─────────┘
                │ Hourly Sales / Volume            │ Approved Roster Hours
                ▼                                  │ & Overtime Breakdown
       ┌───────────────────────────────────────────┴─────────┐
       │             ShiftFlow Studio Core Engine            │
       │  (Tristan Becker 2026 I-SD-RWSP Eulerian Solver)    │
       └─────────────────────────────────────────────────────┘
```

---

## 1. Point-of-Sale Demand Ingestion Endpoint

### `POST /api/v1/integrations/pos/demand-sync`
Allows POS platforms (Square, Clover, Toast) to stream hourly sales transaction volume to automatically calibrate the staffing demand matrix $R_{gi}$.

#### Request Payload
```json
{
  "facility_id": "STORE-104",
  "pos_provider": "square",
  "sync_week_start": "2026-10-19",
  "hourly_transactions": [
    {
      "day_index": 0,
      "hour": 11,
      "transactions_count": 84,
      "recommended_registers": 4
    },
    {
      "day_index": 0,
      "hour": 12,
      "transactions_count": 112,
      "recommended_registers": 5
    }
  ]
}
```

#### Response
```json
{
  "status": "calibrated",
  "updated_intervals_count": 168,
  "next_solve_recommended": true
}
```

---

## 2. Payroll Export Webhook Endpoint

### `POST /api/v1/integrations/payroll/export`
Exports finalized cyclic roster hours, regular hours, and overtime hours directly into payroll providers (Gusto, ADP Run, Paychex Flex).

#### Request Payload
```json
{
  "facility_id": "STORE-104",
  "payroll_provider": "gusto",
  "pay_period_start": "2026-10-19",
  "pay_period_end": "2026-10-25"
}
```

#### Response Payload (Sent to Payroll Provider API)
```json
{
  "pay_period": {
    "start_date": "2026-10-19",
    "end_date": "2026-10-25"
  },
  "employees": [
    {
      "employee_id": "EMP-01",
      "name": "Marcus Vance",
      "line_id": 1,
      "regular_hours": 40.0,
      "overtime_hours": 0.0,
      "hourly_rate": 22.00,
      "gross_pay": 880.00
    },
    {
      "employee_id": "EMP-02",
      "name": "Sarah Kowalski",
      "line_id": 2,
      "regular_hours": 40.0,
      "overtime_hours": 2.0,
      "hourly_rate": 19.50,
      "gross_pay": 838.50
    }
  ],
  "totals": {
    "total_regular_hours": 320.0,
    "total_overtime_hours": 4.0,
    "total_gross_payroll": 5612.00
  }
}
```
