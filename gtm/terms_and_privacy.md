> STATUS: hypothesis document written for a small-business pitch. Figures are planning estimates, not validated. Do not quote externally. See docs/PLAN_V2.md.

# ShiftFlow Studio: Commercial SaaS Agreement & Privacy Terms

## 1. Master Software-as-a-Service (SaaS) Agreement

This Master SaaS Agreement ("Agreement") governs access to and use of the ShiftFlow Studio scheduling platform ("Service") provided by ShiftFlow Inc. ("Provider") to the subscriber ("Customer") — typically an individual shift manager at a single-location convenience store, liquor store, smoke shop, bar, or restaurant, or, on the Business tier, the owner of that location.

### 1.1 Subscription License & Scope
Provider grants Customer a non-exclusive, non-transferable subscription license to access the ShiftFlow Studio platform for managing employee shift schedules, availability, and labor analytics for the single location authorized under Customer's active subscription tier (**Personal** or **Business** — see `commercial_pricing.md` for current pricing and what each tier includes). Payroll export (e.g., to Gusto or ADP) and point-of-sale integration are optional, separately-enabled capabilities and are **off by default** on both tiers; see `api_integration_guide.md`. There is no multi-location "Fleet" or enterprise tier at this stage.

### 1.2 Service Level Agreement (SLA) & Uptime
Provider warrants a 99.9% monthly service availability commitment for cloud API and roster access, excluding scheduled maintenance windows announced $\ge 48$ hours in advance.

### 1.3 Labor & Regulatory Compliance
Customer acknowledges that ShiftFlow Studio provides mathematical scheduling optimization, circadian rotation modeling, and overtime calculations based on Customer-defined inputs. Customer remains solely responsible for ensuring final published rosters comply with applicable municipal, state, and federal labor laws, including:
- Fair Labor Standards Act (FLSA) overtime rules (29 U.S.C. § 207)
- Municipal Fair Workweek predictive scheduling ordinances
- Mandatory rest interval requirements

---

## 2. Retail Employee Data Privacy Policy

ShiftFlow Studio adheres to strict data minimization principles regarding workforce personally identifiable information (PII).

### 2.1 Information Collected & Processed
To generate workforce rosters, ShiftFlow Studio processes:
- **Associate Identifiers**: Associate Name, Internal Staff ID, and Job Title/Role.
- **Compensation Metadata**: Hourly base wage rate and overtime rate multiplier (used for in-app labor spend analytics; also used for Gusto/ADP export generation if Customer has that optional integration enabled — see note below).
- **Scheduling Parameters**: Day-of-week availability (Mon–Sun), shift preferences, and assigned cyclic rotation lines.
- **POS Velocity Metrics**: Anonymized hourly transaction totals and sales volume, used solely to calibrate interval demand $R_{gi}$ — collected only if Customer has enabled the optional POS integration described below.

> **Integration status**: Payroll export (Gusto/ADP) and POS ingestion are real, built capabilities, but they are **off by default** for every Customer and must be explicitly enabled — they are not part of the default V1 product surface. See `api_integration_guide.md` for current status. A Customer who never enables them never has the data above collected or processed in connection with those integrations.

### 2.2 Data Security & Storage
- **Encryption**: All data in transit is encrypted using TLS 1.3. All persistent data at rest is encrypted using AES-256.
- **No Third-Party Monetization**: Provider does not sell, broker, or monetize employee or store scheduling data under any circumstances.
- **Access Control**: Role-based access controls (RBAC) ensure only authorized facility managers and administrators have access to employee wage records and store payroll totals.

### 2.3 Data Retention & Deletion
Upon account termination or cancellation, Customer may export all historical rosters, employee availability records, and payroll audits in standard RFC-4180 CSV format. Provider permanently purges Customer data from production systems within 30 days of written account closure.
