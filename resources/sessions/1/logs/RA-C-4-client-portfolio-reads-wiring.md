# RA-C.4 Client portfolio read slice (eligibility, holdings, orders)

Status: DONE — branch `ts-migration/backend`. Fourth batch of RA-C, and the
first canonical `/v1/client/*` backend routes. Native-authenticated read slice
built on the BE-021 investing/ownership schema (spec 03 §2.3, §4.3, §6, §7),
then the client services wired to it.

## Backend (canonical `/v1/client/*` reads)

- **New** `src/domain/client/investingEligibility.ts` — the single pure
  `deriveInvestingEligibility` decision (spec 03 §2.3): `closed|suspended ->
  suspended`; `!active -> blocked`; missing/unapproved KYC -> `pending_compliance`;
  missing/unassessed risk -> `pending_compliance`; expired approved KYC ->
  `pending_compliance`; else `eligible`. Eligibility is derived, never stored in
  config, a JWT claim, or a client row. +9 unit tests covering every branch and
  the `<=`-expiry boundary.
- **New** `src/repositories/clientPortfolioRepository.ts` — read repository:
  - `eligibilityInputs` — account state + latest KYC case + latest risk
    assessment via lateral joins.
  - `listHoldings` — authoritative holdings joined to the fund's current
    published version (name/category/risk) and the greatest-revision current NAV
    (lateral, `as_of_date DESC, revision DESC`). `marketValuePaise =
    round(total_units * nav * 100)` — a presentation estimate, not booked
    evidence. Paise/units/NAV are emitted as strings (`::text`), never a JS
    number.
  - `listOrders` — the owner's order history.
  - Every query is scoped by `user_id` and uses the `(created_at DESC, id DESC)`
    keyset with a validated limit ≤ 100.
- `src/domain/auth/nativeAuth.ts` — extracted a narrow `NativeRequestAuthDeps`
  (`accessTokenService` + `database`); `authenticateNativeRequest` now takes that
  subset (`NativeAuthDeps` remains a structural superset, so existing callers are
  unchanged). Non-active accounts still map to `ACCOUNT_NOT_ACTIVE`.
- **New** `src/routes/clientPortfolioRoutes.ts` — `GET /v1/client/eligibility`,
  `GET /v1/client/holdings`, `GET /v1/client/orders`. Every handler resolves and
  re-checks the native bearer principal before any read; list endpoints use the
  authenticated opaque keyset cursor (`http/cursor.ts`) with page meta.
- `src/runtime/composition.ts` — constructs the repository and registers the
  routes with the shared `accessTokenService`, `database`, `clock`, and
  `cursorKey`.

## Frontend (client services -> canonical reads)

- `packages/client/src/services/portfolioApi.js` — HTTP mode now derives the
  portfolio from `GET /v1/client/holdings` (holdings/lots are ownership truth;
  there is no separate portfolio cache in the canonical schema). Adds
  `getHoldings()`; paise -> rupees conversion at the boundary.
- **New** `packages/client/src/services/eligibilityApi.js` —
  `getInvestingEligibility()` over `GET /v1/client/eligibility`.
- `packages/client/src/services/ordersApi.js` — `listOrders` now reads
  `GET /v1/client/orders` (keyset) and applies the coarse UI filter
  (active/cancelled) client-side over the page.
- Fixture-mode fallbacks are preserved for all three.

## Validation

- Backend gates green: `npm run check` (typecheck + lint + unit coverage ≥80% +
  build + smoke source/dist) and `npm run test:integration` — **10 files, 94
  tests** (was 84/9). New `test/integration/clientPortfolio.integration.test.ts`
  (10 tests): eligibility `eligible`/`pending_compliance`, non-active principal
  -> `ACCOUNT_NOT_ACTIVE` (403), missing bearer -> `AUTHENTICATION_REQUIRED`
  (401), holdings valued at the greatest-revision NAV with money/units as
  strings, owner-scoping, orders keyset pagination (no cross-page overlap),
  cross-route cursor -> `CURSOR_INVALID` (400), unknown session ->
  `SESSION_INVALID` (401).
- Frontend: `cd frontend_stack && npm run build` (Vite; client + admin) green.
- Guards: `git diff --check` clean; Legacy hash intact; backend authored JS
  still 0.

## Notes / boundaries

- `authenticateNativeRequest` rejects non-active accounts, so the endpoint only
  ever returns `pending_compliance` or `eligible`; the `suspended`/`blocked`
  branches are reachable only through the later investing *command* (which
  re-derives under lock) and are covered by the pure-function unit tests.
- This is the read slice only. The write domain (orders create/pay/book, SIPs,
  mandates, redemptions — money math, locking, maker-checker) is the next
  slice-by-slice batch on the same BE-021 schema (spec 03 §5-§6).
- The client order/payment/mandate *write* services (`createSip`, `createLumpsum`,
  payments, mandates, sip-control) still target not-yet-built endpoints and keep
  their fixture fallback; they are wired as those backend commands land.
- APK/emulator packaging (Capacitor/Gradle) stays on the user's local stack.
