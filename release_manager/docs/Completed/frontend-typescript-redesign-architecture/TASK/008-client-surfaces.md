# TASK 008 — Client read surface: contracted, built, verified

Date: 2026-08-28
Log entry: [016](../LOGS/implementation_log.md)

## Done

Twelve client operations contracted from the route handlers. Six placeholder screens replaced with
real ones: Dashboard, FundList, FundDetail, Portfolio, Activity, EmailVerification. Eligibility gate
made live. `onTransactionalBack` wired.

Drift baseline **54 → 42** uncontracted paths.

## Proven in a browser

29 of 29 checks, including the **email OTP round trip end to end** — code requested, read out of the
Mailpit sink, submitted, and the investing gate observed clearing. That is Phase 4 demonstrated
rather than asserted.

## One defect worth recording

`derivePortfolio` returns `returnPercent: null` with nothing invested; the contract said
`z.number()`. The response validator rejected the payload and the dashboard showed its error state
instead of a wrong figure. Fixed as nullable, rendered as an em dash. This is the validation layer
earning its place on the very first run against real data.

## Environment

A single env contract, matching the VPS key set. `backend_controller/.env.local-e2e` carries local
values for the same keys the deployed stack uses, so a production deploy is a values change rather
than a shape change. It is gitignored.

## Not done

No money has moved — orders, payments, SIP and AutoPay are placeholders and PhonePe is unconfigured
locally. No fund was published during verification, so the catalogue screens were exercised empty.
Statements, notifications, support, profile, legal and device security are placeholders. The admin
console is navigation and permission gating only. No emulator run, no APK, no container build.

## Next

1. Admin fund creation and publishing, using the already-contracted `admin-fund-aum` operations.
   That also unblocks meaningful client catalogue verification.
2. Orders and hosted-redirect payments, which needs PhonePe sandbox credentials in the env.
3. Remaining client surfaces, then the admin console, then Android packaging.
