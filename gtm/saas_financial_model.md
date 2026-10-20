# ShiftFlow Studio: 24-Month Commercial SaaS Pro-Forma & Operating Model

## 1. Unit Economics & Pricing Model Summary

ShiftFlow Studio monetizes via a pure B2B monthly subscription tiered by retail footprint and functionality:
- **Starter Tier ($79/mo)**: Single-location stores (up to 12 staff). Covers ISD-RWSP solver, cyclic line rotation, zero-clopening check (blocks a closing shift followed by an opening shift when enforce_zero_clopening is on), and CSV exports.
- **Growth Tier ($199/mo)**: Multi-unit operators (2–5 stores). Includes live overtime KPIs, employee availability matching, and POS sales ingestion.
- **Fleet Tier ($39/store/mo, min 4 stores)**: Regional chains and franchisees (4–25 stores). Includes multi-store rollup dashboards, Gusto/ADP CSV export, and centralized payroll sync.

### Key Financial Unit Metrics
- **Blended Average Revenue Per User (ARPU)**: **$139 / month** ($1,668 / year)
- **Gross Margin**: **88.4%** (lightweight computational solver footprint on containerized infrastructure)
- **Customer Acquisition Cost (CAC)**: **$95** (founder-led local walk-ins, license database scraping, and cold email outbound)
- **Monthly Customer Churn**: **2.66%** (162 churned / 6,080 opening stores, M13-M24)
- **Customer Lifetime (1 / churn)**: **37.6 months** (1 / 2.66%)
- **Customer Lifetime Value (LTV)**: $139 x 88.4% x 37.6 = **$4,620**
- **LTV / CAC Ratio**: **48.6x** (exceptional capital efficiency)
- **CAC Payback Period**: 0.8 months (CAC / (ARPU x gross margin))

---

## 2. 24-Month Month-by-Month Operating Projections

| Month | Active Stores | New Stores Added | Churned Stores | MRR ($) | ARR Run-Rate ($) | Hosting & Infra ($) | Gross Profit ($) | Gross Margin (%) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **M01** | 10 | 10 | 0 | $790 | $9,480 | $120 | $670 | 84.8% |
| **M02** | 22 | 12 | 0 | $1,858 | $22,296 | $140 | $1,718 | 92.5% |
| **M03** | 38 | 17 | 1 | $3,454 | $41,448 | $180 | $3,274 | 94.8% |
| **M04** | 56 | 19 | 1 | $5,472 | $65,664 | $240 | $5,232 | 95.6% |
| **M05** | 76 | 21 | 1 | $7,844 | $94,128 | $310 | $7,534 | 96.0% |
| **M06** | 98 | 24 | 2 | $10,542 | $126,504 | $390 | $10,152 | 96.3% |
| **M07** | 122 | 26 | 2 | $13,602 | $163,224 | $480 | $13,122 | 96.5% |
| **M08** | 148 | 29 | 3 | $17,042 | $204,504 | $590 | $16,452 | 96.5% |
| **M09** | 176 | 32 | 4 | $20,832 | $249,984 | $710 | $20,122 | 96.6% |
| **M10** | 206 | 35 | 5 | $24,992 | $299,904 | $840 | $24,152 | 96.6% |
| **M11** | 238 | 38 | 6 | $29,482 | $353,784 | $980 | $28,502 | 96.7% |
| **M12** | **272** | 41 | 7 | **$34,312** | **$411,744** | $1,140 | $33,172 | 96.7% |
| **M13** | 308 | 44 | 8 | $39,472 | $473,664 | $1,320 | $38,152 | 96.7% |
| **M14** | 346 | 47 | 9 | $44,972 | $539,664 | $1,510 | $43,462 | 96.6% |
| **M15** | 386 | 50 | 10 | $50,792 | $609,504 | $1,720 | $49,072 | 96.6% |
| **M16** | 428 | 53 | 11 | $56,932 | $683,184 | $1,950 | $54,982 | 96.6% |
| **M17** | 472 | 56 | 12 | $63,392 | $760,704 | $2,200 | $61,192 | 96.5% |
| **M18** | 518 | 59 | 13 | $70,172 | $842,064 | $2,470 | $67,702 | 96.5% |
| **M19** | 566 | 62 | 14 | $77,272 | $927,264 | $2,760 | $74,512 | 96.4% |
| **M20** | 616 | 65 | 15 | $84,692 | $1,016,304 | $3,070 | $81,622 | 96.4% |
| **M21** | 668 | 68 | 16 | $92,432 | $1,109,184 | $3,400 | $89,032 | 96.3% |
| **M22** | 722 | 71 | 17 | $100,492 | $1,205,904 | $3,750 | $96,742 | 96.3% |
| **M23** | 778 | 74 | 18 | $108,872 | $1,306,464 | $4,120 | $104,752 | 96.2% |
| **M24** | **836** | 77 | 19 | **$117,572** | **$1,410,864** | $4,510 | $113,062 | 96.2% |

---

## 3. Financial Milestones & Inflection Points

1. **Month 6 ($10.5k MRR / $126k ARR)**: Cash-flow positive operations covering founder living expenses and initial customer support contractor.
2. **Month 12 ($34.3k MRR / $411k ARR)**: 272 store footprint across Nebraska, Iowa, and Kansas. Hire first full-time customer success manager and dedicated integrations engineer.
3. **Month 20 ($84.7k MRR / $1.01M ARR)**: Exceeds **$1,000,000 ARR** run-rate with 616 retail stores, maintaining >96% software gross margins.

---

## 4. Cost Structure Breakdown (at Month 12 Scale)

- **Hosting & Infrastructure**: $1,140 / mo
  - AWS ECS Fargate (2x multi-AZ container tasks): $240
  - AWS Aurora Serverless PostgreSQL / SQLite replicate: $180
  - Cloudflare Pro (WAF, SSL, caching): $40
  - Datadog / Sentry monitoring: $180
  - Twilio / SendGrid transactional SMS & emails: $500
- **Customer Acquisition & Marketing**: $3,895 / mo (41 new stores × $95 CAC)
  - State alcohol/tobacco public registry scraping tools: $150
  - Cold email infrastructure (domains, warmup, Instantly): $380
  - Direct local travel & founder in-person store visits: $1,200
  - Paid search & POS marketplace sponsorships: $2,165
- **Net Operating Margin (Month 12)**: **$29,277 / month** (modeled 85.3% of $34,312 M12 MRR; excludes staff salaries, which the model does not include).
