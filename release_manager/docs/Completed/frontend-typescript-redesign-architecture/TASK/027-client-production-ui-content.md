# Task 027 — client production UI / content pass

## What was asked

Two things, in order. First extract the whole client-facing frontend exactly as it stands, with
screenshots and text, changing nothing. Then implement the production UI/content changes against
what that extraction found.

## Extraction

`release_manager/audit_pages/client/` — 25 routes, 118 screenshots at 1440×900 and 390×844,
92 machine-readable capture records, 169 findings, plus `ROUTE_INVENTORY.md`,
`SHARED_COMPONENTS.md` and `AUDIT_INDEX.md`.

Two capture surfaces were needed because neither alone reaches every route. A browser against
the deployed dev client covers the exact viewports with true full-page screenshots but signs in
as the seed QA account, which has no verified email and so cannot pass the eligibility guard. The
installed APK, driven over the WebView CDP socket with `Emulation.setDeviceMetricsOverride`, is
signed in as an account with real holdings and reaches the three `access: "eligible"` routes.

Nothing was mutated to manufacture a state. No order was placed, no SIP touched, no PIN set, no
notification marked read, no email verified.

## Implementation

### Shared foundation first

Ten findings had a single source. `AuthLayout`'s markers and footnote appeared on three screens;
`ErrorState` was the entire error vocabulary of the application; `LoadMore`, `ConfirmDialog` and
`AsyncBoundary` were one string each away from correct everywhere they were used. Fixing those
first closed findings on pages that were never opened.

### Presentation layer

Seven modules under `src/domain/`. See D-072 for the rules they establish. The short version:
internal values are mapped at the edge, an unmapped value renders nothing rather than a token,
`error.message` is never client copy, and client labels are separate functions from admin labels.

### Two real defects

`/blocked` branched on `closed` versus everything else, so an active account reaching the URL was
told its account was suspended. It now branches on the actual state and redirects active and
invited accounts to Home. Verified by behaviour.

The SIP screen's collection-day hint claimed "Any day from 1 to 28" above a control offering six
days. Removed.

## Result

169 findings: 132 FIXED, 19 ACCEPTED with a reason, 14 REQUIRES PRODUCT DECISION, 4 REQUIRES
LEGAL CONTENT. Measured from rendered text, before → after: raw UUIDs 1 page → 0, snake_case
1 page → 0, architecture vocabulary 10 terms → 0, screens rendering `error.message` 4 → 0.

No legal copy was fabricated. The unpublished-document states were made honest instead of
self-contradicting.

## Files

39 modified and 7 added, all under `frontend_stack_ts/src/`. No backend, contract, migration,
payment, SIP or auth change.

## Verification

`npm run typecheck`, `npx eslint src` (0 findings), `npx vitest run` (199 tests),
`npm run build`, `check-bundle-boots`, `check-android-dist`, and
`./emu/boe_update.sh --local --client --install` all pass. Browser and APK passes captured into
`release_manager/audit_pages/client/implemented/`.

Not verified: no payment initiated, no SIP mutated, no device PIN set, no update surface opened,
suspended and closed `/blocked` branches source-only. AutoPay remains blocked on PhonePe
merchant provisioning.

## Where to look

| | |
|---|---|
| Before | `release_manager/audit_pages/client/<page>/page.md` + screenshots |
| Disposition of every finding | `release_manager/audit_pages/client/IMPLEMENTATION_TRACKER.md` |
| After | `release_manager/audit_pages/client/implemented/<page>/` |
| Summary | `release_manager/audit_pages/client/IMPLEMENTATION_SUMMARY.md` |
| Harness | `release_manager/audit_pages/client/_tools/` |
