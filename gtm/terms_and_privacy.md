# ShiftFlow Studio: Commercial SaaS Agreement & Privacy Terms

## 1. Master Software-as-a-Service (SaaS) Agreement

This Master SaaS Agreement ("Agreement") governs access to and use of the ShiftFlow Studio enterprise workforce scheduling platform ("Service") provided by ShiftFlow Inc. ("Provider") to the commercial retail subscriber ("Customer").

### 1.1 Subscription License & Scope
Provider grants Customer a non-exclusive, non-transferable commercial subscription license to access the ShiftFlow Studio platform for managing employee shift schedules, availability, labor analytics, and payroll exports for the number of retail locations authorized under Customer's active subscription tier (Starter, Growth, or Fleet).

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
To generate compliant workforce rosters, ShiftFlow Studio processes:
- **Associate Identifiers**: Associate Name, Internal Staff ID, and Job Title/Role.
- **Compensation Metadata**: Hourly base wage rate and overtime rate multiplier (used exclusively for in-app labor spend analytics and Gusto/ADP export generation).
- **Scheduling Parameters**: Day-of-week availability (Mon–Sun), shift preferences, and assigned cyclic rotation lines.
- **POS Velocity Metrics**: Anonymized hourly transaction totals and sales volume (used solely to calibrate interval demand $R_{gi}$).

### 2.2 Data Security & Storage
- **Encryption**: All data in transit is encrypted using TLS 1.3. All persistent data at rest is encrypted using AES-256.
- **No Third-Party Monetization**: Provider does not sell, broker, or monetize employee or store scheduling data under any circumstances.
- **Access Control**: Role-based access controls (RBAC) ensure only authorized facility managers and administrators have access to employee wage records and store payroll totals.

### 2.3 Data Retention & Deletion
Upon account termination or cancellation, Customer may export all historical rosters, employee availability records, and payroll audits in standard RFC-4180 CSV format. Provider permanently purges Customer data from production systems within 30 days of written account closure.
