# Onboarding Rebuild — Completed Phase 2/3 Handoff

Date: 2026-08-12

Status: **Phase 1, Phase 2, and Phase 3 complete. Development stack is running v0.8.8.**

Repository release: `ed40876`, tag `v0.8.8`

Working-tree rule: **do not commit automatically**; the post-release SMTP-egress, live-smoke, test, and documentation changes remain for operator review.

## 1. Final result

The development flow now has one onboarding path:

```text
beonedge.in /signup (password collected)
  -> POST /newuser
  -> applications.state = submitted; no signup verification email
  -> admin Approve or Reject (bodyless, idempotent decision)
  -> Approve creates an active user with the signup password and queues an
     account_approved email containing the canonical client APK URL
  -> client logs in and completes the in-app 6-character alphanumeric OTP
  -> approved KYC makes server-derived investment eligibility true

Reject creates no user, sends the rejection notice, and login remains denied.
```

Logical states map to persisted state as follows:

| Logical state | Persisted representation |
|---|---|
| `PENDING_APPROVAL` | `applications.state = 'submitted'` |
| `REJECTED` | `applications.state = 'rejected'`; no user |
| `APPROVED_UNVERIFIED` | active user plus no approved current `kyc_cases` row |
| `APPROVED_VERIFIED` | active user plus approved current `kyc_cases` row; eligibility `eligible` |

## 2. What was discovered and removed

Before the rebuild, signup entered `pending_email_verification`, the website sent a token link, an admin moved the application through a review step with reason input, approval could create an invited account, and the client completed a separate activation flow. KYC used a numeric code and parts of the client trusted local approval state.

Removed legacy paths and artifacts include:

- website pre-approval email verification and `POST /newuser/verify-email`;
- `verification_tokens`, `activation_invites`, and `applications.email_verified_at` through migration 025;
- admin `/review`, rejection reason input, unverified-email override, invitation resend, and manual KYC review;
- `/v1/activations/complete`, activation UI, pending-approval client UI, and fixture signup;
- `verify_email` and `activation_invite` templates and obsolete API contracts;
- stale permissions `invitations.manage`, `applications.review`, `kyc.read`, and `kyc.review`, including cleanup on upgraded databases.

The separate landing project on the VPS was also updated: visible confirmation-link wording was replaced with admin-review/APK-email wording, its verify-email API/page/components were retired, and the live retired route now returns 404. The three retired tracked files were moved to `/srv/dev_stack/BOE_LANDING/retired-onboarding-20260812/` and remain recoverable there or through Git.

## 3. Main implementation surfaces

The v0.8.8 change spans 106 repository paths. The important groups are:

- backend onboarding and approval: `submitApplication.ts`, `decideApplication.ts`, public/admin routes, repositories, migration `025_onboarding_rework.sql`;
- approval/rejection mail and APK resolution: `emailTemplates.ts`, `emailDeliveryRepository.ts`, `release/releaseFeed.ts`, runtime environment/composition;
- KYC OTP and authorization: `domain/client/kyc.ts`, `clientKycRoutes.ts`, native auth, client eligibility gate;
- admin/client UI: approvals screen/context/API, KYC verification, session mapping, dashboard and route cleanup;
- contracts: public/native operations and regenerated OpenAPI output;
- release/runtime: deploy validation, Nginx signup routes, stack Compose files, environment examples;
- E2E: `test_e2e/onboarding-e2e.mjs`, `signup-users.mjs`, `onboarding-harness.test.mjs`, and `vps-onboarding-smoke.mjs`.

The public landing is a separate repository at `/srv/dev_stack/BOE_LANDING/repo`; its modified files are intentionally not mixed into the BOE_APP Git repository.

## 4. Approval transaction and delivery

`POST /v1/admin/applications/:id/decision?outcome=approved|rejected` requires an `Idempotency-Key` and no request body or `If-Match`.

Approval locks and validates the submitted application, creates the active user from its Argon2id password credential, records the fixed internal decision code, updates the application, creates the outbox/email-delivery record, and returns the activation/user result. Idempotency prevents duplicate users or duplicate deliveries. The UI reports mail as queued rather than falsely claiming immediate delivery.

Rejection updates the application, creates no user, and queues the rejection notice.

## 5. APK distribution

The APK email reuses the release sidecars that power `GET /v1/app/update`. `releaseFeed.ts` selects only a release-signed client artifact whose target, variant, application ID, filename, and sidecar agree with the deployment:

- dev target/application: `dev` / `com.beonedge.app.dev`;
- prod target/application: `prod` / `com.beonedge.app`.

The public URL is formed from the validated canonical `APK_DOWNLOAD_BASE_URL`, `/client/`, and the selected versioned filename. No arbitrary sidecar URL is trusted.

The deployed `paths.json` was used as the authority for the Compose file, environment file, project name, version file, client APK directory, and backup locations. Its client holder contains:

```text
boe.dev.client.0.8.8.apk — 2,430,753 bytes
```

Live HEAD result: HTTP 200, `application/octet-stream`, positive `content-length`.

## 6. SMTP and the missing-email incident

The existing Zoho SMTP configuration was reused without exposing credentials: port 465, implicit TLS, certificate validation, and the configured support sender. Startup/deploy validation enforces the secure transport shape; KYC fails closed if SMTP is unconfigured.

The user's first approved request correctly queued `account_approved`, but the delivery became `retryable_failed` with `SMTP_TRANSPORT_ERROR`. This was not an Nginx or APK-path problem. The email worker was attached only to Docker's `internal: true` database network, so it could not resolve or reach Zoho.

The fix gives only `email-worker` a dedicated non-internal `${stack}_egress` bridge while retaining `${stack}_internal`; it publishes no ports and has no frontend peers. After recreation:

- worker networks: `boe_dev_egress`, `boe_dev_internal`;
- worker health: healthy;
- `transportConfigured: true`;
- authenticated SMTP transport verification: pass;
- the previously queued approval retried and reached `sent` on attempt 3.

The checked-in live smoke requires a separate `BOE_SMOKE_IMAP_USER` / `BOE_SMOKE_IMAP_PASSWORD`, exact dev origins, and the explicit one-shot `BOE_ALLOW_DEV_LIVE_SMOKE=I_UNDERSTAND_DEV_ONLY` acknowledgement. It will not silently run against production or reuse application SMTP variable names.

## 7. OTP lifecycle and authorization

- generation: six characters selected with `crypto.randomInt` from `a-zA-Z0-9`;
- comparison: case-sensitive, constant-time keyed-hash comparison;
- storage: only the keyed hash is persisted; plaintext is absent from DB, API, and logs;
- expiry: 10 minutes;
- invalid attempts: maximum 5 in the deployed dev policy, then locked;
- resend: cooldown enforced and the prior code is superseded;
- verified state: current KYC case becomes approved; repeated verification is idempotent.

Investment eligibility remains server-derived. Order/SIP creation and the client execution gate depend on `GET /v1/client/eligibility`; an active but unverified user receives `kyc_required` and cannot invest.

## 8. Phase 2 verification

Completed local verification:

- canonical local Mailpit E2E: signup/password, no signup mail, pending-login denial, approval, signup-password login, case-sensitive OTP, resend, eligibility, rejection, and client/admin authorization — pass;
- `node --test test_e2e/onboarding-harness.test.mjs` — 7/7 pass after final hardening;
- backend unit suite — 434/434 pass;
- backend coverage — 89.19% overall, above the 80% requirement;
- backend build, typecheck, lint, source smoke, and dist smoke — pass;
- backend integration — 189/192; only the three pre-existing SNS certificate/time tests fail;
- contracts — 95/95 pass;
- frontend production build — pass;
- chart math — 13/13 pass;
- clean scratch Postgres migration 001 through 025 — pass;
- all `release_manager/tests/*.test.sh` scripts — pass, including path, env, deploy, APK, release, and runtime contracts;
- landing Vitest — 78/78 pass; landing production Next.js build — pass;
- `git diff --check` — pass.

## 9. Phase 3 deployment and live smoke

Deployment evidence:

- active version/tag: `0.8.8`;
- migration: `025_onboarding_rework`;
- healthy containers: backend, email worker, app, admin, Postgres, payment worker, and SIP worker;
- pre-deploy DB backup metadata: complete, type `pre-deploy`, 276,033 bytes, SHA-256 present;
- stale removed permission/grant count after migration/seed: 0;
- public signup page: HTTP 200 with canonical review/APK copy;
- retired landing verify API: HTTP 404;
- public client APK: HTTP 200 and correct binary content type.

The controlled Zoho-mailbox smoke completed with `LIVE PHASE 3 SMTP SMOKE PASSED`. It verified, without printing identities, credentials, tokens, bodies, or OTPs:

1. admin native login and authorization;
2. submitted signup with a stored password and no signup email;
3. pending-account login denial;
4. bodyless approval, active account, and queued delivery;
5. approval mail arriving with the canonical v0.8.8 client APK URL;
6. downloadable APK headers;
7. login with the original signup password;
8. pre-KYC eligibility denial;
9. KYC email delivery and six-character alphanumeric format;
10. case-flipped code rejection, five-attempt lock, cooldown/resend, a genuinely fresh code, exact-code approval, and eligible result;
11. rejection with no user, rejection email delivery, and continued login denial;
12. client bearer denial on the admin surface.

Native sessions created by future smoke runs use a stable admin device identity and are revoked in `finally`. IMAP and HTTP operations have timeouts, and mailbox responses have a size limit. The small IMAP client handles ASCII test-mail literals; a maintained byte-oriented client remains preferable if this harness grows beyond the controlled mailbox.

## 10. Nginx status and operator-only activation

The live endpoint behavior is already correct because the retired landing handler is gone. The non-root SSH account cannot replace root-owned `/etc/nginx/sites-available/*` files. Patched and backed-up source configs are ready at:

- `/srv/dev_stack/BOE_LANDING/nginx/boe-landing.conf`;
- `/srv/dev_stack/BOE_APP/NGINX/dev-app.beonedge.in.conf`.

The operator should run once:

```bash
sudo install -m 0644 /srv/dev_stack/BOE_LANDING/nginx/boe-landing.conf /etc/nginx/sites-available/boe-landing
sudo install -m 0644 /srv/dev_stack/BOE_APP/NGINX/dev-app.beonedge.in.conf /etc/nginx/sites-available/boe-dev-app
sudo nginx -t && sudo systemctl reload nginx
```

This removes the stale explicit landing verify location and installs the exact `/api/newuser` limiter. It does not change the working upstream ports or APK aliases.

## 11. Remaining issues and recovery notes

- Three SNS integration tests remain pre-existing failures caused by their certificate/time fixture. They reproduce outside this work and should be tracked separately.
- Rollback from v0.8.8 to v0.8.7 or older **must** use the matching pre-v0.8.8 database backup (`--restore-db`); application-images-only rollback is unsafe across destructive migration 025. Keep the application and workers stopped for that restore instead of starting old images against the new schema.
- The email worker still inherits the shared backend environment because the current composition parses the full runtime schema. Its network is now least-privilege, but splitting a worker-specific runtime schema/environment is a separate hardening task.
- A dedicated controlled smoke mailbox/app password should be supplied for future live runs; do not inject mailbox-reading credentials into long-lived application containers.
- The landing proxy now validates successful backend outcomes and pins production `BEO_API_BASE` to the canonical HTTPS `/api` origins before it forwards a plaintext signup password and shared key.
- The BOE_APP and landing changes are intentionally uncommitted. The landing repo's pre-existing untracked `docker-compose.override.yml` was preserved.
- Compose and Nginx source backups created during diagnosis are recoverable as `*.before-...-20260812`; retired landing source files are also recoverable from Git and the dated retirement directory.

No production deployment was performed.
