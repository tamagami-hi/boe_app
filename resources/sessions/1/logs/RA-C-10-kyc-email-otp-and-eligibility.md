# RA-C.10 Email-OTP KYC + frictionless (KYC-only) eligibility

Status: DONE — branch `ts-migration/backend`. Tenth batch of RA-C. Adds the
compliance write slice as a company-emailed one-time code, and simplifies
investing eligibility to KYC-only so a client reaches `eligible` end-to-end in one
go (decisions 8-10).

## Backend

- **Migration `019_kyc_email_verification.sql`** — a dedicated
  `kyc_verification_codes` table (hashed 6-digit code, `attempt_count`,
  `expires_at`, one-active-per-case partial unique, composite `(kyc_case_id,
  user_id)` FK). *Chosen over extending `token_purpose`/`verification_tokens`*
  because OTP semantics (attempt counting + resend) differ from the high-entropy
  link tokens; keeps the canonical table clean.
- **`EmailSender` port + adapters** (`src/email/emailSender.ts`) —
  `createSmtpEmailSender` (`nodemailer`, company mailbox + `KYC_EMAIL_FROM` from
  env) and `createLogEmailSender` (metadata-only dev/test fallback; never logs the
  code). Env: `KYC_EMAIL_FROM`, `EMAIL_SMTP_HOST/PORT/USER/PASSWORD/SECURE` +
  `KYC_CODE_TTL_MS` / `KYC_CODE_MAX_ATTEMPTS` / `KYC_RESEND_COOLDOWN_MS` /
  `KYC_VALIDITY_MS`.
- **`kycRepository`** — `kyc_cases` lifecycle (find approved, lock open case,
  create, markSubmitted, approve) + code ops (lockActive, latestCreatedAt,
  consume, create, incrementAttempt).
- **KYC commands** (`src/domain/client/kyc.ts`) — `requestKycCode` (ensures an
  open case, enforces the resend cooldown, supersedes the active code, issues a
  hashed 6-digit code, returns the raw code + email for a **post-commit** send;
  idempotent when already approved) and `verifyKyc` (constant-time compare,
  expiry + attempt cap; **returns an outcome** rather than throwing so a failed
  attempt's increment commits; on success approves the case with an expiry).
- **Eligibility simplified** — `deriveInvestingEligibility` drops the risk gate
  (decision 9): `active + current approved KYC` → `eligible`. The eligibility
  endpoint no longer exposes risk. `risk_assessments` stays dormant.
- **Routes** (`src/routes/clientKycRoutes.ts`) — native-authenticated
  `POST /v1/client/kyc/{start,resend,verify}`; the start/resend routes email the
  code after commit and map a send failure to `503`. Wired in `composeBackend`
  (SMTP sender when configured, else log fallback).

## Frontend

- `packages/client/src/services/kycApi.js` — added `startKyc` / `resendKyc` /
  `verifyKyc`; **preserved** the pre-existing `fetchKycStatus` / `updateKycDepth`
  (a deferred KycDetail screen depends on them).

## Validation

- `npm run check` green (331 unit; eligibility unit tests rewritten for KYC-only).
  `npm run test:integration` — **16 files, 136 tests** (was 130/15); branch 80.7%.
- **New** `test/integration/clientKyc.integration.test.ts` (6): the **end-to-end
  "one go"** proof — a fresh active user is `pending_compliance (kyc_required)`,
  `start` emails a code (captured), a wrong code is `TOKEN_INVALID`, the emailed
  code approves KYC, eligibility flips to `eligible/canInvest`, and the user
  immediately creates an order (201). Plus: already-approved idempotency, resend
  cooldown → `429`, expired code → `410`, attempt lockout after 5 wrong → `409`
  (attempt increments now persist), missing bearer → `401`.
- Frontend `npm run build` green. Guards: `git diff --check` clean; Legacy hash
  intact; backend authored JS still 0. New dependency: `nodemailer@7`
  (`package-lock.json` changed).

## Notes / boundaries

- Email-OTP proves email control; it is not document/identity KYC (decision 8) —
  layerable on the same `kyc_cases` later.
- KYC codes send directly (post-commit), bypassing the SES outbox durability +
  bounce/suppression — acceptable for short-lived OTP (recorded Open Risk).
- Frontend UI wiring of the KYC step into an onboarding screen is a follow-up;
  this batch ships the client service + the backend flow.
- APK/emulator packaging stays on the user's local stack.
