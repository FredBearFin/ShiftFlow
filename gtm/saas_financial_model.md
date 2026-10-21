# ShiftFlow: Unit Economics & Financial Model — Status and Open Questions

**This file previously described a different product and go-to-market motion than the one that actually got built.** The tiers, prices, and every projection below it were built around a B2B, per-store enterprise sales model (Starter/Growth/Enterprise Fleet tiers, $79–$199/mo plus a $39/store fleet tier, a founder doing local walk-ins and cold outbound to sign individual "stores"). The real product is a self-serve tool sold directly to an individual shift manager, with pricing and packaging defined in `commercial_pricing.md` — that file is the source of truth; this one is reconciled to it below. Where the old projections depended on the discarded sales model (not just on the price numbers), they are retired rather than re-computed with new, equally fabricated precision — see the notes in each section for what that means in practice.

## 1. Pricing Tiers (corrected)

ShiftFlow has two tiers (see `commercial_pricing.md` for full detail):
- **Personal** — **$9–15/month**, self-serve, credit card signup, cancel anytime. Sold to the individual shift manager at a single-location convenience store, liquor store, smoke shop, bar, or restaurant. This is the primary funnel.
- **Business** — **$20–50/month per location**, upsell-only, sold to the business owner after a manager on Personal has shown a real savings number. There is no multi-location "Fleet" tier, no per-store minimum, and no enterprise/custom-contract tier — ShiftFlow is deliberately not selling into regional chains or franchise fleets.

### Key Financial Unit Metrics — reconciled to real pricing

- **Personal ARPU**: ~$11/month (midpoint of $9–15). This replaces the old "$139 blended ARPU," which was calculated off tier prices ($79/$199/$39-per-store) that were never actually built or charged.
- **Business ARPU**: ~$32/month per location (midpoint of $20–50), reached only via upsell, not direct acquisition.
- **Blended ARPU**: not meaningful yet. Business is upsell-only (there is no way to buy it as a first purchase), and billing/ownership transfer from Personal to Business isn't built yet (a Business signup today creates a brand-new empty account rather than taking over an existing manager's account — see `commercial_pricing.md` §1). Any single blended number would imply a customer mix we have no data on; stating one would just be a new invented figure replacing the old one.
- **Gross margin**: likely still high (the compute footprint is lightweight regardless of pricing), but the old **88.4%** figure was reverse-engineered from the discarded $139 ARPU and infrastructure-cost assumptions sized for a multi-store B2B product. We have not re-derived a margin figure from the real product's actual hosting costs and real customer volumes, so no number is given here — treat "likely high, >70–80%" as a plausible-but-unverified estimate, not a stated fact.
- **Customer Acquisition Cost (CAC)**: **unknown.** The old $95 figure assumed founder-led local walk-ins, license-database scraping, and cold email outbound to multi-store operators — an enterprise sales motion. The real Personal-tier funnel is self-serve digital acquisition (search, app-store-style discovery, word of mouth per `commercial_pricing.md` §4); we have no CAC data for that channel mix and shouldn't invent one.
- **Monthly churn**: **unknown.** The old 2.66% figure was computed from a fabricated 24-month store cohort that never existed. The one real, named retention risk is *manager turnover*, estimated (not measured) at roughly 28–47%/year in retail and food service per `commercial_pricing.md` §3 — and that's a proxy for account-at-risk, not a measured subscription-churn rate.
- **Customer lifetime, LTV, LTV/CAC, CAC payback**: **cannot be honestly computed** without real churn and CAC inputs above. The old figures ($4,620 LTV, 48.6x LTV/CAC, 0.8-month payback) are retired along with their inputs, not replaced with new placeholder numbers.

---

## 2. 24-Month Month-by-Month Operating Projections — retired

The table that used to sit here modeled a founder signing individual "stores" directly (10–41 new stores/month, scaling to 836 stores by Month 24 across Nebraska/Iowa/Kansas) at Starter/Growth/Fleet prices. That adoption curve is not just priced wrong, it assumes the wrong motion: the real primary funnel is an individual manager signing up themselves online, not a founder or sales rep closing "stores" one at a time, and the real secondary (Business) funnel only opens after that manager already has savings data to show an owner — it isn't a parallel acquisition channel with its own ramp.

We don't have real self-serve signup, conversion, or retention data yet to build an honest replacement ramp, and inventing a new month-by-month curve with different but equally made-up adoption/conversion assumptions would repeat the same mistake with new numbers. Until there's real usage data (see `commercial_pricing.md` §4, "Unit Economics (Indicative, Needs Validation)"), this section should stay empty rather than hold a plausible-looking fiction.

---

## 3. Financial Milestones & Inflection Points — retired

The three milestones previously here (cash-flow positive at a specific MRR, hiring a "first full-time customer success manager and dedicated integrations engineer" at Month 12, crossing $1M ARR with a 616-store footprint) were all downstream of the retired Section 2 table and the discarded enterprise sales model. A solo-founder, self-serve product doesn't have a comparable milestone set yet — restating them with smaller numbers would still be fabricated precision. Real milestones should be added here once there's actual self-serve signup/upsell data to anchor them to.

---

## 4. Cost Structure — partially reconciled

- **Hosting & infrastructure**: the line items below (compute, DB, CDN/WAF, monitoring, transactional email/SMS) are architecture costs, not pricing-tier-dependent, so they're plausible in shape regardless of which GTM model is real. The dollar amounts were sized for the old multi-hundred-"store" scale, though, so treat them as illustrative per-service line items rather than a validated Month-12 total:
  - AWS ECS Fargate (containers), a managed Postgres/SQLite tier, Cloudflare (WAF/SSL/caching), Datadog/Sentry monitoring, Twilio/SendGrid for transactional email/SMS.
- **Customer acquisition cost**: **retired, not restated.** The old breakdown (state registry scraping, cold-email infrastructure, "founder in-person store visits," paid search/POS marketplace sponsorships) describes outbound/local enterprise sales spend, not the self-serve digital channels (search, app-store-style discovery, word of mouth) that `commercial_pricing.md` §4 says the real funnel should be evaluated against. We have no real spend or CAC data for that channel mix yet, so no dollar figure is given.
- **Net operating margin**: not restated, since it was derived entirely from the retired Month-12 MRR figure above. It excludes founder/staff compensation in any case, so even the old figure wasn't a full P&L bottom line.
