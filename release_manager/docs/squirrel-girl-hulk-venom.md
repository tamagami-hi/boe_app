# Plan: Rebuild Client Onboarding → Approval → APK Email → OTP Verification (KYC Gate)

> **Completion note (2026-08-12):** Phases 1, 2, and 3 are complete on the
> development stack at v0.8.8. The original discovery and execution plan below
> is retained as historical context. Current evidence, the SMTP-egress incident
> and fix, test results, remaining operator action, and the final §26 report are
> in `ONBOARDING_REBUILD_PHASE2_3_HANDOFF.md`.

## Current state (verified by exploration)

**Backend** (`backend_controller`, Fastify 5 + Kysely/Postgres, TS ESM):
- Signup `POST /newuser` works and already collects password (Argon2id). **Keep untouched** (working boundary). But new applications start at `pending_email_verification` and require a 43-char emailed link (`POST /newuser/verify-email`) before reaching `submitted` — this is the website email verification to remove.
- Admin decision is two-step (`/review` then `/decision`) with **mandatory `reasonCode`**, an `allowUnverifiedEmail` gate, and a legacy activation-invite branch (`activation_invites`, `POST /v1/activations/complete`, `resendActivationInvite`, `invited` user state).
- Approval email template `account_approved` exists (outbox → `boe-dev-email-worker` → Zoho SMTP) but has **no APK link**.
- KYC OTP (`/v1/client/kyc/start|resend|verify`) already has the right mechanics (hashed storage, 10-min TTL, 5 attempts, 60s cooldown, supersedes prior code) but generates **6-digit numeric** codes.
- Investment gating already exists server-side: `deriveInvestingEligibility` (needs approved KYC) enforced in order/SIP creation + `GET /v1/client/eligibility`.
- APK feed: `GET /v1/app/update` resolves the latest release-signed APK from sidecar JSONs (`latestPublishedBuild`, `publicAppRoutes.ts:311`) and builds URLs from `APK_DOWNLOAD_BASE_URL`.

**Admin frontend** (`frontend_stack/packages/admin`, React 18 + Vite JSX): Approvals screen has Review panel with reason textarea (required on reject), unverified-email checkbox, `pending_email_verification` queue tier, legacy invite copy. Manual `KycReviewScreen` (PAN/Aadhaar review with reason) conflicts with OTP-as-KYC.

**Client app** (`frontend_stack/packages/client` + Capacitor Android): `KycVerify.jsx` OTP input strips non-digits, `inputMode="numeric"`. Legacy `Activate.jsx` (`/app/activate` → `/v1/activations/complete`). `RequireApproved` gate reads a **hardcoded** `status:'approved'` from local session (doesn't gate on verification). Legacy pending-approval UI (`ApprovalRequired.jsx`, dashboard lock). No in-app signup (good).

**VPS** (`ssh beonedge`, dev stack only — prod is empty scaffolding):
- SMTP: Zoho `smtppro.zoho.in:465`, `EMAIL_SMTP_SECURE=true`, From `support@beonedge.in`; email-worker healthy, transport configured, TCP connect OK. **No SMTP changes needed.**
- Client APK served by nginx: `https://dev-app.beonedge.in/downloads/client/boe.dev.client.<version>.apk` (no `latest` alias — exact versioned filename required, resolvable from sidecar JSONs like the update endpoint does). `APK_DOWNLOAD_BASE_URL=https://dev-app.beonedge.in/downloads` already in backend env.
- Backend code is baked into docker images → changes require image rebuild + `dev_deploy.sh` redeploy.

## Target state model (mapped to existing schema)

| Logical state | Representation |
|---|---|
| PENDING_APPROVAL | `applications.state = 'submitted'` (new signups land here directly) |
| REJECTED | `applications.state = 'rejected'` (no user/credential created; no reason required) |
| APPROVED_UNVERIFIED | `users.account_state='active'` (password copied from application) + no approved `kyc_cases` |
| APPROVED_VERIFIED | approved, current `kyc_cases` row (via OTP) → `deriveInvestingEligibility` = eligible |

## Implementation — Phase 1 (4 parallel subagents)

### Agent A — Backend onboarding/approval rework (`backend_controller`)
1. `submitApplication.ts`: create application directly in `submitted` state; remove verification-token creation, `verify_email` delivery, resend-cooldown logic, `verification_resent` outcome.
2. Delete pre-approval email verification: `POST /newuser/verify-email` route + `verifyApplicationEmail.ts` + `verify_email` template + `application_email_verification` token purpose + `SIGNUP_VERIFICATION_RESEND_COOLDOWN_MS` / `PUBLIC_LANDING_ORIGIN` / `APP_ACTIVATION_URL` env usage.
3. `decideApplication.ts` + `adminIdentityRoutes.ts`: single-step decision from `submitted` (no `/review` step); `reasonCode`/`reasonDetail` no longer accepted from admin (store fixed internal audit code); delete `allowUnverifiedEmail`; delete activation-invite branch (always password path: create active user + copy credential); delete `resendActivationInvite`, `POST /v1/activations/complete`, `activateUser`, `createInvited`; reject requires no input.
4. Approval email: extract latest-APK resolution from `publicAppRoutes.ts` into a shared helper; `account_approved` template gains welcome copy + client APK download URL (`APK_DOWNLOAD_BASE_URL/client/<latest-file>`) + login-with-signup-credentials + verify-email-in-app instructions. Graceful fallback if no APK published (email still sends, link omitted → log warning).
5. Migration `025_onboarding_rework.sql`: drop `pending_email_verification`/`in_review` from `applications` state enum handling (rewrite enum or adjust), drop `applications.email_verified_at`, drop `verification_tokens` + `activation_invites` tables.
6. Update backend integration tests (`publicRoutes`, `adminIdentity`, `authNative`, `emailDelivery`) and unit/guard tests to the new flow. Run `npm run build`, unit tests, and integration tests.

### Agent B — Backend OTP alphanumeric + contracts (`backend_controller`, `packages/contracts`)
1. `kyc.ts`: replace `generateSixDigitCode` with CSPRNG 6-char code from `a-zA-Z0-9` (62-char alphabet, `crypto.randomInt` rejection sampling); keep keyed-hash storage, TTL, attempts, cooldown, supersede-on-resend, constant-time (case-sensitive) compare.
2. `clientKycRoutes.ts`: zod schema → `/^[A-Za-z0-9]{6}$/`; OTP email text updated ("6-character code", case-sensitive note, 10-min expiry).
3. `packages/contracts`: delete stale `POST /v1/applications` op, `operations/activation.ts`, `/newuser/verify-email` op; update admin decision schema (no reason required) and KYC code schema; regenerate `openapi-v1.d.ts`; run contract tests.
4. Coordinate-free file split vs Agent A: B owns `src/domain/client/kyc.ts`, `src/routes/clientKycRoutes.ts`, `packages/contracts/**` only; A owns the rest. Update `clientKyc.integration.test.ts`.

### Agent C — Admin frontend (`frontend_stack/packages/admin` + shared `packages/client/src/services/adminApplicationsApi.js`)
1. `ApprovalsScreen.jsx`: per-row actions become exactly `[Approve] [Reject]`; remove Review/View-driven decision path, `pending_email_verification` tier/stat/filter, "Review to approve" branching; keep busy-flag + Idempotency-Key duplicate-click protection.
2. Delete `ApprovalReviewPanel.jsx` (reason textarea, unverified checkbox, invite copy); `handleUserDecision`/`resolveApplication` simplified to one `POST /decision` with no reason body; success toast updated to mention welcome email with app download link.
3. Remove manual KYC review UI: `KycReviewScreen.jsx`, `/admin/users/kyc` route, sidebar badge/entry, kyc-review collection loading in `LegacyAdminDataContext.jsx`. (Backend `/v1/admin/kyc-review` endpoints removed by Agent A.)
4. Remove `resendActivationInvite` from `adminApplicationsApi.js`; update `EmailDeliveriesScreen` template filter list (drop `verify_email`, `activation_invite`).
5. Build admin shell (`npm run build` in frontend_stack) to verify.

### Agent D — Client app (`frontend_stack/packages/client` + `app`)
1. `KycVerify.jsx`: OTP input → `inputMode="text"`, `autoCapitalize="none"`, `autoCorrect="off"`, `maxLength=6`, **no character stripping**, case preserved; all copy "6-digit" → "6-character code".
2. Gate fix: `RequireApproved` → check server `GET /v1/client/eligibility` (via `eligibilityApi`), block execution routes when `canInvest=false` and redirect to `/app/verify-email`; fix `fromNativeUser` hardcoded `status:'approved'` to use backend `accountStatus`; unverified-but-logged-in users landing on dashboard see the existing verify-email card.
3. Delete legacy flows: `pages/Activate.jsx` + `/app/activate` route + `authApi.completeActivation`; `pages/ApprovalRequired.jsx` + pending-approval lock in `Dashboard.jsx` + `utils/approval.js` pending statuses; fixture-only `authApi.signup`/`SessionContext.signup` dead branch; dead `/signup` redirect `?mode=signup` in `ClientRoot.jsx`.
4. Keep: login, `/app/verify-email`, `/app/profile/kyc`, dashboard verify card, app-update gate, logout — all reachable pre-verification.
5. Build client shell to verify.

## Phase 2 — Integration & E2E (1 subagent, sequential)
1. Rewrite `test_e2e/onboarding-e2e.mjs` to the new flow: signup → admin approve (no reason) → login with signup password → KYC OTP start/verify (assert 6-char alphanumeric, case-sensitivity, wrong-code reject, resend supersedes) → eligibility eligible. Verify `test_e2e/signup-users.mjs` still valid.
2. Full repo checks: backend `npm run build` + unit + integration tests; contracts tests; frontend builds; grep sweep for dead references (`verify-email`, `activation`, `reasonCode`, `ApprovalReviewPanel`, `Activate`, `pending_email_verification`, `allowUnverifiedEmail`, `kyc-review`).

## Phase 3 — Deploy & verify on VPS (1 subagent, sequential)
1. Rebuild images and redeploy dev stack via `/srv/dev_stack/BOE_APP/dev_release/dev_deploy.sh` (per `DEPLOY.md`); run migrations.
2. Health checks: containers healthy, email-worker `transportConfigured:true`, no errors.
3. End-to-end smoke on dev (controlled test email address only — never real clients): signup via API → approve → confirm `account_approved` delivery row + email-worker sent + APK link = `https://dev-app.beonedge.in/downloads/client/boe.dev.client.<ver>.apk` → curl the APK URL (HTTP 200) → native login → kyc/start → kyc/verify with the code from the delivery → eligibility eligible. Never print SMTP secrets or OTPs in logs.

## Notes / decisions
- OTP email keeps the existing direct-SMTP path; approval email keeps the outbox worker (both already healthy on Zoho 465).
- Admin `/v1/admin/kyc-review` endpoints removed (OTP self-approves KYC; conflicts with the canonical flow).
- No changes to `/newuser` signup contract, the beonedge.in site, nginx, or APK shipping (`apk_ship.sh`) — the email reuses the existing update-feed infrastructure.
- Executing agents should follow relevant installed skills (security-review for OTP/auth changes, postgres-patterns for the migration, react-patterns for UI) and the repo's guard-test conventions.
