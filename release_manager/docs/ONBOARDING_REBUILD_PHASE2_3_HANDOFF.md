# Onboarding Rebuild — Phase 2 & Phase 3 Handoff

Date: 2026-08-12
Status: **Phase 1 complete and verified. Phase 2 (integration + e2e) and Phase 3 (VPS deploy + smoke test) NOT started.**
Approved plan: `~/.kimi-code/sessions/wd_boe_app_af2a0f723555/session_6ee43a6c-9f1f-4ea3-8846-61fe71429406/agents/main/plans/squirrel-girl-hulk-venom.md`

---

## 1. What this project is

Rebuild of the BeOnEdge client onboarding flow into a single canonical path:

```text
beonedge.in signup (POST /newuser, password collected) — UNCHANGED WORKING BOUNDARY
  → application lands directly in 'submitted' (no signup email, no website verification)
  → Admin Panel → Approvals: exactly [Approve] [Reject], no reason/message/review step
  → Approve: active user created with signup password + account_approved email
     containing the official CLIENT APK download link
  → Reject: immediate, no input required
  → Client installs APK, logs in with signup email+password
  → In-app email verification: 6-char case-sensitive alphanumeric OTP (a-zA-Z0-9)
     via /v1/client/kyc/* — this IS the KYC gate
  → deriveInvestingEligibility (server-side) unlocks investment features
```

State model mapping:

| Logical state | Representation |
|---|---|
| PENDING_APPROVAL | `applications.state = 'submitted'` |
| REJECTED | `applications.state = 'rejected'` (no user created) |
| APPROVED_UNVERIFIED | `users.account_state='active'` + no approved `kyc_cases` |
| APPROVED_VERIFIED | approved current `kyc_cases` row → eligibility `eligible` |

## 2. Phase 1 — already DONE (do not redo)

Four parallel agents completed and verified:

- **Backend onboarding/approval** (`backend_controller`): `submitApplication.ts` now creates applications directly in `submitted`; removed `/newuser/verify-email`, `verifyApplicationEmail.ts`, `verify_email` template, verification tokens, `/v1/admin/applications/:id/review`, `startApplicationReview`, mandatory `reasonCode`/`reasonDetail`, `allowUnverifiedEmail`, activation-invite stack (`activation_invites`, `POST /v1/activations/complete`, `activateUser`, `createInvited`, `resendActivationInvite`, `activation_invite` template), and admin `/v1/admin/kyc-review/*` endpoints. `account_approved` email template now includes the client APK download URL resolved from the same release-sidecar feed as `GET /v1/app/update` (`APK_DOWNLOAD_BASE_URL/client/<latest filename>`; email still sends with a logged warning if no APK published). New migration `db/migrations/025_onboarding_rework.sql` (enum reduced to submitted/approved/rejected/withdrawn, drops `verification_tokens`, `activation_invites`, `applications.email_verified_at`; drops+recreates the partial unique indexes `applications_active_email_uk/phone_uk` around the enum swap — verified on scratch postgres:16).
- **OTP + contracts**: `kyc.ts` `generateVerificationCode` — 6 chars over 62-char `a-zA-Z0-9` via `crypto.randomInt(0,62)` (CSPRNG, unbiased); keyed-hash storage, 10-min TTL, 5 attempts, 60s resend cooldown, supersede-on-resend all retained; compare is constant-time and case-sensitive. Zod schema now `/^[A-Za-z0-9]{6}$/u`. `packages/contracts` pruned (activation ops, stale `/v1/applications` ops removed; openapi regenerated; 95/95 tests pass).
- **Admin frontend**: Approvals rows have exactly `[Approve] [Reject]` with busy-flag + Idempotency-Key protection; `ApprovalReviewPanel.jsx` and `KycReviewScreen.jsx` deleted; single `POST /decision` with no body; approval toast mentions the welcome email with download link.
- **Client app**: `KycVerify.jsx` input is text, case-preserving, no digit stripping, `/^[A-Za-z0-9]{6}$/`; `RequireApproved` gate now checks server `GET /v1/client/eligibility`; `fromNativeUser` maps real `accountStatus`; deleted `Activate.jsx`, `ApprovalRequired.jsx`, pending-approval dashboard lock, fixture signup branch, dead `/signup` redirect.

Phase 1 verification results: backend build clean; unit 424/424; integration 189/192 (3 pre-existing SNS failures in `emailDelivery.integration.test.ts`, confirmed failing on unmodified base tree — cert/time-related, NOT caused by this work, do not chase); contracts 95/95; frontend build clean; migration 001–025 clean on scratch Postgres.

### Wire contracts Phase 2/3 must rely on

- `POST /newuser`: requires `password` (12–128) + fullName/email/phone/acceptedConsents; response `outcome: created|duplicate_pending|duplicate_account`, `verificationEmailQueued` always `false`. No signup email sent.
- `POST /v1/admin/applications/:id/decision?outcome=approved|rejected`: `Idempotency-Key` header only — **no body, no reason, no If-Match**. Fixed audit codes `admin_approved`/`admin_rejected` stored internally.
- `GET /v1/admin/applications?status=submitted` and `GET /v1/admin/applications/:id` → `{ application: { status, version } }` unchanged.
- KYC endpoints unchanged in shape: `POST /v1/client/kyc/start|resend`, `POST /v1/client/kyc/verify {code}`, `GET /v1/client/kyc-status`, `GET /v1/client/eligibility` → `{canInvest, ...}`.
- OTP error semantics: 400 `TOKEN_INVALID`, 410 `TOKEN_EXPIRED`, 429 cooldown, 409 locked-after-5, verify-after-approved is 200 no-op.

## 3. Phase 2 — Integration & E2E (TODO)

### 3.1 Rewrite `test_e2e/onboarding-e2e.mjs`

It still walks the legacy path (`/newuser/verify-email` at ~line 140, activation, numeric OTP). New script flow:

1. Signup via API with password → assert application `submitted`, no signup email queued.
2. Admin login → `POST /decision?outcome=approved` with Idempotency-Key, no body.
3. Assert native login with signup password succeeds.
4. `kyc/start` → read the emailed code via the Mailpit sink (`test_e2e/local-stack.sh`, 127.0.0.1:1025) → assert `/^[A-Za-z0-9]{6}$/`.
5. `kyc/verify` wrong-case code → rejected; correct code → approved → eligibility `canInvest=true`.
6. Reject path: no body, application `rejected`, user cannot log in.
7. Check `test_e2e/signup-users.mjs` still matches the `/newuser` contract (password field assumption); fix only if clearly broken.

### 3.2 Reconcile cross-agent loose ends

- **listPendingApprovals**: Agent D kept `listPendingApprovals`/`readLocalPendingApprovals`/`LOCAL_PENDING_APPROVALS_KEY` in `frontend_stack/packages/client/src/services/authApi.js` claiming admin files still import them (`ApprovalsScreen`, `AppBuilderScreen`, `StubScreen`, `AumScreen`, `AumRedemptionsTab`, `MandatesScreen`, `helpers/loadAdminData.js`); Agent C claims a repo-wide grep was clean. **Verify with grep who is right.** If admin still imports it for generic fixture purposes, keep; if it's dead approvals legacy, remove imports + function.
- `authApi.signup` always-throwing stub re-exported from `packages/client/src/index.js` — remove if nothing calls it.
- Backend `seedCatalog` still seeds consumerless permissions `invitations.manage`, `applications.review`, `kyc.read`, `kyc.review` — remove if no role/test depends on them.
- `packages/contracts/src/operations/descriptor.ts` unused vocabulary (`native-activation`, `public-token`, etc.) — prune only if trivially safe; otherwise leave.
- Accepted leftovers (leave alone): `user_account_state` enum value `invited`, `applications.review_started_at` column, admin user-detail KYC read (`mapKycCase`), `src/crypto generateVerificationToken`.
- `frontend_stack/packages/client/src/pages/KycDetail.jsx:27` copy still says "six-digit code" — update to "6-character code". (`Security.jsx:101` "6-digit PIN" is the app-lock PIN, unrelated, keep.)

### 3.3 Full repo verification

- `cd backend_controller && npm run build && npx vitest run && npm run test:integration` — expect 424 unit, 189/192 integration (only the 3 pre-existing SNS failures).
- `cd packages/contracts && npm test` — expect 95/95.
- `cd frontend_stack && npm run build && node packages/client/src/components/chartMath.test.js`.
- Dead-reference grep sweep (exclude node_modules/dist/.git): `pending_email_verification`, `in_review`, `verify-email`, `verify_email`, `activation_invite`, `completeActivation`, `reasonCode`, `reasonDetail`, `allowUnverifiedEmail`, `ApprovalReviewPanel`, `KycReviewScreen`, `kyc-review`, `6-digit`, `startApplicationReview`, `resendActivationInvite`, `pending_review`, `ApprovalRequired`. Fix code hits; update stale comments in active code; hits under `.resources.legacy.TLDR/` or `vault.md/` are archives — leave, but list them.

### 3.4 Doc updates

Minimal edits to root `CLAUDE.md` / `DEPLOY.md` / `WORKFLOW.md` where they describe removed flows (verify-email link, activation, review step, rejection reasons, numeric OTP). **Do not git commit anything.**

## 4. Phase 3 — Deploy & verify on VPS (TODO)

Access: `ssh beonedge`. Dev stack: `/srv/dev_stack/BOE_APP/dev_release/`. Backend code is **baked into docker images** — no hot path; changes require image rebuild + redeploy via `dev_deploy.sh` (see `DEPLOY.md`). Prod stack is empty scaffolding — out of scope.

### 4.1 Deploy

1. Rebuild images and redeploy dev stack per `DEPLOY.md` (`dev_deploy.sh`, images pinned by `BOE_VERSION`).
2. Run migrations (001–025 must apply; 025 does an enum rewrite + table drops — take a DB backup/snapshot first even though no real clients exist).
3. Health checks: `docker ps` — `boe-dev-backend`, `boe-dev-email-worker`, `boe-dev-app`, `boe-dev-admin`, `boe-dev-postgres` all healthy; email-worker logs show `transportConfigured: true`, no errors.

### 4.2 End-to-end smoke (controlled test address ONLY — never real clients)

1. Signup via API with a throwaway test inbox → application appears in admin queue (`submitted`).
2. Approve → confirm `email_deliveries` row for `account_approved`, email-worker logs `sent:1`, and the email body contains `https://dev-app.beonedge.in/downloads/client/boe.dev.client.<version>.apk`.
3. `curl -sI` the APK URL → HTTP 200, `content-length: 2431825` (v0.8.7 at time of writing), `application/octet-stream`.
4. Native login with signup credentials → `kyc/start` → retrieve code from the test inbox → assert 6-char alphanumeric → wrong-case verify → 400; correct verify → approved → `GET /v1/client/eligibility` → `canInvest: true`.
5. Reject path on a second throwaway signup → no user, login fails, no rejection input required.
6. Also verify a rejected/pending account cannot reach protected client routes.

### 4.3 Security rules (absolute)

- NEVER print/log/commit `.env` values, SMTP credentials, or OTP codes. When inspecting env files, redact values (`sed 's/=.*/=<redacted>/'`).
- SMTP config (already healthy, do not change): Zoho `smtppro.zoho.in:465`, `EMAIL_SMTP_SECURE=true`, sender `support@beonedge.in`, consumed via the `x-backend-env` anchor in `docker-compose.dev_app.yml` by backend + email-worker.
- OTPs must never appear in API responses or logs.

## 5. Known pre-existing issues (not part of this work)

- 3 SNS integration test failures in `emailDelivery.integration.test.ts` (cert/time-related; fail on base tree too) — deserves its own ticket.
- `ApprovalsScreen.jsx` retains a pre-existing unused-import block (dead before the rework; lint cleanup optional).

## 6. Final report obligation

After Phase 3, produce the report per the original task §26: existing flow discovered, files changed, legacy removed, state model, approval transaction, APK distribution, SMTP (no credentials), OTP lifecycle, authorization gate, tests performed, remaining issues.
