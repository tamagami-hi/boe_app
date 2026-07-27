# 06 · NAV Fan-out & Impact Map

Product intent: **the fund detail does not expose a NAV.** NAV (Net Asset Value
per unit) is currently the *pricing engine* for the entire investing flow, so this
is not a cosmetic change. This doc enumerates **every** doc and code path that
references NAV or its calculation, explains the computation, and lays out the
options with their blast radius — so we scope the removal correctly before
editing any money-correctness code.

## How NAV is used today (the computation)

NAV is a per-fund, per-date decimal (`numeric(24,8)`, scale 8) that prices the
conversion between rupees and fund **units**:

- **Allotment (buy):** `units = amount_paise / 100 / nav`, rounded once
  half-to-even to 8 decimals (`src/finance/money.ts › computeAllotmentUnits`).
  Example: ₹2,000 at NAV 20.00 → 100 units.
- **Valuation (portfolio):** `market_value_paise = round(total_units · nav · 100)`
  at the current NAV (`clientPortfolioRepository`).
- **Current NAV** = the `fund_nav_prices` row with the greatest `as_of_date`, then
  greatest `revision` (corrections supersede).
- Publishing a fund version **requires** an initial NAV (`fund_versions.initial_nav_price_id`).
- NAV correction is a maker-checker action (`approval_actions.action_type = 'fund_nav.correct'`).

So "units" and "market value" only have meaning because a NAV exists. Removing
NAV forces a decision about whether **units** survive at all.

## Backend code (all editable, `ts-migration/backend`)

| File | NAV role |
|---|---|
| `db/migrations/015_canonical_catalog.sql` | `fund_nav_prices` table; `fund_versions.initial_nav_price_id` FK (every published version needs a NAV). |
| `db/migrations/017_canonical_investing.sql` | `investment_executions.nav` (+ CHECK: allotment/redemption require NAV+units; refund forbids them). |
| `db/migrations/012_canonical_rbac_platform.sql` | `approval_actions` action type `fund_nav.correct`. |
| `src/finance/money.ts` (+ `money.test.ts`) | `computeAllotmentUnits` / `computeAllotmentUnitsScaled8` — the units = amount/nav math. **14 unit tests are entirely NAV→units.** |
| `src/repositories/holdingRepository.ts` | `findCurrentNav`, `CurrentNavRow`, `insertAllotmentExecution({nav, units})`. |
| `src/domain/client/bookOrder.ts` | requires a current NAV; computes units; writes `nav`+`units` on the execution, lot, holding, movement. |
| `src/repositories/clientPortfolioRepository.ts` | holdings valuation: lateral latest NAV → `currentNav`, `navAsOfDate`, `marketValuePaise`. |
| `src/routes/clientPortfolioRoutes.ts` | holdings response exposes `currentNav`, `marketValuePaise`, `navAsOf`. |
| `src/db/types.ts`, `src/db/repositories.ts` | `FundNavPricesTable`, `FundNavPrice` type; execution `nav`, fund_version `initial_nav_price_id`. |

## Backend tests seeding/using NAV

`clientBooking`, `clientOrders`, `clientPortfolio`, `clientSip`, `clientKyc`,
`paymentWebhook`, `paymentWorker`, `laterDomainSchema` integration tests all seed
`fund_nav_prices` and/or assert units/market value; `src/finance/money.test.ts` is
NAV-math only. **Any model change rewrites these assertions.**

## Frontend code (editable)

- **Client:** `pages/Explore.jsx` (fund card shows `NAV · asOf` + value),
  `pages/Portfolio.jsx` (units columns), `services/portfolioApi.js`
  (`currentNav`/`units`/`marketValue`/`avgCost` mapping), `data/fixturePortfolio.js`
  (units/avgCost fixtures), `pages/Statements.jsx` ("published NAV" copy),
  `services/fundsApi.js` (fixture `units = amount / 142.35`),
  `services/disclosureApi.js` (NAV disclosure copy).
- **Admin:** `screens/AumScreen.jsx` + `screens/AumDisplayFields.jsx` (fund NAV
  value + as-of input/preview fields).

## Docs

- **Editable (Session 1/2):** `1/specifications/03-schema-lifecycle-specification.md`
  (§4.3 arithmetic — the canonical NAV math, ~28 refs), `1/specifications/02`,
  `1/specifications/04`, `1/plans/01`, `1/logs/RA-C-6-order-booking-money-math.md`,
  `1/logs/RA-C-4`, `1/logs/BE-021-*`, `1/TASKS.md`, `1/status/METRICS.md`,
  `1/handoffs/*`, and `2/01`, `2/03`, `2/05`, `2/README`.
- **Historical, DO NOT EDIT:** everything under `resources/sessions/Legacy/**`
  (e.g. `Legacy/4/02-admin-aum-controls-plan.md`, `Legacy/handsoff/3/…`) — listed
  for completeness only.

## The decision fork (pick one before any code change)

### Option A — Hide NAV in the client fund detail only (cosmetic)
Keep the NAV/units engine exactly as is (correct pricing + valuation); just don't
render a NAV number on the client fund card/detail.
- **Blast radius:** tiny — remove NAV display in `Explore.jsx` (and optionally the
  `currentNav` field from the holdings response). Schema, math, booking, tests
  unchanged.
- **Trade-off:** units still exist under the hood; "market value" still moves with
  an (unshown) NAV. If the product truly has no per-unit price, this is a facade.

### Option B — Remove the NAV/units model entirely (amount/share pool)
Fund pools become amount-based AUM: a client contributes an amount and holds a
**cost basis / proportional share**, not NAV-priced units. Returns come from
admin-declared pool performance/AUM growth, not a fluctuating NAV.
- **Blast radius:** large — drop `fund_nav_prices` + `initial_nav_price_id`
  requirement; remove `computeAllotmentUnits`; rewrite `bookOrder` to record a
  contribution (amount/share) with no NAV/units; change `investment_executions`
  (nav/units nullable or removed), `holdings`/`holding_lots` (units → amount/share),
  redemption math, `clientPortfolioRepository` valuation, and all the integration
  tests + money unit tests. Deviates from spec 03 §4.3 (record as a decision).
- **Trade-off:** matches "no NAV" cleanly, but is a significant money-domain
  rewrite and changes how returns/redemption value are computed (needs a defined
  returns model).

### Option C — Fixed/implicit NAV (units == rupees)
Keep the engine but fix NAV at 1.00 (1 unit = ₹1), so "units" are just rupees and
NAV is never a product concept. Admin never sets a NAV; returns are shown via a
separate declared-return/AUM figure.
- **Blast radius:** medium — publishing no longer needs an admin NAV (default the
  initial NAV to 1.00), stop displaying NAV/units, keep the math intact (it still
  balances at NAV=1). Fewest correctness risks; simplest path to "no NAV" without
  rewriting booking/holdings.
- **Trade-off:** units still exist internally (equal to rupees); a real
  variable-return model would be layered separately.

## Recommendation & open question

For a low-risk path that still delivers "no NAV on the fund detail" **and** keeps
the invest→book→holdings→redeem flow correct, **Option C** (or **A** if you only
want to hide the number) is safest. **Option B** is the "true" no-units pool but is
a money-domain rewrite and needs a defined **returns model** (how does a client's
value grow and how is redemption value computed without a NAV?).

**Question to confirm before I change code:**
1. Do fund pools still track **units** at all, or is ownership purely
   amount/share based (Option B)? 
2. If no NAV, **how is a client's current value and redemption value computed** —
   flat cost basis, an admin-declared return/yield, or AUM-proportional share?

Once you pick the model, this becomes a concrete slice (schema migration + money
logic + booking/holdings + reads + tests + the doc updates listed above), built
with the usual gates/guards.

Related: [[03-client-app-controls]] · [[05-backend-gaps-and-build-plan]] ·
[[../1/specifications/03-schema-lifecycle-specification|Spec 03 §4.3 arithmetic]] ·
[[../1/decisions/RISKS_AND_DECISIONS|Session 1 decisions]].
