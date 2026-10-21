# Live Demo Script

The literal, click-by-click walkthrough for a live demo call (or a video) with a
prospective manager or owner. Everything below is written against the real app
as it actually behaves today, verified live this session - not aspirational
copy. If the app's wording changes later, update this script to match it, not
the other way around.

Keep the whole thing under 10 minutes. The goal of the call isn't to show
every feature - it's to get them signed up and using it on their own schedule
this week.

---

## Before the call

- Have the app open to the signup/pricing page already, logged out, so you
  start exactly where they will.
- Know their business type going in if you can (convenience store, liquor
  store, bar, restaurant) so you pick the closest preset live instead of
  fumbling through options on screen.
- Do **not** promise anything from `gtm/commercial_pricing.md`'s "not built
  yet" list - no multi-seat Business tier, no billing hand-off. If the real
  continuity story comes up, that's the owner-invite feature (step 7 below),
  not a tier upgrade.

## The walkthrough

**1. Land on pricing, pick a plan.** Show the Personal tier card - $9-15/mo,
one manager, billed personally, no card required for the demo. Don't dwell
here; the point is "there's no sales process, you'd do this yourself in 30
seconds."

**2. Sign up.** Email + password. You're in the app immediately - no
confirmation email, no waiting.

**3. Onboarding wizard, step 1.** It opens with plain questions (open days,
hours, busiest period, peak/minimum staff, weekend pattern) - not a business-
type picker. If you want to start from something closer to their real setup,
click **"Not sure where to start? Load an example you can edit"** and pick
whichever is closest: *Convenience store or smoke shop* or *Liquor store,
bar, or restaurant* are the two retail-native ones and will match most
prospects. Say out loud: "This is a real example, not a mockup - everything
after this is editable."

**4. Walk the remaining 5 steps fast.** Staffing needs → shift times →
scheduling rules → the cost-vs-rest slider → add one real staff member (use
their actual first employee's name and wage if they've told you it, or a
placeholder like "Jordan, $16/hr" if not). The "Finish setup" button stays
disabled until at least one staffer exists - that's intentional, point it out
if they ask why it's greyed out.

**5. The schedule appears.** This is the moment - a real, solved weekly
schedule, generated in the time it took to answer six questions. Let it sit
on screen for a second before talking.

**6. Three tabs, in this order, each with one sentence:**
   - **Payroll & Hours** - point at the weekly payroll number and the
     overtime figure. Say: "This is the number that would otherwise cost you
     [X] hours a week to work out by hand."
   - **Burnout Check** - point at the Night/Weekend Fairness card. Say:
     "This is what keeps your best people from quitting over an unfair
     rotation - it's not guessing, it's counted."
   - **Cost vs. Fairness** - this is optional/for the curious prospect. If
     they're engaged, show that nudging the slider trades a little cost for
     a lot less fatigue. Don't force it if they're not technical.

**7. The owner-upsell moment - only if you're talking to the manager, not the
owner, and only after step 6 has landed.** Go to **Staff & Availability**,
show the **"Invite an owner"** panel. Say: "If you ever leave this job, the
schedule doesn't walk out with you - invite the owner once, and their login
keeps working even if yours doesn't. They get full access to this same
schedule, not just a summary." Don't claim billing moves with it - it
doesn't yet (see `gtm/commercial_pricing.md` §3). If they ask whether the
owner pays going forward, the honest answer today is: the owner can be
invited for free visibility and continuity; a separate paid Business-tier
signup is a distinct account, not an automatic upgrade, until that's built.

**8. Close with "Copy summary for owner."** Back on **Payroll & Hours**,
click it live. Say: "This is what you'd actually send your boss - not a
pitch, just the real numbers, one click." This is the natural bridge from
"the manager is using it" to "the owner hears about it."

## After the call

- If they signed up during the call, you're done - don't oversell further,
  let them use it.
- If they didn't, the follow-up email in `gtm/launch_marketing_copy.md`
  Section 1 is the one to send, not a generic pitch.
- Log the call in `gtm/target_prospect_database.csv` with whatever pitch
  angle actually landed, so later outreach doesn't repeat what didn't work.

## What not to do

- Don't demo the Pareto/scenario-compare tab unless they're clearly
  comfortable with the schedule tabs already - it's real depth, not a
  first-five-minutes feature.
- Don't mention POS integration, emergency workflows, or shift handover -
  they exist in the codebase but are off by default and out of scope for
  this wedge (see `gtm/api_integration_guide.md`).
- Don't claim legal compliance as a reason to buy - most Fair Workweek laws
  don't bind a single-location business this size, and claiming otherwise
  would be misleading (see `gtm/legal_compliance_audit.md`).
