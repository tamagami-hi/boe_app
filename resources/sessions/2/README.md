# Session 2 — Admin Control Audit & Build

This session maps **everything the admin console is meant to control** — the
**landing/marketing site** and the **client app** — against what the canonical
TypeScript backend actually implements, so we can build the admin side against
reality instead of the legacy fixtures.

It is a companion to the Session 1 backend rearchitecture (branch
`ts-migration/backend`).

## Read in this order

1. [[01-admin-audit-overview|01 · Audit overview + master status matrix]] — method, legend, and the one-screen truth table.
2. [[02-landing-page-controls|02 · Landing-page controls]] — what admin publishes to the marketing site.
3. [[03-client-app-controls|03 · Client-app controls]] — fund pools, app config, investing operations.
4. [[04-admin-internal-controls|04 · Admin-internal controls]] — approvals, users, KYC, audit, RBAC, environment.
5. [[05-backend-gaps-and-build-plan|05 · Backend gaps + proposed build order]] — what to build, remove, or defer.

## Status legend (used throughout)

| Badge | Meaning |
|---|---|
| ✅ **WORKING** | Admin UI is wired to a canonical backend endpoint that exists and is tested. |
| 🔴 **BROKEN** | Admin UI exists and calls a `/v1/admin/*` endpoint that is **not built** (404 in HTTP mode; only fixtures work). |
| 🟠 **OBSOLETE** | Contradicts a canonical decision — the screen/endpoint should be removed or repurposed, not built as-is. |
| 🟡 **POSTPONED** | Explicitly out of MVP per the canonical spec. |
| ⚪ **SCHEMA-ONLY** | Canonical DB schema exists, but there is neither a route nor (sometimes) a usable UI. |

## Source of truth

- Admin frontend: `frontend_stack/packages/admin/src` (nav `navigation/nav.js`,
  routes `pages/Admin.jsx` + `pages/legacy/legacyRoutes.jsx`, data
  `context/LegacyAdminDataContext.jsx` + `helpers/loadAdminData.js` +
  `hooks/useAdminCollection.js` + `hooks/useLandingConfig.js`).
- Canonical backend admin surface: `backend_controller/src/routes/adminIdentityRoutes.ts` (the only built admin routes).
- Canonical schema: `backend_controller/db/migrations/009-019`.
- Product decisions: [[../1/decisions/RISKS_AND_DECISIONS|Session 1 · Risks & decisions]] (esp. #8-10: email-OTP KYC, no client risk profiling, email transport).
