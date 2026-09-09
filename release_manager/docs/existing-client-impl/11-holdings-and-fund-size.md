# Holdings and fund-size completion — 2026-09-09

The holdings form now defaults the reporting quarter, validates on submission with visible field errors, saves by click or Enter, reports success, and refreshes the list and preview. Archived funds cannot edit or exit stocks.

The client fund detail displays a pie chart per quarter with every active stock name below it. Undisclosed weights remain visible without invented allocations. Client catalogue and detail queries refresh when reopened or refocused.

Manage AUM now supports an absolute new fund size, a signed increase/decrease, or a percentage adjustment. Confirmation shows the amount and date. The server derives the target delta under the fund lock, rejects negative/oversized results, and records an audited snapshot with idempotency. Uncertain browser retries preserve the exact command and key. AUM writes invalidate the client fund cache, and frontend queries refresh the current figure, history, and catalogue.

Opening AUM is saved atomically during fund creation and returned as client fund size. Stock disclosures store weight percentages; they do not add money to fund AUM or change individual client balances.

## Verification

- Backend typecheck, lint, build and 882 unit tests passed.
- Contracts typecheck, lint and 95 tests passed.
- Frontend typecheck, lint, 212 tests and client/admin production builds passed.
- 60 disposable PostgreSQL integration checks passed: 25 AUM, 5 client catalogue, 30 temporary admin catalogue/cross-route checks. The temporary fixture used the required admin_native session channel and was removed after verification. Focused integration execution disabled the global full-suite coverage threshold; the initial coverage-enabled execution passed all 60 assertions but could not meet repository-wide coverage from three suites.
- Temporary Playwright checks exercised invalid form feedback, click/Enter stock saves, reload persistence, client pie and all names, opening AUM display, confirmed AUM increase/decrease/zero, history refresh, and response-loss retry with the same key. Browser checks used mocked API responses; PostgreSQL checks exercised real routes and persistence.

No deployment or live fund-data changes were performed.
