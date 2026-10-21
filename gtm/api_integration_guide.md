# ShiftFlow Studio: Point-of-Sale (POS) & Payroll API Integration Specification

**Status: built, but off by default — not part of the V1 product surface.** This integration is real, working code (see `backend/app/api` POS/payroll routes), but it is gated behind a feature flag (`enable_pos_integration` in `backend/app/config.py`, default `false`) that 404s the routes unless explicitly enabled via environment variable. It was built during an earlier "enterprise workforce OS" phase of the product and is kept rather than deleted, but it is not something a self-serve Personal- or Business-tier signup gets access to today, and it is not currently part of the sales pitch or onboarding flow (see `commercial_pricing.md` and `sales_pitch_deck.md` for what *is* sold today). Treat everything below as a specification for a capability that exists in the codebase but is dormant, not as a description of what a new customer experiences.

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
