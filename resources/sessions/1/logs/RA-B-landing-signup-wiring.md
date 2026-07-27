# RA-B Landing signup wiring (both surfaces)

Status: DONE — branch `ts-migration/backend`. Realignment spinoff (see
[plans/02-frontend-backend-realignment-spinoff.md](../plans/02-frontend-backend-realignment-spinoff.md)).

Wires the landing's two signup surfaces to the canonical backend under the new
onboarding model (application → email verify → admin approval → activation
invite; there is no self-service password signup). Both previously targeted the
retired legacy contract (`/v1/onboarding/applications`, `/v1/auth/signup`).

## Changes (frontend_stack/packages/landing_page)

- **New BFF** `src/app/api/onboarding/applications/route.ts` — server-side maps a
  landing submission to `POST /v1/applications` (spec 04 §3.1): resolves the
  current terms + privacy consent versions from `GET /v1/public/consent-documents`,
  attaches an `Idempotency-Key`, normalizes the phone to E.164 (bare 10-digit ->
  `+91`), and preserves the backend's generic `202 { accepted: true }` (no
  enumeration). Requires consent acceptance (400 otherwise).
- **`src/lib/onboarding.ts`** — replaced the legacy `submitLead` with
  `submitApplication({ fullName, email, phone, acceptedConsents })` posting to the
  same-origin BFF.
- **`next.config.mjs`** — removed the stale `/api/onboarding/:path*` -> legacy
  rewrite (now handled by the route); kept the `/v1/:path*` proxy.
- **`src/components/LeadForm.tsx` (B1)** — added a Terms/Privacy acceptance
  checkbox (with links) and submits via `submitApplication`.
- **`src/components/SignupForm.tsx` (B2)** — reworked from the incompatible
  username/password account form to the application model: name/email/mobile +
  consent, "Apply for access", success state explains verify-email → approval →
  activation. No longer depends on the (legacy) `useAuth().signup` /
  `validateSignup`; `lib/auth.ts` and `AuthProvider` are untouched (still used by
  login).

## Validation

- Landing `npm test` green (24 tests, incl. new `onboarding.test.ts` mocking the
  BFF). Landing `npm run build` (Next production) green; `/api/onboarding/
  applications` registered as a dynamic route.
- Backend unchanged this batch (`POST /v1/applications` already verified by the
  onboarding integration tests). Guards: whitespace clean; Legacy hash intact;
  backend authored JS still 0; landing `package-lock.json` unchanged.

## Notes / boundaries

- End-to-end (landing ↔ backend over http) is not run in the sandbox; verified by
  the landing build + BFF unit test + the backend's existing `POST /v1/applications`
  integration coverage. Real E2E happens in the user's `docker compose` stack.
- Landing **login** (`/api/auth/login` → legacy `/v1/auth/login`) is still on the
  legacy contract; wiring web/native login is part of the later realignment
  (RA-C/RA-D), not this signup batch.
- Next (RA-C): the `/v1/client/*` financial routes the client app calls.
