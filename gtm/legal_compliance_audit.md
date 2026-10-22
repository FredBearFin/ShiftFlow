> STATUS: hypothesis document written for a small-business pitch. Figures are planning estimates, not validated. Do not quote externally. See docs/PLAN_V2.md.

# Compliance Research Notes: Legal Topics Relevant to ShiftFlow's Scheduling Logic
**INFORMAL RESEARCH NOTES — NOT LEGAL ADVICE**

**TO:** Founder (product/engineering planning notes)  
**PREPARED USING:** General employment-law research, not a retained law firm or in-house counsel — ShiftFlow is a solo-founder, self-serve product with no legal department. Nothing in this document is legal advice, and before relying on any of it for a real compliance claim to customers, it should be reviewed by an actual employment attorney.  
**DATE:** October 19, 2026  
**SUBJECT:** Legal/regulatory topics worth keeping in mind for ShiftFlow's scheduling and rotation logic

---

### WHY THIS DOCUMENT EXISTS, AND ITS LIMITS

The topics below (wage/hour law, accommodation law, retaliation risk, recordkeeping) are real and apply to scheduling software in general, regardless of company size — they're worth having written down. But two things in the original draft of this document overstated the situation and have been corrected:

1. **Audience/tone**: the original was framed as a formal memo to "Executive Leadership, Product Engineering, & General Counsel" from an "Employment, Labor & Regulatory Technology Practice Group." ShiftFlow has none of those — it's a solo-founder product sold self-serve to individual shift managers. This is now framed as what it actually is: informal research notes for the founder's own product decisions.
2. **Audience risk**: per `commercial_pricing.md` §3, most Fair Workweek / predictable-scheduling laws bind large chains (commonly 30+ locations), not the true single-location independents ShiftFlow actually sells to. We deliberately do **not** lead with compliance in marketing or sales messaging, because pitching compliance risk to this audience would often be misleading — most of our actual customers aren't the chains these laws target. The legal topics below are still real and still worth tracking (a customer could grow, laws could change, or a given city's threshold could be lower than 30 locations), but they should not be read as "this is why our customers need us," because for most of them today, it isn't.

This document covers five legal/statutory topics relevant to scheduling software generally:
1. **Municipal & State "Fair Workweek" (Predictive Scheduling) Laws**
2. **Fair Labor Standards Act (FLSA) Overtime & Workweek Standalone Rules**
3. **Title VII & ADA Failure-to-Accommodate & Disparate Impact Risks**
4. **Wrongful Termination, Retaliation, & Constructive Discharge Traps in UI Workflows**
5. **Statutory Recordkeeping (29 C.F.R. § 516.5) & Terms-of-Service Protections**

---

## 1. FAIR WORKWEEK & PREDICTIVE SCHEDULING LAWS

A rapidly expanding bloc of jurisdictions (Oregon statewide, Chicago, Seattle, New York City, Philadelphia, San Francisco, Los Angeles, and Washington D.C.) enforces mandatory predictive scheduling statutes with severe financial penalties.

### 1.1 The Mandatory Rest Interval ("Clopening" Rest Rule)
- **The Statutory Rule**: State and local statutes (e.g., Seattle Municipal Code § 14.22.035, Oregon Rev. Stat. § 653.455, Chicago Municipal Code § 1-25-050) prohibit employers from scheduling closing and opening shifts separated by less than **10 to 11 consecutive hours** unless:
  1. The employee explicitly consents in writing; AND
  2. The employer pays a statutory premium of **1.25× to 1.5× regular pay** for all hours worked during the rest interval.
- **ShiftFlow Legal Architecture**: ShiftFlow Studio enforces a mathematical constraint of **$\ge 16$ hours of rest** ($M \preceq D \preceq E \preceq N$). 
  - *Legal Benefit*: By establishing a 16-hour mandatory buffer, ShiftFlow exceeds the 10-to-11-hour thresholds above. The generator keeps at least 16 hours between shifts by default (a house rule, not a legal standard) and the audit flags any shorter gap. Whether that avoids municipal premiums or penalties ($500–$1,000 per violation in some jurisdictions) is a question for counsel.
  - *Required Product Hardening*: The solver must treat $\ge 16$h as a non-negotiable hard constraint ($\mathcal{E}_{\text{forbidden}}$), preventing managerial overrides from triggering unindemnified municipal fines.

### 1.2 Mandatory Advance Notice & Predictability Pay
- **The Statutory Rule**: Jurisdictions mandate publishing final employee rosters **14 days in advance** of the first scheduled shift. Any employer-initiated shift modification, cancellation, or addition triggers statutory "Predictability Pay" (typically 1 to 4 hours of wages at the regular rate).
- **Cyclic Line Advance Publication (no safe harbor is claimed)**: The cyclic line model (`Line 1` to `Line N`) is fundamentally predictive. Because rotation sequences are mathematically determined across the multi-week cycle, employers may be able to publish 4- to 8-week roster schedules in advance. This is not legal advice and does not assess Fair Workweek or any other statute.
- **Statutory Risk**: If a store manager advances a week or rebinds lines with less than 14 days' notice, the software could inadvertently expose the employer to predictability pay claims.
- **Remediation**: The software must lock published schedules inside the 14-day statutory window and display a **Predictability Pay Liability Counter** if managerial modifications are attempted.

---

## 2. FAIR LABOR STANDARDS ACT (FLSA) WAGE & HOUR COMPLIANCE

Under 29 U.S.C. § 207(a)(1), non-exempt employees must receive overtime compensation at not less than **1.5 times the regular rate** for all hours worked in excess of 40 hours during a workweek.

### 2.1 The "Workweek Standalone Rule" (29 C.F.R. § 778.104)
- **The Legal Trap**: In rotating and cyclic shift schedules, employers frequently commit the fatal legal error of "averaging" hours across payroll cycles (e.g., scheduling 48 hours in Week 1 and 32 hours in Week 2, paying an average of 40 hours per week).
- **The Statutory Mandate**: 29 C.F.R. § 778.104 expressly prohibits averaging hours across workweeks. Each workweek stands alone. An employee working 48 hours in Week 1 is legally owed 8 hours of overtime, regardless of their schedule in subsequent weeks.
- **ShiftFlow Compliance**: ShiftFlow calculates regular and overtime hours strictly on a **single 7-day workweek basis (Mon 00:00 to Sun 23:59)**. Line payroll computations never smooth or offset overtime across cycle weeks, insulating operators from Department of Labor (DOL) liquidated damages (200% back-pay under 29 U.S.C. § 216(b)) and prevailing plaintiff attorney fees.

### 2.2 Shift Leeway & Buffer Economics
- In Tristan Becker's (2026) formulation, a 5% to 10% shift design leeway adjusts start and end windows (e.g., 30–45 minutes).
- **FLSA Rule**: Every minute an employee is suffered or permitted to work is compensable working time under 29 C.F.R. § 785.11. Shift leeway must never mean unrecorded early arrival or late departure. Where the (currently off-by-default — see `api_integration_guide.md`) Gusto/ADP export is enabled, it must tie strictly to recorded time windows.

---

## 3. TITLE VII & ADA ACCOMMODATION / DISPARATE IMPACT RISKS

Under Title VII of the Civil Rights Act of 1964 (42 U.S.C. § 2000e(j)) and the Americans with Disabilities Act (ADA, 42 U.S.C. § 12112), employers have an affirmative duty to reasonably accommodate employees' sincerely held religious beliefs and medical disabilities.

### 3.1 Religious Accommodation (The Sabbath Conflict)
- **The Case Law**: Under the Supreme Court's unanimous ruling in *Groff v. DeJoy*, 600 U.S. 447 (2023), an employer can deny a religious accommodation (such as Sabbath observance from Friday sundown to Saturday sundown) only if granting it would result in "substantial increased costs in relation to the conduct of its particular business."
- **The Algorithmic Danger**: If ShiftFlow rotates all workers mechanically through Line 1..N, an employee with a religious accommodation will inevitably rotate into a Friday evening or Saturday shift. If the system flags this as an unassigned slot or forces a manager confrontation, the employer faces immediate Title VII disparate impact and failure-to-accommodate claims.
- **Engineering Solution**: The Staff Directory's availability matrix must support **Statutory Protected Exclusions**. When an associate is designated with a religious or medical constraint, the solver must treat that constraint as an invariant hard bound and route the associate exclusively through lines that never touch the protected days.

### 3.2 ADA & Intermittent FMLA Leave
- Employees with certified medical restrictions (e.g., maximum 8-hour shifts, mandatory 2 consecutive rest days, no overnight shifts) must have those parameters hard-locked into their employee schema. The software must prevent rotation assignments that violate documented medical accommodations.

---

## 4. WRONGFUL TERMINATION & RETALIATION WORKFLOW HAZARDS

Under state common law and federal retaliation statutes (Title VII § 704(a), FLSA § 15(a)(3), OSHA § 11(c)), an employer cannot terminate, demote, or materially alter an employee's hours in retaliation for protected activities.

### 4.1 The "Instant Fire / Deactivate" Button Vulnerability
- In the existing UI, managers can click a single button ("Deactivate / Fire") that immediately strips an employee from the rotation line.
- **The Legal Risk**: If an untrained frontline manager clicks "Deactivate" 24 hours after an associate complained about unpaid overtime or filed a workers' compensation claim, the timing creates a prime facie presumption of unlawful retaliation under *McDonnell Douglas Corp. v. Green*.
- **Required Product Enhancement**:
  1. **Mandatory Termination Rationale Dialogue**: Require the manager to designate the termination type (Voluntary Resignation, Mutual Separation, Involuntary for Cause, Layoff/Staff Reduction).
  2. **Audit Log & Temporal Timestamping**: Record who executed the deactivation, the timestamp, and the business justification, establishing contemporaneous documentary evidence.
  3. **Constructive Discharge Warning**: If a manager reduces an associate's scheduled hours by $>50\%$ without deactivating them, flag a constructive discharge / partial unemployment notice.

---

## 5. STATUTORY RECORDKEEPING & TERMS-OF-SERVICE PROTECTIONS

### 5.1 FLSA 3-Year Recordkeeping Mandate (29 C.F.R. § 516.5)
- Federal law mandates that employers retain all basic payroll records for **3 years**, and all work schedules, wage rate tables, and order records for **2 years**.
- ShiftFlow’s database architecture must maintain immutable, append-only historical roster snapshots (`roster_snapshots` table) to serve as verified evidence during federal DOL wage audits.

### 5.2 Terms-of-Service Disclaimers (no safe harbor is claimed)
To insulate ShiftFlow Inc. from direct vicarious liability for managerial labor infractions, the terms of service (`terms_and_privacy.md`) should incorporate:
1. **Disclaimer of Legal & Tax Advice**: Explicit disclaimer that ShiftFlow provides mathematical optimization algorithms, not certified employment law counsel.
2. **Customer Compliance Responsibility**: Customer (the manager or business signing up) is responsible for ensuring final published rosters comply with applicable labor laws and any collective bargaining agreements (CBAs), holding ShiftFlow harmless against wage claims. "Indemnification" language sized for a B2B enterprise contract is probably overkill for a $9–15/month self-serve consumer-style agreement — plain responsibility language is more appropriate and more enforceable against an individual subscriber.
3. **Limitation of Liability**: Consequential damages waiver capping liability at a reasonable multiple of subscription fees paid — 12 months was the original figure, but for a $9–15/mo or $20–50/mo subscription that's a small absolute dollar amount either way, so the exact multiple is a minor drafting detail, not a meaningful business risk.

---

### ACTIONABLE LEGAL ROADMAP & ENGINEERING SPECIFICATION

| Priority | Feature / Guardrail | Target Component | Legal Protection / Statute |
| :---: | :--- | :--- | :--- |
| **P0** | **Hard Clopening Rest Rule ($\ge 16$h)** | `isd_rwsp_solver.py` | Targets municipal Fair Workweek premium exposure ($500/violation) |
| **P0** | **Workweek Standalone Overtime** | `payroll_export.py` | Compliance with 29 C.F.R. § 778.104; eliminates 200% liquidated damages |
| **P1** | **Religious & Medical Hard Invariants** | `employee_routes.py` | Title VII (*Groff v. DeJoy*) & ADA failure-to-accommodate liability risk reduction |
| **P1** | **Structured Deactivation Workflow** | `StaffDirectoryView.tsx` | Controverts pretextual retaliation claims under FLSA § 15(a)(3) |
| **P2** | **3-Year Immutable Audit Snapshots** | `database.py` | Satisfies DOL recordkeeping under 29 C.F.R. § 516.5 |
| **P2** | **Predictability Pay Notice Warning** | `MasterRosterView.tsx` | Alerts managers modifying schedules within statutory 14-day notice windows |
