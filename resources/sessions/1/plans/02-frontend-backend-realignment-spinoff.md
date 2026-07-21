# Spinoff: Frontend/Backend Realignment And Runnability

Status: ACTIVE spinoff (created after a drift check). This is a **reprioritization
track**, not a replacement for the master plan or specs. It exists to satisfy the
user's stated primary goal, which is narrower than the full Session-1
rearchitecture.

## Primary goal (user, authoritative)

1. Migrate the backend to TypeScript. **(Done — 0 authored JS, gated at BE-020.)**
2. Keep the existing frontend **as-is for now**.
3. Make sure the **frontend and backend work together and the application runs**.

Where this goal conflicts with the inherited Session-1 program documents, the
user's stated goal takes precedence.

## Drift finding (why this spinoff exists)

The Session-1 program did not port the backend like-for-like; it **rearchitected
the API and schema** and deleted the routes the existing frontend depends on. As
a result the "app runs together" goal is not met today:

- The frontend (`frontend_stack`) is **dual-mode** (`packages/client/src/services/_util.js`,
  `packages/shared/src/appConfig.js`): it defaults to **`fixture`** mode (local
  mock data, no network) and only calls the backend when
  `VITE_BEO_API_MODE=http` against `VITE_BEO_API_BASE_URL` (default
  `http://127.0.0.1:47502`).
- Its HTTP client (`packages/client/src/services/{authApi,ordersApi}.js`) targets
  a **legacy contract** the new backend does not implement:
  - `POST /v1/auth/login|signup|logout|refresh`, `GET /v1/auth/session`,
    `GET /v1/system/reachability` — new backend has `/v1/auth/native/*` and
    `/v1/auth/web/*` (cookie+CSRF) and onboarding via `POST /v1/applications`.
  - `/v1/client/{sips,lumpsum-orders,orders,payments,mandates,sip-control-requests}`
    — **no such routes exist** (the client financial domain was deleted in BE-015;
    only DB schema exists via BE-021, no routes).
- Auth model differs: frontend expects tokens in the JSON body + `localStorage` +
  `Bearer`; new web auth uses HttpOnly cookies + synchronizer CSRF.

Net: in **fixture mode** the frontend never touches the backend; in **http mode**
every client-app call 404s. Only **landing signup -> `POST /v1/applications`** and
the **admin** identity/auth surface genuinely overlap the new backend.

## Realignment sequence (execute in order)

### RA-A — Prove each side runs (no frontend changes)
- Backend builds, boots, and serves (`/health/*`, first-slice routes). Already
  green via `npm run check` source/dist smokes.
- Frontend **builds and runs in fixture mode**: `cd frontend_stack && npm install
  && npm run build` passes; app renders from fixtures with no backend.
- Document the integration reality (this file). Acceptance: both build/boot green.

### RA-B — Wire the genuinely overlapping real flows (minimal frontend touch)
- Landing **signup -> `POST /v1/applications`** (+ verify-email), through the
  existing signup BFF (`SIGNUP_PROXY_SECRET`, `SIGNUP_ALLOWED_ORIGIN`).
- **Admin** app auth + identity queue against `/v1/auth/web/*` + `/v1/admin/*`
  (cookie + CSRF; use `GET /v1/auth/web/csrf` for reload recovery, BE-022).
- Keep the client investing app on fixtures. Acceptance: these flows work in http
  mode against the running backend (integration/manual proof).

### RA-C — Build the missing client financial routes on the new backend
- Repositories + command services + routes for the `/v1/client/*` surface the
  frontend calls, over the BE-021 schema, per spec 03 §6/§7 and spec 04 later
  slices. Large; each endpoint a verified batch. Acceptance: client http mode
  works end-to-end for the covered flows.

### RA-D — Legacy-compat shim for any remainder
- For endpoints the frontend expects that are not otherwise covered, add
  legacy-shaped routes mapped onto canonical services (bridge/throwaway).
  Acceptance: no unhandled frontend calls in http mode.

## Build/run boundary (IMPORTANT)

- The agent runs **normal web builds and tests only** and ensures the build
  passes: backend `npm run check` + `npm run test:integration`; frontend
  `cd frontend_stack && npm run build` (Vite).
- The agent **must NOT** run the APK / Android / Capacitor / Gradle packaging
  (`build:android`, `cap sync|open|run`, gradle, emulator). **The user performs
  the Capacitor + Gradle APK build and emulator testing locally** (too
  resource-heavy in the sandbox). Stop at "web build passes" and hand off.

## Relationship to the main program

The full financial/catalog rearchitecture (GATE-07/08) and the paused backend
finalization items (BE-023 SES sender, BE-008b-3, BE-019A) remain valid but are
**deprioritized** behind runnability. RA-C overlaps GATE-07/08 scope; build only
what the frontend actually calls, in verified batches.
