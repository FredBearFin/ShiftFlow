# ShiftFlow: Commercial Pricing & Packaging Strategy

ShiftFlow has two tiers, matching the two funnels in the GTM model: a self-serve **personal tier** for the individual shift manager (the primary funnel), and an upsell **business tier** for the owner of the location (the secondary funnel, only reached after a manager has proven savings). There is no enterprise or multi-location-chain tier — ShiftFlow is deliberately not selling into hospitals, manufacturing, large chains, or enterprise accounts.

## 1. Pricing Tiers

| Tier Name | Who Buys It | Target Customer | Monthly Price | How It's Sold |
| :--- | :--- | :--- | :--- | :--- |
| **Personal** | The individual shift manager, for themselves. | A shift manager at a single-location convenience store, liquor store, smoke shop, bar, or restaurant with extended or odd hours. | **$9–15/month** (self-serve) | No sales process. Credit card signup, cancel anytime. This is the primary funnel. |
| **Business** | The business owner, for the location. | The same kind of location, once a manager using the Personal tier has a concrete savings number to show. | **$20–50/month per location** | Upsell only — triggered by a manager showing the owner a real number from the Labor Analysis view (see `sales_pitch_deck.md`). Never the first pitch. |

**What each tier includes:**
- **Personal** ($9–15/mo): fair rotating schedule generation, fatigue/rest-gap checks between closing and opening shifts, labor cost and overtime visibility, crew availability tracking, print/CSV export. Single manager, single location.
- **Business** ($20–50/mo per location): today, this is functionally the same single-manager, single-login account type as Personal at checkout — a higher price, not a different checkout mechanism yet. What *is* now built, on any tier, is the owner-invite link below, which is real multi-user access to one facility, not a bigger feature set tied to the Business price specifically. Billing/ownership transfer (the owner's payment automatically replacing the manager's, or a Business-tier signup inheriting an existing manager's account) is **not yet built**: a Business-tier signup today still creates a brand-new, separate, empty account on the pricing page rather than taking over an existing one.
- **What is built today, on any tier — and it is real access, not just visibility**: the *Invite an owner* feature gives the business owner their own separate login, linked to the manager's facility. Once accepted, that owner can open the same scheduling app the manager uses for that facility — the real staff roster, labor analysis, coverage, ergonomics audit, and new schedule solves — and can add, edit, or separate staff there too, not only read a summary number. (A fast read-only labor-cost summary is still there as a quick-glance option, but it's no longer the ceiling on what the owner can do.) That login, and the owner's access through it, persists even if the manager's own login is later deleted — a real continuity win. What this still does **not** do is move billing or merge accounts: the owner's access is additive to the existing facility, not a transfer of who pays for it.

There is intentionally no per-seat enterprise tier, no multi-location rollup pricing, and no custom contract tier at this stage. If a multi-location chain or enterprise account inquires, that is out of scope for the current wedge, not a product gap to fill.

## 2. Why the Price Is Where It Is

The Personal tier price is capped low on purpose: it is a personal-productivity purchase, not a business-ROI purchase, and $9–15/month is roughly where an individual is willing to pay out of pocket for a tool that saves them a few hours a week. We are not trying to price Personal against enterprise scheduling software's value — that comparison doesn't apply to this buyer.

The Business tier is priced higher ($20–50/location/month) because it is being justified against a company expense budget using a real, in-app labor-savings number, not against personal willingness-to-pay. It only works as a pitch once that number exists — pricing it this way before a manager has usage data would be the enterprise-SaaS mistake we're deliberately avoiding.

## 3. Known Risks & Honest Considerations

These are real risks to the model, stated plainly rather than smoothed over:

- **The real competitive substitute is free, not funded competitors.** The businesses in this wedge — true single-location convenience stores, liquor stores, smoke shops, bars, and restaurants — are mostly scheduling on paper, group texts, or a spreadsheet today, not on Homebase, 7shifts, or Deputy. Those funded competitors have not saturated this segment, but "free and already working well enough" is a harder sell than switching from a paid competitor, and our pricing and messaging need to compete against "nothing," not against another SaaS tool.
- **Personal willingness-to-pay caps the Personal tier price.** Because an individual manager is paying out of pocket, there's a real ceiling — likely not much above $15/month — on what this tier can charge regardless of how much time or labor cost it actually saves. We should not expect to raise this tier's price without changing who pays.
- **Manager turnover is a real retention risk for Personal, and the reason Business exists.** Industry-reported estimates put annual shift-manager turnover in retail and food service at roughly 28–47% a year, depending on the specific segment — this is an estimate, not a precise figure we've verified ourselves. A Personal-tier subscription is tied to one person's card and login, so it is at real risk of churning the moment that manager leaves the job. The intended fix is a Business-tier account, billed to and owned by the location, that survives a manager's departure — but automatic *billing* continuity (the owner's card taking over the subscription itself) is not yet built (see Section 1). What **is** live today, on any tier, is real *data and access* continuity through the owner-invite login: it survives the manager's own login being deleted, and it now carries full read/act access to the facility's real schedule with it, not just a summary. That's the honest core of the retention argument — the account's data and the owner's ability to actually run it don't disappear with the manager, even though the subscription/payment itself still isn't an automatic hand-off.
- **We are not leading with legal compliance, and that's deliberate.** Most Fair Workweek / predictable-scheduling laws bind large chains (commonly 30+ locations), not true single-location independents. Pitching compliance risk to this audience would be misleading. Our pitch leads with time saved, fewer scheduling mistakes, and fairness/turnover instead.

## 4. Unit Economics (Indicative, Needs Validation)

* **Personal tier ARPU**: ~$11/month (midpoint of $9–15 range).
* **Business tier ARPU**: ~$32/month per location (midpoint of $20–50 range), reached only via upsell, not direct acquisition.
* **Primary-funnel CAC** should be evaluated against self-serve digital channels (search, app-store-style discovery, word of mouth) appropriate to a $9–15/month personal purchase — not against an enterprise sales-driven CAC model.
* **Business-tier conversion rate** (Personal → Business) is the number to track most closely; it is currently an assumption, not a measured figure, until we have real usage data from the Labor Analysis view feeding real upsell attempts.
