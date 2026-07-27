# 01 · Admin Audit — Overview & Master Status Matrix

## Method

Every admin sidebar entry (`navigation/nav.js`) was traced to its screen
(`pages/Admin.jsx` → `pages/legacy/legacyRoutes.jsx`) and to the exact backend
endpoint it calls (grepped across `packages/admin/src` + the shared client
services + `shared/appConfig.js`). Each endpoint was then checked against the
**only** admin routes that exist in the canonical backend
(`routes/adminIdentityRoutes.ts`) and against the canonical schema
(`db/migrations/009-019`).

## What the canonical backend actually exposes for admins today

Only these admin-facing endpoints exist (all others the UI calls are unbuilt):

- `POST /v1/auth/web/login`, `POST /v1/auth/web/logout`, `GET /v1/auth/web/csrf` — admin session (cookie + CSRF).
- `GET /v1/admin/applications`, `GET /v1/admin/applications/:id`,
  `POST /v1/admin/applications/:id/review`, `POST /v1/admin/applications/:id/decision` — onboarding approvals.
- `POST /v1/admin/users/:id/activation-invites/resend` — resend activation.
- `GET /v1/admin/email-deliveries` — email delivery log (**no admin screen consumes it yet**).

That is the entire built admin surface. Everything below that is 🔴/🟠/🟡 is the gap.

## Master status matrix

Legend: ✅ working · 🔴 broken (endpoint missing) · 🟠 obsolete (remove/repurpose) · 🟡 postponed · ⚪ schema-only.

| Nav group | Screen (path) | Backend endpoint called | Canonical schema | Status | Controls |
|---|---|---|---|---|---|
| Overview | Overview `/admin/overview` | canonical applications count | applications (009) | ✅ (partial — only approvals count; other tiles are placeholder) | Admin dashboard |
| Users | Approvals `/users/approvals` | `/v1/admin/applications` (+review/decision) | applications (009) | ✅ **WORKING** | Onboarding |
| Users | Subscriptions `/users/subscriptions` (renders **Mandates**) | `/v1/admin/mandates` | mandates (017) | 🔴 BROKEN | Client app |
| Users | Payments `/users/payments` | `/v1/admin/payments` | payments (018) | 🔴 BROKEN | Client app |
| Users | Directory `/users/directory` (+ `/:id`) | `/v1/admin/users` (+`/:id`) | users (010) | 🔴 BROKEN | Admin-internal |
| Users | KYC review `/users/kyc` | `/v1/admin/kyc-review` | kyc_cases (014) | 🔴 BROKEN + partly 🟠 (email-OTP KYC auto-approves, RA-C.10) | Admin-internal |
| Users | Risk profiles `/users/risk-profiles` | `/v1/admin/risk-profiles` | risk_assessments (014) | 🟠 **OBSOLETE** (decision 9: no client risk profiling) | — remove/repurpose |
| Site Control | Page content `/site/content` | `/v1/admin/landing-config` (GET+PATCH) | **none** (needs modeling) | 🔴 BROKEN + needs schema | **Landing page** |
| Site Control | Courses `/site/courses` | `/v1/admin/courses` | courses (016) | 🔴 BROKEN | **Landing page** |
| Site Control | Plans `/site/plans` | `/v1/admin/plans` | membership_plans (016) | 🔴 BROKEN | **Landing page** |
| Site Control | FAQs `/site/faqs` | `/v1/admin/faqs` | content_items kind=faq (016) | 🔴 BROKEN | **Landing page** |
| App Mgmt | App builder `/app/builder` | `/v1/admin/app-config` | app_config_versions (016) | 🔴 BROKEN (legacy embeds products/funds → forbidden by canonical config; needs reshape) | **Client app** |
| Operations | AUM pools `/ops/funds` | `/v1/admin/funds` (+`/:id`), `/capital-transactions`, `/redemption-requests` | funds/fund_versions/nav/positions/aum (015), redemption_requests (017) | 🔴 BROKEN; `capital-transactions` 🟠 OBSOLETE (spec §8: no fake ledger) | **Client app** (fund pools) |
| Operations | Holdings `/ops/holdings` | (funds collection) | holdings (017) | 🔴 BROKEN | **Client app** |
| Operations | Transactions `/ops/transactions` | `/v1/admin/transactions` | investment_orders/executions (017) | 🔴 BROKEN | **Client app** |
| Operations | Ledger `/ops/ledger` | `/v1/admin/reconciliation-ledger` | **removed** (spec §8: `ledger_entries` deleted) | 🟠 **OBSOLETE** → replace with executions/payments reconciliation | **Client app** |
| Operations | SIP control `/ops/sip-control` | `/v1/admin/sip-control-requests` | sip_plans (017) | 🔴 BROKEN + partly 🟠 (spec §8: express as SIP commands / `approval_actions`) | **Client app** |
| System | Support `/system/support` | `/v1/admin/support/tickets` | **none** (postponed) | 🟡 **POSTPONED** (spec: support out of MVP) | Admin-internal |
| System | Audit log `/system/audit-log` | `/v1/admin/audit-logs` | audit_events (012) | 🔴 BROKEN | Admin-internal |
| System | Environment `/system/environment` | `/v1/admin/app-config` | app_config_versions (016) | 🔴 BROKEN | Client app / ops |

## Headline numbers

- **Built admin domains:** 1 (onboarding approvals) + admin auth. Everything else in the sidebar is not backed.
- **Broken (endpoint missing, schema exists → buildable):** ~12 screens.
- **Obsolete (contradicts canonical decisions):** risk profiles, capital-transactions, reconciliation-ledger, (partly) sip-control-requests.
- **Postponed:** support tickets.
- **Needs new modeling:** landing marketing content (no canonical table).
- **Built but unused:** `GET /v1/admin/email-deliveries` (no screen).
- **Missing entirely from the UI:** RBAC / admin-staff management (roles/permissions exist in schema + seed, but there is no screen and no runtime management route).

See [[02-landing-page-controls]], [[03-client-app-controls]],
[[04-admin-internal-controls]], and the plan in [[05-backend-gaps-and-build-plan]].
