# Validation and Risk Plan

## Validation Commands

After implementation, run the backend checks:

```bash
cd backend_controller
npm run db:check
npm run migrate:status
npm run routes
```

Run frontend build:

```bash
cd frontend_stack
npm run build
```

If the frontend build points to the app package instead, use:

```bash
cd frontend_stack/app
npm run build
```

## Targeted Functional Checks

1. Admin loads AUM page.
2. Admin creates a draft fund with only basic fields; save succeeds.
3. Admin edits the fund and adds:
   - benchmark periods
   - benchmark series
   - asset split
   - sector allocation
   - top holdings
   - advanced ratios
4. Admin publishes/activates the fund.
5. Client Explore list receives the fund through `GET /v1/products`.
6. Explore card renders without overflow on mobile and desktop.
7. Client opens `/app/funds/:fundId`.
8. Fund detail renders fund-vs-Nifty chart, metric grid, holdings, and bottom analysis.
9. Visibility toggles remove matching client payload and UI sections.
10. Raw investment amounts do not appear in any client response or rendered page.

## Visual Checks

Use Playwright or manual browser checks at:

- Mobile: 360x800, 390x844, 412x915
- Desktop: 1280x800, 1440x900

Check:

- Explore fund cards do not overflow.
- Performance chart is not blank when series exists.
- Period chip row fits mobile width.
- Donut chart legends wrap cleanly.
- Advanced ratio grid remains readable at the bottom.
- Sticky action bar does not overlap bottom content.

## Data Risks

- Admin-entered performance can be inaccurate. Label it as admin-published and show as-of dates.
- Nifty comparison must not imply guaranteed outperformance.
- Asset allocation totals may not sum to 100. Decide whether to block active stage or show warning.
- Sector allocation currently comes from `sectors`, which may represent total fund allocation, not equity-only allocation. The implementation should clarify this in admin labels.
- Existing JSON data may lack new fields; all client UI must tolerate missing data.

## Security and Privacy Risks

- Do not expose raw `investments.amount` to clients.
- Do not accept external image URLs for fund icons without considering CSP and privacy. Safer first pass: monogram/icon color only.
- Keep all client calls through BOE backend APIs.

## Product Risks

- The reference screenshots are from a mutual fund app; BOE fund pools may differ from regulated mutual fund schemes. Copy should use "fund pool" or existing BOE product terminology unless the business confirms mutual fund terminology.
- Return calculator must avoid guaranteed-return wording.
- Advanced ratios may not apply to all fund pool types. Hide missing values rather than showing zero.

## Rollback Shape

Because this plan uses optional fields and existing routes:

- Backend rollback can stop sending new fields while preserving old fields.
- Admin rollback can hide the new editor sections without deleting stored optional data.
- Client rollback can return to current Explore/FundDetail rendering while ignoring optional payload fields.

## Documentation Updates Required

After implementation, update the session 4 docs with the final source behavior:

- `00-fund-pool-redesign-overview.md`
- `01-backend-data-contract-plan.md`
- `02-admin-aum-controls-plan.md`
- `03-client-explore-and-detail-ui-plan.md`
- `04-validation-and-risk-plan.md` if any validation or financial-display risk remains.

## Implementation Status

✅ **Complete.**

Validation commands run and passing:
- `cd backend_controller && npm run routes` ✅
- `cd backend_controller && npm run db:check` ✅
- `cd frontend_stack/app && npm run build` ✅ (built in ~1.8s)
- `cd frontend_stack && npx vitest run` — `chartMath.test.js` 13/13 checks pass ✅

Lifecycle validation added:
- Warns before `active` stage if `showBenchmarkComparison` is enabled but < 2 series points.
- Warns before `active` stage if `showAssetAllocation` is enabled but no asset rows.
- Warns before `active` stage if `showSectorDistribution` is enabled but no sectors.
- Warns before `active` stage if `showAdvancedRatios` is enabled but all fields blank.

Remaining risks (no code changes required):
- Admin-entered performance can be inaccurate — mitigated by "admin-published" labels and as-of dates.
- Nifty comparison does not imply guaranteed outperformance — mitigated by disclaimers.
- Asset allocation totals may not sum to 100 — total indicator shows exact sum in admin editor.
