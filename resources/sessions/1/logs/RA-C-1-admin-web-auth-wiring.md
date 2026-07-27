# RA-C.1 Admin web-auth wiring

Status: DONE — branch `ts-migration/backend`. First batch of RA-C (see
[plans/02-frontend-backend-realignment-spinoff.md](../plans/02-frontend-backend-realignment-spinoff.md)).

Wires the admin app's authentication to the canonical **web** auth surface the
backend implements (cookie + synchronizer CSRF), replacing the legacy
`/v1/auth/login|logout|session` + `/v1/system/reachability` calls the shared
auth layer made. Admin is the genuinely-supported surface (spec 04 §3.4 + the
BE-016 admin identity queue); client (native) auth and the admin data queue are
subsequent RA-C batches.

## Changes (frontend_stack/packages/client — shared client/admin layer)

- `src/services/_util.js`:
  - Per-scope CSRF token storage (`setSessionCsrf`/`storedCsrf`; cleared with the
    session). `apiRequest` sends `x-csrf-token` on unsafe methods when a CSRF
    token is stored (web scopes); native (client) scope is unaffected.
- `src/services/authApi.js` (http mode is now scope-aware):
  - `login` (admin) -> `POST /v1/auth/web/login` `{ email, password }`; stores the
    returned CSRF token + principal (HttpOnly cookies carry the session). A new
    `toAdminUser` maps the canonical principal (`userId/fullName/roles/
    permissions`) to the app's user shape and injects `admin` so the admin app's
    role gate passes while preserving canonical roles/permissions.
  - `currentUser` (admin) -> `GET /v1/auth/web/csrf` (the BE-022 reload-recovery
    endpoint) to restore the session from cookies and refresh the CSRF token.
  - `logout` (admin) -> `POST /v1/auth/web/logout`.
  - `checkReachability` -> `GET /v1/health` (mapped to `{ ok, minVersion }`),
    replacing the nonexistent `/v1/system/reachability`.
  - Client-scope http auth still targets the legacy path and is wired in the
    client batch (fixture mode is the default, so this is not a regression).

## Validation

- `cd frontend_stack && npm run build` (Vite, client + admin bundles) green.
- Backend unchanged; the web-auth endpoints are already covered by
  `authWeb.integration.test.ts` (+ the deploy-boot test's seeded-admin login).
- Guards: whitespace clean; Legacy hash intact; backend authored JS still 0.

## Notes / boundaries

- **Same-site requirement:** cookie auth requires the admin app and backend to be
  same-site (the deploy serves both behind one nginx host); `__Host-` cookies are
  `SameSite=Lax` and are not sent on cross-site XHR. `CORS_ORIGIN`/
  `WEB_ORIGIN_ALLOWLIST` must include the admin origin.
- End-to-end (admin ↔ backend cookie/CSRF) is validated in the user's `docker
  compose` stack, not the sandbox; here it is build-verified + backed by the
  backend web-auth integration tests.
- Next RA-C batches: client (native) auth wiring, the admin applications queue
  (`GET /v1/admin/applications` + review/decision/invite/deliveries), then the
  `/v1/client/*` financial routes on the backend.
