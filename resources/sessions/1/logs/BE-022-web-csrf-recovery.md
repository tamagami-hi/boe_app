# BE-022 Web CSRF reload-recovery endpoint

Status: DONE — branch `ts-migration/backend` (PR #1). Backend finalization batch F1.

Implements `GET /v1/auth/web/csrf` (spec 04 §3.4 route inventory), the reload-
recovery endpoint deferred since BE-010. On a browser reload the admin SPA keeps
its HttpOnly access/refresh cookies but loses the in-memory synchronizer CSRF
token; this endpoint re-issues one without requiring a prior CSRF.

## Behavior

- Auth: **web access cookie OR refresh cookie; no prior CSRF** (matches the spec
  inventory row). Identifies the web session from the access cookie if it still
  verifies, else falls back to the refresh cookie (the common reload case where
  the 10-minute access token has expired but the refresh cookie is still valid,
  which otherwise deadlocks against `/refresh` needing a CSRF token).
- Enforces `validateWebOrigin` (Sec-Fetch-Site not cross-site + Origin/Referer
  allowlist) in the route. Safe to skip CSRF because a cross-origin caller both
  fails the Origin/Fetch-Metadata check and cannot read the JSON response.
- Re-issues an opaque CSRF token, stores its hash on the session, and returns
  `{ user, csrfToken, csrfTokenExpiresAt }` (10-minute CSRF TTL, matching login).
  The prior CSRF is overwritten and immediately invalidated (no grace: the client
  had already lost it). The refresh chain and access cookie are untouched.
- Response is `cache-control: no-store`.

## Changes

- `src/repositories/authSessionRepository.ts`: new `rotateWebCsrf` (CSRF-only
  re-issue; updates `csrf_token_hash`/`csrf_key_version`/`csrf_expires_at`/
  `csrf_rotated_at` for an active web session).
- `src/domain/auth/webAuth.ts`: `readAccessCookie` + `webRecoverCsrf` (access-
  then-refresh session resolution, active-user re-check, CSRF rotation, principal
  rebuild).
- `src/routes/webAuthRoutes.ts`: `GET /v1/auth/web/csrf` (Origin check + unit-of-
  work). Auto-wired in production via `registerWebAuthRoutes` in the PROD-001
  composition — no composition change needed.

## Validation

- `test/integration/authWeb.integration.test.ts` (+4, 7 total): recover from the
  access cookie and confirm the old CSRF is rejected while the new one authorizes
  logout; recover from the refresh cookie alone; reject a cross-site origin (403);
  require an authenticated session (401).
- `npm run check` green (294 unit tests, build, source/dist smokes).
  `npm run test:integration` green (79 tests across 8 files, was 75).
- Guards: `git diff --check` clean; Legacy tree hash intact; backend authored JS
  still 0; `package.json`/lock unchanged.

## Remaining (unchanged deferrals)

The partial-response mixed-pair refresh recovery edge (current refresh + previous
CSRF) remains a documented later refinement. Other backend-finalization items:
BE-023 (SES v2 sender + worker entrypoint), BE-024 (migrate-CLI 001-008
disposition), BE-008b-3 (resend refinement), BE-019A (hardening audit).
