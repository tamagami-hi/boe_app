# 04 · Admin-Internal Controls (Users, Compliance, System)

Admin-facing operations that are not "landing" or "client-app" configuration but
run the back office.

## Working today ✅

### Onboarding approvals — `/admin/users/approvals` → `ApprovalsScreen`
- **Canonical:** `GET /v1/admin/applications` (queue), `GET .../:id` (detail),
  `POST .../review` (`submitted → in_review`), `POST .../decision?outcome=`
  (approve → creates user + activation invite + email; reject → rejection email).
  Web-cookie + CSRF + Idempotency-Key + If-Match.
- **Wiring:** `context/LegacyAdminDataContext.jsx` `handleUserDecision` →
  `adminApplicationsApi.resolveApplication` (review → decision handshake).
- **Status:** ✅ **WORKING** end-to-end (BE-016 / RA-C.3).

### Overview — `/admin/overview`
- Pending-approvals count derives from the canonical applications queue. Other
  tiles are placeholders (no stats endpoint in the first slice).
- **Status:** ✅ partial.

### Resend activation — `POST /v1/admin/users/:id/activation-invites/resend`
- Built (BE-016); invoked from the approvals/user flows.

## Broken (buildable) 🔴

### User directory / detail — `/admin/users/directory` (+ `/:id`)
- **Calls:** `GET /v1/admin/users`, `GET /v1/admin/users/:id`.
- **Canonical schema:** `users` (010) + credentials/sessions/roles.
- **Status:** 🔴 BROKEN. Buildable: admin user search/detail (state, activation,
  sessions, roles) + user lifecycle commands (`suspendUser`/`reinstateUser`/
  `closeUser`, spec 03 §5.2) which are **not built yet**.

### Audit log — `/admin/system/audit-log` → `AuditLogScreen`
- **Calls:** `GET /v1/admin/audit-logs`.
- **Canonical schema:** append-only `audit_events` (012) — already written by
  every command in the app.
- **Status:** 🔴 BROKEN. Buildable: a read-only, keyset-paginated, redacted audit
  viewer. Low risk, high value (evidence already exists).

## Obsolete / postponed

### KYC review — `/admin/users/kyc` → `KycReviewScreen`
- **Calls:** `GET /v1/admin/kyc-review`.
- **Status:** 🔴 BROKEN + partly 🟠. With email-OTP KYC (RA-C.10) the case
  auto-approves on code verification — there is **no human review queue** for the
  MVP. This screen only becomes relevant if/when document/provider KYC is added
  (same `kyc_cases` table). For now: repurpose to a read-only KYC status view or
  hide.

### Risk profiles — `/admin/users/risk-profiles` → `RiskProfilesScreen`
- **Status:** 🟠 **OBSOLETE.** Decision 9: clients are not risk-profiled; risk is
  a fund attribute. Remove this screen (and drop it from the nav), or repurpose
  to a fund risk-tier reference. `risk_assessments` stays dormant in the schema.

### Support tickets — `/admin/system/support` → `SupportTicketsScreen`
- **Status:** 🟡 **POSTPONED.** Support is out of MVP per spec (no schema). Leave
  as a fixtures-only stub or hide until a support domain is designed.

## Missing entirely (no screen, no route) ⚪

### RBAC / admin-staff management
- **Schema:** `roles`, `permissions`, `role_permissions`, `user_roles` (012),
  seeded (`superadmin`, `onboarding`, `finance`, `content`, `support`) and one
  bootstrap admin via `seed:auth`.
- **Gap:** no admin screen and no runtime management. Spec 03 §3.3/§5.2 requires
  every runtime role/permission change to go through `rbac.permissions.change`
  **maker-checker** (`approval_actions`). Today admins can only be created by the
  bootstrap seed. Building admin-staff + role management (with maker-checker) is a
  distinct future slice.

### Email deliveries viewer
- `GET /v1/admin/email-deliveries` **exists** (BE-016) but no admin screen
  consumes it. A small "communications" screen could surface it.

See the prioritized plan in [[05-backend-gaps-and-build-plan]].
