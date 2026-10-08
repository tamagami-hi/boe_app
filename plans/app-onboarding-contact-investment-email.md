# BeOnEdge app: onboarding, contact details, earlier investments, and email

Status: **Approved for implementation by the maintainer on 2026-10-08, in dependency order. Step 1 is in progress (section 8). Q-002 to Q-004 stay open and gate steps 5, 7, 8, and 9.**

Prepared: 2026-10-08. Investigation is source-level only; no production diagnosis, test runs, builds, mail sends, or deployments were performed. Since then only the admin authorization and seeding claims have been checked against source (section 2F). Every other claim in section 2 is unverified, and each step verifies the claims it depends on before it changes code.

Governing process: root [RULES.md](../RULES.md). The maintainer requested rulebook
consolidation before implementation; app-feature work remains paused. The maintainer
confirmed on 2026-10-08 that the application is in production, so every schema change
in this plan follows `RULES.md` rule 11 (expand first, no loss of existing data).

## 0a. Open questions and conservative defaults

IDs are stable and are not reused. These are proposal defaults, not permission to
move funds, change identity authority, send customer mail, or deploy.

| ID | Open decision | Conservative behavior meanwhile |
| --- | --- | --- |
| Q-002 | Whether phone changes need an SMS provider/ownership proof | Propose password-confirmed unverified contact edits; do not invent an SMS service or implement before approval. |
| Q-003 | Approval of per-fund/date earlier-principal entry during onboarding | Reuse the existing principal-contribution path in the proposal; do not record any real amount or treat growth as principal. |
| Q-004 | Editable template fields and initial recipient scope | Propose safe subject/body placeholders and one selected existing client; no bulk sends or arbitrary HTML. |
| Q-011 | Permission codes for the new capabilities. Proposed: `clients.password_links.send` for step 3, and one code each for template editing and for test send plus send-to-client, named before steps 8 and 9 (for example `email_templates.write` and `email_messages.send`) | Step 3 uses the dedicated code named in this plan; steps 8 and 9 wait for names. The single superadmin receives every catalog code, so a dedicated code widens nobody's access. |
| Q-012 | Grant propagation for a new permission code: the operator confirms the seed flags, or `seedAuth.ts` is changed to reconcile superadmin grants even when the admin bootstrap is skipped | Change nothing in `seedAuth.ts`, because that alters what "catalog only" means. Before relying on a new code the operator checks that `SEED_AUTH_ENABLED` is not `false` and, with `NODE_ENV=production`, that `SEED_AUTH_ALLOW_PRODUCTION` is `true` on each stack. `backend_controller/.env.production.example` sets `SEED_AUTH_ENABLED=false` while both stack examples set it to `true`. |
| Q-013 | Self-protection for the sole admin, which can suspend or close its own account with no in-app or seed recovery | Out of scope for this plan; no change. Steps 3 and 4 add actions to the same screen and must not make this worse. |

### Decision record

| Date | Maintainer decision | Status |
| --- | --- | --- |
| 2026-10-08 | Consolidate the supplied rulebook and this repo's rules into one root `RULES.md`, adapt it to BeOnEdge, and enforce it through agent entrypoints. | Documentation change; not approval to implement app features. |
| 2026-10-08 | The application is in production. Replace the pre-production forward-only development rule with a production data-safety and compatibility rule: major database changes must be thoughtful and must not lose user data. | Applied in `RULES.md` rule 11 (with rules 10 and 16, verification boundaries, and document upkeep), `README.md`, `AGENTS.md`, `DEPLOY.md`, and `release_manager/README.md`. This plan updated in sections 0a, 4, 6, and 7. Not approval to implement app features. |
| 2026-10-08 | Q-007 answered: the application has exactly one admin account, seeded from the stack `.env`, and it holds every role. This stays. No per-role permission design is needed. | Source check: `seedAuth.ts` grants the `superadmin` role every code in `SEED_PERMISSIONS` and assigns it to the seeded admin, `requireAnyPermission` has no bypass, and no code assigns any other role. A new permission code is added to `seedCatalog.ts` and the frontend `permissions.ts`, and reaches the admin through the seed step that runs after `migrate`. The earlier proposed default (grant none) is withdrawn because it contradicted that mechanism. New codes are inserted by every seed run but granted to the admin only when `SEED_AUTH_ENABLED` is not exactly `false` and, under `NODE_ENV=production`, `SEED_AUTH_ALLOW_PRODUCTION` is exactly `true` (`seedAuth.ts:70-71,181`). Compose defaults both to true. A skipped grant exits 0, and neither the deploy preflight nor the health check notices. The real `.env` was not read, so the operator confirms the values on dev and then prod before relying on a new code (Q-012). |
| 2026-10-08 | Q-009 answered: older APKs are in use. The maintainer exports and redeploys in a scheduled maintenance period, dev stack first and then production with a maintenance notice, and handles that timing. Build and implement without waiting on it. | Not a decision to break released clients: API changes stay additive unless the maintainer raises `minimumSupportedVersion`. |
| 2026-10-08 | Q-001 answered: build and implement the plan ("all clear to build and implement"), and plan and implement any gap found along the way. | Implementation proceeds in dependency order, one commit per step. This does not answer Q-002 to Q-004, which still gate steps 5, 7, 8, and 9. |
| 2026-10-08 | Q-005 answered: commits are authored as `tamagami-hi <193059379+tamagami-hi@users.noreply.github.com>` from the global Git configuration. | The repo-local `user.name = nethunter07` override was removed on the maintainer's instruction. The effective author and committer were verified before the first commit. |
| 2026-10-08 | Q-006, Q-008, and Q-010 answered: because the app is live, make non-destructive changes. | Each migration stays compatible with the previous release, and the maintainer chooses the release cut (Q-006). Password links issued before the binding migration are backfilled so they keep working, with no legacy-token path in code (Q-008). Outbox and delivery rows already in the database are left as recorded and never re-sent (Q-010). |
| 2026-10-08 | The maintainer ruled that source code, not documents, is the source of truth, and authorized planning and implementing any gap found while checking the plan against source. | A six-way source audit was started and stopped for cost after one report finished (admin authorization and seeding, section 2F). Every other claim in section 2 is unverified; each step verifies the claims it depends on against the files it edits and records corrections in section 8. Gap work stays inside `RULES.md` (no fund movement, real sends, or deployment). |

#### Replaced

| Date replaced | Previous decision | Reason |
| --- | --- | --- |
| 2026-10-08 | The application is pre-production; development is forward-only, with no compatibility aliases, deprecated endpoints, dual reads or writes, or migration branches unless requested per task (first in `AGENTS.md`, then `RULES.md` rule 11). | The maintainer confirmed the application is in production, so user data and released clients must be preserved. |

## 1. Requested outcomes

1. Admins can recover a timed-out client creation and resend the correct password set/reset link.
2. Clients can securely change their email address and phone number.
3. Admins can record money invested before onboarding, separately from growth adjustments.
4. Transactional emails use professional, consistent BeOnEdge presentation and copy.
5. Email OTP messages receive the same visual treatment without changing their security semantics.
6. Admins have preloaded email templates, custom templates, preview, and explicit test/send actions.

The public education website is outside this repository and is not part of this change.

## 2. Findings and evidence

### A. Client-creation timeout and missing resend

- `backend_controller/src/routes/adminClientOnboardingRoutes.ts:75-117` commits the account and idempotency response, then awaits a direct SMTP invite before replying. SMTP failure is logged but the route still returns account-creation success.
- `backend_controller/src/routes/passwordRoutes.ts:217-228` silently returns when a password-link base URL cannot be resolved.
- `backend_controller/src/email/emailSender.ts:50-69` does not configure explicit SMTP connection, greeting, or socket timeouts.
- `frontend_stack_ts/src/api/http.ts:13` gives requests a 20-second default timeout. A client timeout does not undo a committed server transaction.
- `frontend_stack_ts/src/features/admin/users/CreateClientScreen.tsx:40-62` nevertheless says nothing changed / nothing was created on transport failure. Its success message also claims the invite was emailed without delivery evidence.
- `frontend_stack_ts/src/features/admin/shared/adminQueries.ts:551-569` generates a fresh idempotency key inside each create mutation. It cannot deliberately recover the original result using the original key.
- `UserDetailScreen.tsx` has lifecycle actions but no password-link resend action. The backend only registers the admin client-create endpoint in this module.

This is a source-level explanation for the reported symptom, not proof of which SMTP or network condition occurred on the VPS.

### B. Contact editing is absent and has authentication consequences

- `frontend_stack_ts/src/features/profile/ProfileScreen.tsx` shows the session's name/email and settings links, but no contact editor or current phone number.
- No client contact-update endpoint or corresponding user-repository update method was found.
- `backend_controller/db/migrations/010_canonical_identity.sql:18-49` makes normalized email and E.164 phone unique identifiers on users.
- `backend_controller/src/repositories/applicationRepository.ts:121-159` checks users plus submitted **and approved** applications for identity conflicts. `025_onboarding_rework.sql:73-76` also reserves approved application identifiers through partial unique indexes. Contact editing requires separating current ownership from immutable approved-application history, including self-exclusion in conflict checks.
- `backend_controller/src/repositories/emailVerificationRepository.ts` and `passwordTokenRepository.ts` bind verification/password tokens to a user ID, not to an email-address revision. Simply replacing the address would leave old verification and password-link authority attached to the account.
- No SMS delivery/verification integration was found in the current backend.

### C. Earlier-investment recording already exists

- Existing UI: **Client values → One investor's record → Record an investment made before the app**, in `frontend_stack_ts/src/features/admin/client-values/ClientPositionDetailScreen.tsx`.
- Existing API: `POST /v1/admin/clients/{userId}/recorded-contributions`, in `backend_controller/src/routes/adminClientPositionRoutes.ts`.
- Existing domain command: `backend_controller/src/domain/admin/recordContribution.ts`.
- It writes an accepted `recorded_offline` order, a recorded succeeded payment, an allocation, a contribution ledger entry, an audit event, and a client notification in one transaction. It creates no provider payment attempt and initiates no charge.
- The contribution adds the same amount to principal and current value; it is not a growth adjustment. It does not require an existing investment position or completed client email verification.
- The form is disconnected from client creation/user details, uses raw paise input, and gives unsafe "nothing was written" wording after an unknown transport outcome. Its mutation also mints a new key for each retry.

Reuse this financial path; do not introduce a second opening-balance or growth-based implementation.

### D. Email presentation and administration are fragmented

- `backend_controller/src/email/emailTemplates.ts` renders only approval/rejection, and only plain text.
- Password set/reset/download copy is assembled directly in `routes/passwordRoutes.ts`.
- OTP copy is assembled directly in `routes/clientEmailVerificationRoutes.ts`; the code is six alphanumeric, case-sensitive characters with configured expiry, attempts, and cooldown.
- `EmailMessage` already supports an optional HTML body, but `transactionalEmailSender.ts` currently forwards only text.
- `frontend_stack_ts/src/features/admin/emails/EmailDeliveriesScreen.tsx` is read-only. There is no template editor, preview, test send, or compose action.
- Both frontend filter options and the contract/backend filter schemas currently recognize only approval/rejection template keys.
- An existing transactional outbox, encrypted recipient storage, suppression checks, retry scheduling, and email worker can support durable password-link and admin-message delivery.
- `dispatchDueDeliveries.ts` does not currently validate queued password-token expiry/consumption. `OutboxWriteRepository.cancel` currently only cancels claimed/sending rows; queued cancellation must be added for superseded security mail.

### E. Prerequisites found during adversarial plan review

- `passwordCredential.ts:104-136` does not recheck account activity, contact revision, or current credential state when redeeming a link. `applyNewPassword` does not invalidate outstanding password links. Already-sent stale links therefore need redemption-time protection, not just worker checks.
- `outboxRepository.ts:169-175` recovers expired leases only on outbox rows. The delivery projection can stay `sending`, which `dispatchDueDeliveries.ts:86-90` then cancels on the next preparation pass. Coordinated recovery and per-attempt fencing are prerequisites for promising durable link delivery.
- `domain/auth/webAuth.ts:356-381` and `nativeAuth.ts:390-428` recheck the verified password hash under lock but not the original login email/contact revision. An old-email login already in flight could otherwise create a session after an email change revokes existing sessions.
- `idempotencyRepository.ts:35-44` excludes expired responses, with a default 24-hour replay window. Recovery of critical creation/contribution attempts must not depend on that window or silently reuse an expired key.
- Earlier-investment server input currently has regex-only dates and permits some paise values above PostgreSQL's signed-bigint range. Authoritative calendar/range validation belongs in the financial step, not just in the new form.

These are narrow prerequisites for the requested recovery/contact/financial behavior; they are not authorization for an unrelated security refactor.

### F. Admin authorization and seeding, checked against source (2026-10-08)

Evidence is STATIC: source, SQL, compose, and shell were read; nothing was run and no real `.env` was read. The seed and the access resolution were re-read independently. The other items come from the audit report and were not re-checked.

- Authorization is per handler: `resolveAdminPrincipal`, then `requireAnyPermission` (`backend_controller/src/domain/admin/adminAccess.ts`). Roles and permissions are read live from the database on every request, nothing special-cases `superadmin`, and no hook or test enforces the guard centrally.
- There is one admin. Only `seedAuth.ts` writes `user_roles` and `role_permissions`: it grants the `superadmin` role every code in `SEED_PERMISSIONS` and assigns it to the one login named in `.env`. The other four seeded roles are never assigned.
- A new permission code needs a `seedCatalog.ts` entry, a frontend `permissions.ts` entry, a route guard, and tests (a superadmin positive and a `support` negative). It needs no migration. No test compares the two code lists.
- Seven of 33 codes are never enforced: `roles.assign`, `permissions.change`, `finance.read`, `approvals.request`, `approvals.check`, `support.read`, and `support.write`. Maker-checker is not wired; migration 030 dropped its table.
- Corrections to this plan: step 3 task 2's "active-client" has no meaning in the schema (an admin is a user with an active role grant). `issuePasswordToken` guards neither role nor account state, its cooldown is per user and shared with the unauthenticated forgot route, and admin attribution of the audit row is new code. Steps 4 and 7 need component-level `hasAnyPermission` gates, because `CreateClientScreen`, `UserDetailScreen`, and `ApplicationDetailScreen` have none, and the UI permission set updates only on reload or sign-in.
- Gaps recorded outside this plan: the sole admin can suspend or close itself (Q-013); changing `ADMIN_LOGIN_ID` creates a second live superadmin or blocks the stack on a phone collision; the seed re-grants revoked rows on every run; `users.read_limited` limits nothing.
- Not checked: the real `.env` files, the VPS, the production database, and any runtime behavior.

## 3. Recommended defaults for approval

These defaults are proposals, not decisions already made by the maintainer.

| Decision | Recommended behavior |
| --- | --- |
| Earlier invested amount | Original principal per fund, with the actual investment date. Do not include historical growth in the principal amount. |
| Creation plus investment | Two explicit steps: create/recover the account, then optionally record an earlier investment. An investment failure must not recreate the account. |
| Email change | Confirm current password; verify the new address before replacing the current login address. Keep the current address valid while verification is pending. |
| Phone change | Confirm current password; validate/normalize and check uniqueness. Do not label the number verified. SMS verification is a separate scope requiring a provider decision. |
| Custom templates | Editable subject/body and allowlisted placeholders inside the fixed branded layout; no arbitrary HTML or script-capable editor. |
| Recipients | One explicitly selected existing client per send initially. No arbitrary external recipient input, bulk campaigns, or scheduled broadcasts. |
| Sign-off | `Regards,` followed by `BeOnEdge Team`. |
| OTP | Keep the existing six-character, case-sensitive code, expiry, cooldown, and attempt limits. This request changes presentation, not the OTP algorithm. |
| Password links | Server chooses `set` when no password exists and `reset` otherwise. Issuing a link does not change the password; redemption remains single-use. |
| Critical recovery retention | Keep creation and recorded-contribution receipts durable in the existing idempotency store. Other operations may retain their configured expiry, but an expired unresolved key must fail safely rather than become a new write. |
| Contact ownership | Users own their currently stored identifiers; submitted applications reserve pending identifiers. Approved applications remain immutable history, not permanent owners of contacts that a user has changed. |

## 4. Non-negotiable implementation invariants

- Read root `README.md` and follow root `RULES.md`, the single rulebook referenced by `AGENTS.md`. No source comments or routine cosmetic test files. Compatibility code only as `RULES.md` rule 11 permits, with its removal condition recorded in this plan.
- Before implementation, inspect file history/importers/tests and split any touched human-maintained source file over the rulebook's 800-line limit along real responsibility boundaries. Generated artifacts remain generator-owned. Keep new fields wired end to end; do not use file splitting to create a second implementation or unrelated refactor.
- Account creation, financial recording, and admin sends have stable keys per explicit logical operation. No automatic replay of financial writes and no blind creation with a new key after a timeout.
- Critical creation/contribution receipts remain recoverable beyond the ordinary 24-hour idempotency window. Use one authoritative idempotency store, not a second mirrored deduplication system. Payload-changing key reuse is rejected even after that window.
- Timeouts/offline/malformed responses are unknown outcomes, not proof that no persistent state changed.
- Client profile operations accept only the authenticated client's identity. Admin/native/browser scopes remain isolated; cookie writes require CSRF.
- Each new admin route calls `resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })` for state changes, then `requireAnyPermission` with a code present in `SEED_PERMISSIONS`, before parsing the body. CSRF applies to the cookie transport only. Nothing enforces this centrally, so each route needs a superadmin positive test and a `support` negative test. No send or edit guard lists `email_deliveries.read` or `email_deliveries.read_masked`.
- Never return or log password hashes, password-link tokens, OTPs, or plaintext queued credential payloads. Encrypt sensitive queued payloads with key-version metadata and remove them when no longer needed.
- Only the current active credential link may authorize redemption. Recheck account activity, email revision, credential revision, and set/reset purpose at redemption under a consistent lock order. Every successful password change/reset/set invalidates other outstanding links.
- Expired, consumed, superseded, wrong-address, or inactive-account security mail is cancelled before sending begins. Once SMTP sending has started, retain actual attempt/acceptance evidence; do not falsely label an accepted message cancelled or claim it can be recalled.
- Expired worker leases reconcile both the outbox and delivery projection. A stale worker cannot overwrite a newer claim; late SMTP evidence remains attributable to its actual send attempt.
- SMTP acceptance is not proof of inbox delivery. `queued`, `sending`, `sent` (transport accepted), `delivered` (provider evidence), and failure/cancellation remain distinct.
- Email transport is at-least-once. An ambiguous SMTP acceptance can cause a repeated message; do not promise exactly-once delivery. Account/token/ledger commands must still remain deduplicated.
- Portfolio values remain ledger-derived. Earlier investments increase principal and value equally; fund AUM and client-growth architecture walls remain intact.
- Changes to a current contact must not rewrite historical application, consent, audit, ledger, or delivery records.
- Approved feature implementation does not authorize real customer emails, VPS changes, migrations against a deployed database, or deployments.
- The application is in production. Every schema change follows `RULES.md` rule 11: expand first, compatible with the previous release, no loss or rewrite of existing rows. Anything destructive or lossy is a separate maintainer-approved design, not part of a feature step.
- Each step that adds a migration records in its handoff the pre-flight check of existing data, how the previous release behaves against the new schema, the backfill and in-flight state impact, and the rollback implication. It also ships a populated-upgrade integration test where existing rows are backfilled, constrained, or retyped. The step is not complete without them.
- New logic never replays or reinterprets history. Queued, `sending`, and already-sent mail is not re-sent, and existing receipts, tokens, sessions, ledger rows, and application rows keep their recorded meaning.
- New configuration appears in the tracked examples and compose passthrough and is listed in the handoff for the operator, because a deploy never overwrites a stack `.env`. A missing new key should disable only the feature that needs it, with an explicit unconfigured state, rather than stop the existing application from booting. Record any key where failing at boot is safer.

## 5. Dependency order

```text
1. Shared email presentation
   └─ 2. Durable email queue and critical recovery receipts
      ├─ 3. Password-link authority, queueing, and resend API
      │  └─ 4. Admin recovery/resend UX
      │     └─ 7. Earlier-investment onboarding integration
      ├─ 5. Contact ownership, profile, and phone editing
      │  └─ 6. Verified email change and session safety (also depends on 3)
      └─ 8. Admin template catalogue and custom-template editing
         └─ 9. Preview, recipient approval, and test/send actions (also depends on 5)

10. Integrated verification follows all completed steps.
```

Ten PR-sized implementation steps are proposed. The earlier-investment form can be prepared independently, but its complete onboarding integration depends on step 4; it is not an independent completed feature. Steps 3, 5, and 8 can otherwise progress after step 2, subject to shared-file coordination for contracts, runtime composition, permissions, and migration numbering. No agent team or parallel implementation is being started by this proposal. Intermediate PR completion does not authorize an intermediate production release.

## 6. Construction steps

### Step 1 — Shared professional emails and OTP presentation

Context: The SMTP transport already accepts HTML. Approval/rejection render in `emailTemplates.ts`; password and OTP messages are inline in route files. User requests 4 and 5 concern both copy and visual consistency.

Dependencies: none. Review emphasis: email rendering/input safety; otherwise standard implementation complexity.

Tasks:

1. Introduce one pure branded layout/renderer returning subject, plain text, and HTML. Use email-client-safe tables/inline CSS, a readable mobile layout, accessible contrast, and a text wordmark fallback rather than depending on images.
2. Centralize approval, rejection, password set, password reset, post-password app-download, and OTP copy. Personalize only with trusted, escaped fields; avoid inventing account or investment claims.
3. Use restrained BeOnEdge styling, clear action links/buttons, support details from configuration, and the agreed team sign-off.
4. Give OTP its own prominent, selectable code block, explicit case-sensitivity/expiry instructions, and a do-not-share warning. Do not change generation or verification behavior.
5. Forward HTML through `transactionalEmailSender.ts`, and use the same renderer in the existing direct-send OTP/password paths. Remove superseded inline email-body builders rather than retaining alternate versions.
6. Validate action URLs and header fields. Reject unsupported URL schemes/CRLF header injection and escape dynamic HTML text/attributes.

Primary files:

- `backend_controller/src/email/emailTemplates.ts`
- `backend_controller/src/email/transactionalEmailSender.ts`
- `backend_controller/src/routes/passwordRoutes.ts`
- `backend_controller/src/routes/clientEmailVerificationRoutes.ts`

Verification: backend typecheck/lint/check; update existing relevant email-template/sender tests only when this implementation intentionally invalidates their assertions. New tests are limited to meaningful rendering/security boundaries. Visual review uses synthetic preview data, not customer sends.

Exit criteria: Every requested transactional email has consistent HTML and text; OTP semantics are unchanged; no credentials appear in subjects/logs/previews; no duplicate inline template implementation remains.

Recovery: Before release, correct or withdraw the code change through a normal reviewed commit. No data migration or operational rollback is required by presentation alone.

### Step 2 — Durable email queue and critical recovery receipts

Context: The existing outbox/recipient encryption should be reused, but expired leases currently leave the delivery projection stuck in `sending`. Generic idempotency responses expire after 24 hours. These foundations need defined recovery before adding sensitive queued mail.

Dependencies: step 1. Review emphasis: strongest scrutiny for crash recovery, cancellation, and deduplication.

Tasks:

1. Add a narrow reusable enqueue operation that writes an outbox event and delivery projection in the caller's transaction. Support encrypted sensitive payloads and immutable template/content references; do not expose them through delivery-list APIs.
2. Define durable retention for client creation and recorded contributions in the existing `idempotency_records` schema/repository/protocol. Use an explicit current retention policy; do not add a second receipt store. Replays must still check actor, operation, key, and payload hash. Define safe expiry rejection for non-durable unresolved attempts rather than attempting an insert with an expired key.
3. Introduce a persisted send-attempt/lease-generation fence with attributable SMTP result evidence. Recover expired outbox and delivery state together; a stale worker cannot mutate a newer claim or discard late acceptance evidence.
4. Claim work just in time for each send instead of leasing an entire serial batch at once. Retain bounded pass limits and send budgets, so the last message in a batch does not start after its lease expires.
5. Define pre-send cancellation for pending/queued/retryable/claimed work. Once `sending` commits, preserve attempt evidence and use token revocation to remove authority rather than pretending an SMTP send can be cancelled safely.
6. Bound SMTP connection/greeting/socket waits and reconcile their worst-case send budget with the lease. Preserve send-outside-transaction behavior, suppression checks, and truthful acceptance/failure states.
7. Add terminal payload scrubbing, schema/types, environment validation and tracked example/compose passthrough changes where needed. Do not overwrite real `.env` files.

Primary files/areas:

- `backend_controller/src/domain/email/dispatchDueDeliveries.ts`
- `backend_controller/src/repositories/{emailDeliveryRepository,outboxRepository,idempotencyRepository}.ts`
- `backend_controller/src/http/idempotencyProtocol.ts`, `src/routes/adminRouteKit.ts`
- `backend_controller/src/email/emailSender.ts`, `src/crypto/context.ts`, `src/db/{types,repositories}.ts`
- `backend_controller/src/runtime/{environment,composition}.ts`, `db/migrations/`
- Tracked backend/stack env examples and dev/prod compose files

Verification: Minimal critical tests for atomic enqueue rollback; crash before/after the `sending` commit and SMTP acceptance; expired lease recovery; stale claimant settlement; cancellation races; suppression; and same-key/different-payload behavior past the 24-hour boundary. Extend existing email-delivery/idempotency coverage rather than adding a broad infrastructure suite.

Exit criteria: Queue work survives process crashes without false cancellation or lost acceptance evidence; credentials can be queued safely; durable critical receipts remain usable after the generic replay window; no stale worker overwrites a newer send attempt.

Production data notes: Add columns and tables only, with defaults, so existing outbox, delivery, and idempotency rows stay valid unchanged. Existing receipts keep their recorded expiry; only new creation and recorded-contribution receipts use the durable policy, and no existing idempotency row is purged or rewritten. Recovery and cancellation act only on attempts created after the migration (Q-010): a historical row stuck in `sending` or retryable may be real customer mail and is never re-sent or silently relabelled. Ship the migration's populated-upgrade test with representative outbox, delivery, and receipt rows.

Recovery: Fix forward using recorded attempt evidence and authorized cancellation of pre-send work. Do not restore a database or claim SMTP messages can be recalled.

### Step 3 — Password-link authority, queueing, and resend API

Context: Admin creation commits before a synchronous invite and public password routes send directly. Step 2 provides safe queue/recovery infrastructure. Tokens currently lack contact/credential binding and redemption-time checks.

Dependencies: step 2. Review emphasis: strongest scrutiny for password-link authority and transactional consistency.

Tasks:

1. Create the client, token, encrypted token payload, outbox event, delivery projection, and durable creation receipt atomically. Return promptly with a separate delivery ID/status rather than waiting for SMTP.
2. Add `POST /v1/admin/clients/{userId}/password-link`, protected by an idempotency key, cooldown, active-client checks, and explicit `clients.password_links.send` permission. Add restricted link/credential status to admin user details without token material. The eligible target is an account with `account_state = active` and no active `user_roles` row, because the schema has no client discriminator. The audit actor is the admin, not the target. The cooldown is per user and shared with the unauthenticated forgot route, so state the intended behavior (section 2F).
3. Derive set/reset purpose under lock. Bind every link to the email revision and credential revision/state at issuance. Attribute admin requests correctly; worker retries reuse the same issued token.
4. At redemption, recheck account activity, email revision, credential revision, purpose, expiry, consumption, and current password presence. A `set` token cannot replace an already-set credential and a stale reset token cannot overwrite a newer password.
5. Invalidate other outstanding links on every successful password set/reset/change, not only on resend or email change. Standardize user/credential/token lock ordering across issuance, redemption, and password changes; cover concurrent resend/redemption.
6. Cancel superseded pre-send link mail and add token/revision validity checks to worker preparation. Encrypt and scrub queued token material. Add no legacy unbound-token acceptance path in code; links issued before the binding migration are handled by the migration itself (Q-008).
7. Queue password set/reset-link and post-password download mail. Preserve forgot-password anti-enumeration and keep password redemption successful even if the separate download email is queued/unavailable.
8. Add an explicit canonical client password URL setting rather than using the first CORS origin. Reject missing/invalid invite URL configuration clearly before creating an unsendable account invite.
9. Coordinate backend contracts, generated operations/OpenAPI, reset-screen response handling, delivery filters, template-key database constraints, permissions, schema, and configuration examples/passthroughs.

Primary files/areas:

- `backend_controller/src/domain/admin/createClientAccount.ts`, `src/domain/auth/passwordCredential.ts`
- `backend_controller/src/routes/{adminClientOnboardingRoutes,passwordRoutes,adminIdentityRoutes}.ts`
- Password-token/user/email-delivery repositories, crypto context, runtime wiring, `src/db/types.ts`, permissions and migrations
- `packages/contracts/src/operations/{admin-oversight,client-web-auth}.ts`
- Frontend reset-password handling and email-delivery filters
- Tracked backend/stack env examples and dev/prod compose files

Verification: Targeted critical tests for create rollback/replay including retention beyond 24 hours; unauthorized resend; set/reset purpose; cooldown; bound-token expiry/supersession; password-change invalidation; inactive-account redemption; concurrent resend/redemption; ciphertext handling; and stale recipient/token dispatch. Preserve existing critical password and email-delivery coverage.

Exit criteria: Client creation does not wait for SMTP; a repeated create returns the same account; only a current, correctly purposed link can change an active client's password; issuing a link never changes the password itself; delivery state is honest.

Production data notes: Add the revision columns with defaults and the token binding columns nullable, and backfill the binding of unconsumed, unexpired tokens in the same migration (Q-008). Change no password hash, credential, or account state. Tokens the previous release issues during the deploy window carry no binding and are rejected by the new code; list that operator impact in the handoff. Add the new permission codes to the seed catalog and the frontend permission list; the seeded admin receives them (Q-007 in the decision record). If the template-key vocabulary widens, confirm the previous release's delivery list tolerates the new keys before the first write, or record the rollback limit. Validate the canonical password URL setting at link issuance, not at boot.

Recovery: Fix forward; retire unusable links and issue fresh authorized ones. Do not recreate users or restore removed synchronous-send/legacy-token paths.

### Step 4 — Admin creation recovery and resend controls

Context: The create screen currently has no retained operation key or resend action, and cannot know the user ID after a lost response. Step 3 supplies durable mail and an authorized resend endpoint.

Dependencies: step 3. Review emphasis: account identity, permission checks, and unknown-outcome handling.

Tasks:

1. Mint and retain the creation key plus the original immutable form values at the explicit submission boundary, outside the mutation function. Retain the attempt during an unknown outcome rather than creating a new one silently.
2. Replace "Nothing created" with accurate validation/conflict/unknown-outcome messaging. Replace "invite has been emailed" with actual queue/delivery state.
3. Provide recovery on timeout: a user-triggered retry with the original key/body resolves the durable creation receipt, then enables an explicit fresh password-link send. This remains recoverable beyond the ordinary 24-hour window. Handle in-progress work, retired/expired non-durable attempts, and cooldown without inventing a replacement creation key.
4. Add resend actions on creation success and user details. Show set/reset purpose, destination, cooldown, expiry, queue/failure state, and that a newer link replaces the earlier one.
5. Preserve a directory-based path to recover an existing account after leaving/reloading the create screen. Do not rely on a duplicate-identity error as proof that the original operation created that account.
6. Scope action visibility and execution to the new permission; invalidate the relevant user/email queries after accepted changes. Gate the controls in the component with `hasAnyPermission` once the code is in the frontend `PERMISSION_CODES`; `client-create` is already guarded by `clients.create`. The UI permission set updates only on reload or sign-in.

Primary files:

- `frontend_stack_ts/src/features/admin/users/{CreateClientScreen,UserDetailScreen}.tsx`
- `frontend_stack_ts/src/features/admin/shared/adminQueries.ts`
- `frontend_stack_ts/src/api/queryKeys.ts`
- Shared contract descriptors/generated operations from step 3

Verification: Critical regression coverage for retaining the same key/body after a transport timeout and permission-limited resend. One-shot frontend checks/builds. With separate permission for a running local stack, simulate a committed creation with a lost reply and verify recovery targets the same user.

Exit criteria: An admin can recover a timed-out create and deliberately send a replacement link without duplicate users or misleading success/failure claims.

Recovery: Stop further actions on an unknown result and recover/read the existing account; do not delete/recreate the user. Correct the UI through a reviewed forward change.

### Step 5 — Contact ownership, client profile, and phone editing

Context: Profile has no live contact API. Users and submitted/approved application rows currently reserve identifiers independently, so historical application records need to be distinguished from current ownership before editing contacts.

Dependencies: step 2. Review emphasis: authorization, identity uniqueness races, and current-password proof.

Tasks:

1. Add an authenticated client profile read and contact-details screen showing current email, phone, verification, and concurrency version. Use server data rather than cached principal details.
2. Define ownership precisely: existing users own their current stored identifiers; only submitted applications reserve pending identifiers. Exclude the current user from change-conflict probes and the current application when approving it. Normalize unchanged input to a no-op, not a self-conflict.
3. Update application conflict queries and partial unique indexes together so approved application history does not permanently reserve a replaced contact. Keep historical application/consent data intact.
4. Add consistent, ordered identity locks around public submission, approval, admin creation, and profile changes. Recheck ownership under those locks and retain database uniqueness as the final guard.
5. Allow active clients to update their phone after current-password confirmation, E.164/library validation, and final uniqueness checks. Recheck the verified credential revision before commit and queue a token-free notice to the current email.
6. Enforce authenticated-client-only targeting and CSRF on cookie writes. Add focused routes/contracts, profile queries, cache invalidation, runtime wiring, and schema changes. Do not claim SMS verification.

Primary files/areas:

- `frontend_stack_ts/src/features/profile/`, shared client queries, routing and query keys
- `backend_controller/src/domain/client/`, `src/domain/shared/`, focused profile routes and user repositories
- `src/repositories/applicationRepository.ts`, `src/domain/onboarding/submitApplication.ts`
- `src/domain/admin/{createClientAccount,decideApplication}.ts`, runtime composition, schema and migrations
- Focused `packages/contracts/src/operations/` client-profile descriptors

Verification: Minimal critical tests for cross-client/admin-scope denial, wrong/stale password, self/no-op changes, current-user duplicates, submitted-applicant duplicates, approved-user contact edits, released historical identifiers, and concurrent creation/contact changes.

Exit criteria: Clients can view/update their phone safely; pending ownership cannot race; approved application history stays immutable without falsely owning old contacts; phone is not labelled verified.

Production data notes: Replace the application partial unique indexes inside one migration transaction so uniqueness is never absent. The intended predicate is narrower (submitted only), so existing rows satisfy it; pre-flight any index that is not narrower and refuse rather than delete on a violation. Rewrite no application, consent, or user row. The populated-upgrade test includes approved applications whose users still hold, or have since changed, the same contact, and the handoff confirms how the previous release's submission and approval paths behave against the narrower indexes. This reshapes identity uniqueness on live data, so it is a major change under rule 11: record the migration design in the handoff for maintainer review.

Recovery: Correct an erroneous contact through a new authorized update; do not rewrite historical applications or restore the database.

### Step 6 — Verified email changes and session safety

Context: Email is the login identifier. Step 5 supplies profile/identity ownership; step 3 supplies bound password links. Both shared login engines verify credentials before acquiring their session-issuance lock, so they must recheck the verified address/revision too.

Dependencies: steps 3 and 5. Review emphasis: strongest scrutiny for account takeover and login/contact concurrency.

Tasks:

1. Require current-password confirmation and create an expiring pending email change bound to the client, target address, and current email/credential revisions. Keep the current address/login valid until the new address is verified.
2. Store challenge hashes and encrypted target/payload material, with one current pending request per client, expiry, attempt limits, and resend cooldown. Queue a distinct email-change verification message, not an ordinary already-verified-account OTP.
3. On confirmation, recheck challenge, credential, address revision, and final ownership under consistent locks. Atomically replace the email, apply verified status to the new address, invalidate old OTPs/password links/other pending changes, revoke all session channels, and queue token-free old/new-address notices.
4. In `webAuth.ts` and `nativeAuth.ts`, revalidate the originally verified normalized email and email revision under the session-issuance lock, in addition to the current password hash/account state. A login begun with the old email cannot create a new session after the change.
5. Ensure refresh/contact/password flows follow the same revocation and lock-order rules. Invalidate old-revision pre-send security mail; already-started mail retains truthful evidence but its old token has no authority.
6. Require sign-in with the new email after commit. Handle a lost confirmation reply as unknown: direct the client to sign in/check the new address, not to blindly replay another identity change.
7. Extend profile UI/contracts, pending-change persistence, verification/password repositories, email templates, runtime wiring, and relevant auth outcome types.

Primary files/areas:

- `backend_controller/src/domain/client/`, focused contact routes/pending-change repository and migration
- `backend_controller/src/domain/auth/{webAuth,nativeAuth,passwordCredential}.ts`
- User/email-verification/password-token/auth-session repositories and current email-revision schema
- Profile UI, shared queries/session transition handling, client-profile contracts, and email renderer

Verification: Minimal critical tests for wrong/expired/replayed challenge, stale credential/email revision, duplicate/concurrent target claims, old-mailbox OTP/password-link rejection, all-channel revocation, and the explicit interleaving "old-email login verified → email changed → old-email session issuance attempted" for cookie and bearer paths.

Exit criteria: The new email becomes the login identity only after proof; no old-session/token/in-flight login can reestablish access through the old address; current contacts and historical evidence remain distinct.

Production data notes: The pending-change table and any revision columns are additive. Replacing one user's email is an ordinary application write to that user's row, not a migration, and must not alter existing verification states, tokens, or historical records. Existing users start at the default revisions.

Recovery: Leave the old address untouched until verified commit. After commit, use a new authorized change or separately authorized support recovery; never automatically restore historical identity/credentials.

### Step 7 — Make earlier principal easy to record during onboarding

Context: The existing `recordContribution` path already implements user request 3 correctly. The missing part is discovery and integration into account onboarding, plus safe amount entry and retry handling.

Dependencies: steps 2 and 4 for durable financial receipts and the final creation-success integration. The reusable form itself can be prepared earlier. Review emphasis: financial integrity, precision, and duplicate writes.

Tasks:

1. Extract/reuse one earlier-investment form from `ClientPositionDetailScreen.tsx`; do not duplicate the domain command, ledger model, or API.
2. Add a clear "Record earlier investment" action on client creation success and user details, with the client preselected. Approved applications should provide a path to the created user's details rather than requiring the admin to find the account again.
3. Keep the recording step optional and separate from account creation. Support users with no existing position and users whose email verification is still pending.
4. Accept INR/rupee input and convert the decimal text exactly to integer paise using string/BigInt arithmetic with database-range checks. Do not use floating-point rupee conversion for a financial write.
5. Enforce real calendar dates, non-future investment dates, positive amounts, and PostgreSQL signed-bigint bounds on the backend as well as the form. Require a fund/audit reason and show a confirmation that this records prior money, not a new charge or growth.
6. Retain one key/body for the same explicit contribution attempt and use the durable retention policy from step 2. Verify recovery beyond the generic 24-hour window; never mint a fresh key to resolve an unknown write. After success, start a new attempt only through an explicit new action.
7. Refresh user orders, ledger/positions, and relevant admin queries. Preserve the existing dated ledger contribution, audit, notification, and correction-by-reversal behavior.
8. Keep `client_position.write` as the financial authority. Client-creation or growth-only permissions must not silently grant principal-recording access. Gate the embedded actions on `CreateClientScreen`, `UserDetailScreen`, and `ApplicationDetailScreen` with `hasAnyPermission(["client_position.write"])`.

Primary files:

- `frontend_stack_ts/src/features/admin/client-values/ClientPositionDetailScreen.tsx` and a shared earlier-investment form
- `frontend_stack_ts/src/features/admin/users/{CreateClientScreen,UserDetailScreen}.tsx`
- `frontend_stack_ts/src/features/admin/applications/ApplicationDetailScreen.tsx`
- `frontend_stack_ts/src/features/admin/shared/adminQueries.ts`, `src/domain/money.ts`
- Existing `backend_controller/src/routes/adminClientPositionRoutes.ts` and critical recorded-contribution coverage only where targeted validation/coverage is missing

Verification: Protect exact decimal-to-paise conversion, server-side range/calendar rejection, same-key retry/double-submit including after 24 hours, principal-versus-growth accounting, all-or-nothing persistence, permission denial, no provider attempt/charge, and historical statement placement. The existing `domain/admin/recordContribution.test.ts` is a starting point; add PostgreSQL-backed critical coverage only where not already protected.

Exit criteria: Admins can record original prior principal directly after onboarding or from a user's details; principal/value increase equally, existing growth stays separate, and a retry cannot duplicate the contribution.

Recovery: Use the existing authorized append-only reversal for an incorrect contribution. Never delete ledger rows, change stored balances, or issue a provider refund for an offline record.

### Step 8 — Admin template catalogue and custom-template editing

Context: Admin Emails has no template management. Step 1 provides the layout and step 2 provides immutable queue content. This step defines safe editable templates without granting send or authentication-token authority.

Dependencies: step 2. Review emphasis: edit permissions, safe input, and immutable revisions.

Tasks:

1. Preload welcome note, account update, support follow-up, education reminder, and general team-message templates with the agreed sign-off.
2. Add minimal template/revision persistence, optimistic concurrency, and authorized create/edit/archive actions for subject/body/allowlisted placeholders inside the branded layout. No arbitrary HTML editor.
3. Keep password/OTP templates source-controlled and non-editable/non-token-issuing through this feature. Historic revisions are audit data, not old code/API branches.
4. Define the immutable revision/content selected for each later send. Add catalogue endpoints/contracts, permission seeds, runtime wiring, management UI/navigation, and validated catalogue-driven delivery filters.

Primary areas: `frontend_stack_ts/src/features/admin/emails/`, admin routing/queries; backend email renderer, focused template routes/repository, schema/permissions/migrations; admin email contracts and existing delivery filters.

Verification: Critical coverage for unauthorized edits, header/script injection, unsupported placeholders, auth-template customization denial, and immutable revision selection. No new routine CRUD or cosmetic rendering tests.

Exit criteria: Authorized admins can manage safe custom templates and choose preloaded templates; modifying a template does not alter an already selected immutable revision or grant send authority.

Production data notes: Template and revision tables are additive; the new permission codes are added to the seed catalog and the frontend permission list (Q-007 in the decision record). Do not rewrite template keys on existing delivery rows. If delivery filters or response schemas gain new template keys, confirm the previous release's delivery list tolerates rows with those keys before the first write (the enum-extension lesson in `release_manager/docs/existing-client-impl/06-sequencing-and-migrations.md`), or record the rollback limit.

Recovery: Archive a problematic template and create a corrected revision. Keep historical records intact.

### Step 9 — Preview, recipient approval, and explicit test/send actions

Context: Step 8 supplies templates; step 2 supplies queueing; step 5 supplies current contact ownership. Previewing must not send, and selecting a client must not permit recipient tampering or stale-contact substitution.

Dependencies: steps 5 and 8. Review emphasis: send authorization, recipient privacy, preview safety, and delivery evidence.

Tasks:

1. Provide HTML/text preview with clearly marked synthetic samples. Escape dynamic fields and sandbox HTML without scripts/top-level navigation; previews contain no live OTP/password link.
2. Resolve the chosen existing client's address on the backend and bind the approved preview to its contact revision and template revision. Recheck at enqueue/dispatch; cancel before sending or require a new approval if either changed, rather than silently substituting data.
3. Provide distinct "Send test" and "Send to client" actions with recipient/content confirmation. Test mail is visibly marked. Neither preview nor opening the screen triggers delivery.
4. Enforce dedicated send authority, CSRF, cooldown/rate limits, operation keys, and admin audit attribution. Masked/read-only permissions do not grant send authority. Define expired-attempt reconciliation; do not retry an unresolved send with a new key automatically.
5. Queue through the existing outbox with encrypted recipient/sensitive payload handling, suppression checks, immutable content, and links to the delivery log. Update contracts, generated operations, queries and navigation. No bulk/scheduled/synchronous alternate sender.

Primary areas: admin email UI/queries; focused backend admin email routes/domain command; delivery/outbox repositories; template/recipient revision checks; admin email operation descriptors and runtime wiring.

Verification: Critical tests for denied sends, recipient tampering, preview-without-send, same-key replay/expiry handling, suppressed/stale contacts, changed template revisions, and accurate acceptance/failure evidence. Use synthetic accounts/local capture only with appropriate permission.

Exit criteria: An authorized admin can preview and explicitly test/send a preloaded or custom message to a chosen client; read-only access cannot send; no auth token is created/exposed; the delivery log is truthful.

Recovery: Cancel pending mail before the sending boundary or archive/correct its template. Already-started/accepted mail cannot be recalled; retain actual attempt evidence and history.

### Step 10 — Integrated verification and maintainer handoff

Context: Backend routes and shared contract descriptors are maintained separately, and frontend builds consume compiled contracts. Integration must prove both targets and critical state changes rather than only presentation.

Dependencies: all other steps. Review emphasis: cross-flow correctness and accurate verification claims.

Planned one-shot commands, run from the named package after implementation:

- `packages/contracts/`: `npm run check` (includes build, export checks, generation drift, OpenAPI lint, and frontend bypass guard).
- `backend_controller/`: `npm run check` and `npm run test:integration` where a local test container runtime is available.
- `frontend_stack_ts/`: `npm run check`, `npm run build:client`, and `npm run build:admin`.

Acceptance scenarios:

1. Create an admin-onboarded client with a stalled/failing mail transport; account creation responds without waiting for SMTP and reports queued/failed delivery accurately.
2. Lose the create response after commit, recover with the same key both promptly and after the generic replay window, resend after cooldown, and set the password using only the newest valid link. Verify only one client exists. Changing the password invalidates older links as well.
3. Verify the client email, request a new email, confirm it, and sign in using the new address. Old sessions, OTPs, password links, and a concurrently completing old-email login cannot reestablish access. Approved application history remains unchanged without reserving released contacts.
4. Update the phone using password confirmation; reject another user's/pending applicant's phone and do not claim SMS verification.
5. Record an earlier investment for an admin-created, zero-position client. The historical statement/order/ledger reflects principal, not growth; replay even after 24 hours does not add a second record/charge. Impossible dates and out-of-range amounts are rejected authoritatively.
6. Review every email's HTML and text using synthetic data/local capture. OTP retains exactly its configured semantics.
7. Preview a preloaded/custom message without sending; explicitly test/send, then verify enqueue, failure/acceptance evidence, template revision, masking, and denied read-only access.
8. Simulate email-worker crashes and expired leases before/after SMTP. Both state machines recover together, stale workers cannot overwrite current claims, late acceptance evidence is retained, and repeated transport delivery does not duplicate account/ledger state.
9. Populated upgrade: apply every new migration to a disposable database first migrated to the current production schema and seeded with representative users, applications, password tokens, deliveries, idempotency receipts, and ledger rows. Nothing is lost or rewritten, no historical mail is re-queued, and the handoff states how the previous release behaves against the migrated schema.
10. Seed grants: on the dev stack, `GET /v1/admin/session` for the seeded admin lists every new permission code. The operator first checks `SEED_AUTH_ENABLED` and `SEED_AUTH_ALLOW_PRODUCTION` on each stack (Q-012).

Browser checks should cover client/admin route navigation, form labels/focus/errors, disabled/cooldown states, mobile sizing, and explicit confirmations. Existing UI primitives/recipes and WCAG 2.2 AA requirements apply.

Separate explicit permission is required before starting a persistent local stack/mail-capture worker, emulator/Gradle run, real SMTP send, or any VPS operation. Use local synthetic accounts for verification; do not test-send to real customers by default.

Exit criteria: All requested outcomes pass relevant static/critical checks and authorized runtime scenarios. Report exactly what ran and what remains unverified. No release, push, deployed migration, or customer send happens merely because implementation is complete.

## 7. Plan changes and approval gate

- The maintainer approved implementation of the six outcomes on 2026-10-08 (Q-001 in the decision record). The section 3 defaults stand as conservative proposals, and Q-002 to Q-004 stay open: changing those defaults changes scope.
- Any request for SMS verification, bulk sends, arbitrary HTML editing, or importing growth as principal changes scope and must be agreed explicitly.
- If a step needs splitting, preserve its prerequisites and acceptance criteria; update this document before moving on.
- If shared contracts/schema change, update both API and frontend in the same coordinated step. Keep an old endpoint, field, or schema path only where a released client or the previous release needs it (`RULES.md` rule 11), and record its removal condition here.
- Capture any unresolved production delivery/configuration facts as unverified; request permission for live diagnosis rather than guessing or editing VPS configuration.

## 8. Progress and handoff

Each step records here what changed, the exact verification (commands and counts), corrected beliefs, remaining risks, and what is unverified. Commits are referenced only after they exist.

| Step | Status |
| --- | --- |
| 1. Shared professional emails and OTP presentation | Done and committed; not deployed. Details below |
| 2a. Durable creation and contribution receipts (step 2, task 2) | Done and committed; not deployed. Details below |
| 2b. Durable email queue: enqueue, lease fencing, recovery, cancellation, SMTP timeouts (step 2, tasks 1 and 3 to 7) | Not started |
| 3 to 10 | Not started |

### Step 1 handoff (2026-10-08)

Changed, backend only, with no schema, API, or configuration change. One pure renderer, `renderEmail` in `email/emailLayout.ts`, returns subject, plain text, and HTML. `email/emailValidation.ts` holds the HTML escaping, the CR/LF header guard, the http/https-only action-URL guard, and the plain-address check for the support line. `email/emailTemplates.ts` holds the copy for approval, rejection, password set, password reset, app download, and the email-verification code. The outbox adapter and the SMTP sender now carry the HTML body, and the inline body builders in `passwordRoutes.ts` and `clientEmailVerificationRoutes.ts` are gone. The `SUPPORT_EMAIL` setting that only outbox mail used now reaches the password and code mail too. Template keys and stored payload shapes are unchanged, so queued rows still render. A preparatory refactor moved the worker compositions out of `runtime/composition.ts`, which was 963 lines, into `runtime/workerComposition.ts` and `runtime/paymentGatewaySelection.ts`; `composition.ts` is now 703 lines.

Verified (TESTED): `npm run check` in `backend_controller/` exits 0 with 86 test files and 935 tests (34 added), coverage 84.94% statements, 83.74% branches, and 91.39% functions against an 80% threshold, plus the build and both boot smokes (`smoke:source`, `smoke:dist`). The refactor was verified alone on its staged tree: typecheck, lint, 84 files and 901 tests, build, and both smokes. The worker block moved byte-identical to HEAD. The implementing agent showed each new guard failing with its fix undone (escaping, http/https only, whitespace and control characters in URLs, CR/LF in headers and recipients, support-address validation, OTP expiry and wording and case-sensitivity text, no code or link in a subject); those controls were not repeated. STATIC: every text color has at least 5.3:1 contrast, every table has `role="presentation"`, `lang="en"` is set, and there are no images, scripts, or comments in the HTML. Previews rendered from synthetic data are in `.agents/tasks/step1-preview/` (git-ignored).

Not verified (UNVERIFIED): `npm run test:integration` (needs the container runtime, rule 3), the `test_e2e` Mailpit scripts, real mail clients (Gmail, Outlook, Apple Mail, dark mode, mobile), and real SMTP. The deployed `SUPPORT_EMAIL` value was not read; the tracked stack examples set `support@beonedge.in`.

Corrected beliefs: the plan said the old OTP mail covered attempts and cooldown; it said only the six-character, case-sensitive code and its expiry, and that content is kept. `dispatchDueDeliveries.ts` does not render mail; the outbox adapter does. A support contact already existed in configuration.

For the maintainer to review:

- A stored approval whose `downloadUrl` is not an http or https URL now dead-letters with `EMAIL_ACTION_URL_INVALID` instead of sending without the link. The producer emits only https URLs from two fixed bases, so no legitimate row is affected. The alternative is to send the approval without the link.
- A `SUPPORT_EMAIL` that is not a plain address renders no support line.
- Copy changed: the approval and app-download subjects, "immediately" and the em dashes are gone, links sit behind a button with a fallback URL, expiry reads "N minutes" or "N seconds", and there is no greeting because no name is available. The rejection line "nothing has been charged" was already in the old copy and has not been verified.

Remaining risks: stale comments remain in `email/ports.ts` and in the header of `transactionalEmailSender.ts`; they were left alone under rule 9. The `from` address is not CR/LF-checked because it comes from configuration, and failing it would dead-letter queued mail.

### Step 2a handoff (2026-10-08)

Changed, backend only, with no migration and no contract change. Client creation and recorded contributions pass `retention: "durable"` to `runAdminMutation`, which stores their receipt with the fixed expiry `9999-12-31T00:00:00.000Z` instead of now plus the TTL. `idempotency_records.expires_at` is `timestamptz NOT NULL` (migration 012), `findCompleted` is the only reader of it, and the repository has no `DELETE`, so nothing purges receipts. The previous release only checks `expires_at > now`, so it replays a durable row and rejects a different body on the same key; rolling back is safe. Every `runAdminMutation` caller also answers a reused key whose receipt has expired with the existing 409 `IDEMPOTENCY_KEY_REUSED` (a specific message, `retryable: false`), checked before the lock and before the mutation runs. Public signup, client orders and SIPs, and the application decision call `executeIdempotent` directly and are unchanged, because `/newuser` derives its key from applicant content and a repeat after 24 hours is a normal path there.

Verified (TESTED): `npm run check` in `backend_controller/` exits 0 with 87 test files and 951 tests (16 added), coverage 84.96% statements, 83.92% branches, and 91.42% functions, plus the build and both boot smokes. Each new guard was shown failing with its fix undone: durable ignored, expiry guard removed, retention removed from either route, durable made the default, request-hash comparison neutralised, a token added to the stored body, and the guard applied to every caller. UNVERIFIED: the SQL of `hasExpiredRecord` and the insert of the 9999 value against real PostgreSQL. The new tests use an in-memory repository that models the SQL, and no container was started (rule 3). The existing integration tests that touch the store are `database`, `adminFundCatalog`, `adminAum`, `adminMandate`, and `maturitySettlement` under `test/integration/`; run them with `cd backend_controller && npm run test:integration`.

Corrected beliefs: a retry of an expired key did not execute the mutation twice. The re-run happened inside the transaction, hit `idempotency_records_scope_uk`, surfaced as a 500, and rolled back, so no duplicate was committed. It would become a real duplicate if a purge were ever added. The 24-hour value is only the code default (`IDEMPOTENCY_TTL_MS`); the deployed value is unverified. The creation receipt holds only the user id, account state, and verification state, and the invite token is never stored, so a replay does not re-send the mail.

For the maintainer: other money or identity operations still use the 24-hour window and now return the 409 on an expired key. They are ledger reversal, maturity mark, withdrawal, reinvestment, and payout status, fund receipt acknowledgement and refund retry and reconcile, mandate cancel and reconcile, fund AUM writes, and user suspend, reinstate, and close. Decide which of them should become durable. Client growth keeps its own inline copy of the protocol, and its receipts are referenced by a foreign key. If a purge of ordinary receipts is ever added, it removes this rejection for them; durable rows are excluded automatically.

For step 4: the admin UI maps `IDEMPOTENCY_KEY_REUSED` to "Give it a moment" (`frontend_stack_ts/src/domain/failure.ts:72`), which will mislead on this 409. The UI must resolve an unknown outcome by reading current state with the original key, never by minting a new one.
