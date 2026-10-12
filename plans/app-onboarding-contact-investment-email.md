# BeOnEdge app: onboarding, contact details, earlier investments, and email

Status: **Approved for implementation by the maintainer on 2026-10-08, in dependency order. Steps 1, 2a, 2b, and 2c are done and committed (section 8). Steps 3 (three verified slices) to 11 are done; step 10's handoff lists what the maintainer still checks and configures before releasing v0.15.0. Since 2026-10-11 the remaining steps are implemented by a single maintainer-assisted session after the coding agent's limit ran out. All plan work ships together as v0.15.0 (release decision, 2026-10-11). Q-002, Q-003, Q-004, Q-011, Q-012, Q-015, and Q-016 are answered (decision record). Q-013 stays out of scope, and Q-017 is open without gating a step.**

Prepared: 2026-10-08. Investigation is source-level only; no production diagnosis, test runs, builds, mail sends, or deployments were performed. Since then only the admin authorization and seeding claims have been checked against source (section 2F). Every other claim in section 2 is unverified, and each step verifies the claims it depends on before it changes code.

Governing process: root [RULES.md](../RULES.md). The maintainer requested rulebook
consolidation before implementation; that is done, and implementation is approved (see the decision record). The maintainer
confirmed on 2026-10-08 that the application is in production, so every schema change
in this plan follows `RULES.md` rule 11 (expand first, no loss of existing data).

## 0a. Open questions and conservative defaults

IDs are stable and are not reused. These are proposal defaults, not permission to
move funds, change identity authority, send customer mail, or deploy.

| ID | Open decision | Conservative behavior meanwhile |
| --- | --- | --- |
| Q-013 | Self-protection for the sole admin, which can suspend or close its own account with no in-app or seed recovery | Out of scope for this plan, as the maintainer confirmed on 2026-10-11; no change. Steps 3 and 4 add actions to the same screen and must not make this worse. |
| Q-017 | Whether admin-created invites and reset links need a longer lifetime than the 10-minute email-code default they share (`EMAIL_VERIFICATION_CODE_TTL_MS`). Once step 3b queues link mail, a message retried past its link's expiry is cancelled unsent by the worker's validity check (step 3 task 6), and the client requests a new link | No change: the lifetime stays at the shared setting and nothing new is configured. |
| Q-018 | How many current-password checks a signed-in client may make, and over what window, across the phone change, the email change, and the password change | Five per client in a fixed 15-minute window, shared by the three endpoints and kept in the backend process's memory (it resets when the backend restarts). The sixth answers 429 `RATE_LIMITED` before the password is checked. Chosen on 2026-10-12 when the maintainer asked for the fix; sign-in itself stays on nginx's 5 requests a minute per address. |

### Decision record

| Date | Maintainer decision | Status |
| --- | --- | --- |
| 2026-10-08 | Consolidate the supplied rulebook and this repo's rules into one root `RULES.md`, adapt it to BeOnEdge, and enforce it through agent entrypoints. | Documentation change; not approval to implement app features. |
| 2026-10-08 | The application is in production. Replace the pre-production forward-only development rule with a production data-safety and compatibility rule: major database changes must be thoughtful and must not lose user data. | Applied in `RULES.md` rule 11 (with rules 10 and 16, verification boundaries, and document upkeep), `README.md`, `AGENTS.md`, `DEPLOY.md`, and `release_manager/README.md`. This plan updated in sections 0a, 4, 6, and 7. Not approval to implement app features. |
| 2026-10-08 | Q-007 answered: the application has exactly one admin account, seeded from the stack `.env`, and it holds every role. This stays. No per-role permission design is needed. | Source check: `seedAuth.ts` grants the `superadmin` role every code in `SEED_PERMISSIONS` and assigns it to the seeded admin, `requireAnyPermission` has no bypass, and no code assigns any other role. A new permission code is added to `seedCatalog.ts` and the frontend `permissions.ts`, and reaches the admin through the seed step that runs after `migrate`. The earlier proposed default (grant none) is withdrawn because it contradicted that mechanism. New codes are inserted by every seed run but granted to the admin only when `SEED_AUTH_ENABLED` is not exactly `false` and, under `NODE_ENV=production`, `SEED_AUTH_ALLOW_PRODUCTION` is exactly `true` (`seedAuth.ts:70-71,181`). Compose defaults both to true. A skipped grant exits 0, and neither the deploy preflight nor the health check notices. The real `.env` was not read, so the operator confirms the values on dev and then prod before relying on a new code (Q-012; the maintainer reported the production values on 2026-10-11, in the row below). |
| 2026-10-08 | Q-009 answered: older APKs are in use. The maintainer exports and redeploys in a scheduled maintenance period, dev stack first and then production with a maintenance notice, and handles that timing. Build and implement without waiting on it. | Not a decision to break released clients: API changes stay additive unless the maintainer raises `minimumSupportedVersion`. |
| 2026-10-08 | Q-001 answered: build and implement the plan ("all clear to build and implement"), and plan and implement any gap found along the way. | Implementation proceeds in dependency order, one commit per step. This did not answer Q-002 to Q-004, which gated steps 5, 7, 8, and 9 until the 2026-10-11 rows below answered them. |
| 2026-10-08 | Q-005 answered: commits are authored as `tamagami-hi <193059379+tamagami-hi@users.noreply.github.com>` from the global Git configuration. | The repo-local `user.name = nethunter07` override was removed on the maintainer's instruction. The effective author and committer were verified before the first commit. |
| 2026-10-08 | Q-006, Q-008, and Q-010 answered: because the app is live, make non-destructive changes. | Each migration stays compatible with the previous release, and the maintainer chooses the release cut (Q-006; decided on 2026-10-11, see the release decision row below). Password links issued before the binding migration are backfilled so they keep working, with no legacy-token path in code (Q-008). Outbox and delivery rows already in the database are left as recorded and never re-sent (Q-010). |
| 2026-10-08 | The maintainer ruled that source code, not documents, is the source of truth, and authorized planning and implementing any gap found while checking the plan against source. | A six-way source audit was started and stopped for cost after one report finished (admin authorization and seeding, section 2F). Every other claim in section 2 is unverified; each step verifies the claims it depends on against the files it edits and records corrections in section 8. Gap work stays inside `RULES.md` (no fund movement, real sends, or deployment). |
| 2026-10-11 | Q-014 answered: the admin mandate cancel route keeps inserting the queued cancel command in its local-cancel branch, and `adminMandateRoutes.ts` does not change. Skipping the command would break the strict `{ commandId, state }` success response (`packages/contracts/src/operations/admin-money.ts:677`) that released admin APKs consume. | The local-cancel test asserts the queued row. The row's later `accepted` state and the `cancelCommandsDispatched` count are recorded as a finding in section 8. |
| 2026-10-11 | Q-002 answered (steps 5 and 6): phone changes use current-password confirmation only. Validate the number as E.164, check uniqueness under lock, save it, show it as "not verified", and queue a token-free notice to the current email. There is no SMS provider and no SMS verification; adding one later is a separate scope decision. | Step 5 task 5 already says this and step 5 task 6 forbids claiming SMS verification. The gate on steps 5 and 6 is lifted; neither has started. |
| 2026-10-11 | Q-003 answered (step 7): approved as planned. Recording an earlier investment is an optional step, separate from account creation, through the existing `recordContribution` path. Each entry is one fund, with the original principal in rupees converted exactly to integer paise, a real non-future investment date, a required reason, and a confirmation that it records past money and not a new charge or growth. It is reachable from creation success, user details, and approved applications, and is gated by `client_position.write`. | The gate on step 7 is lifted. Step 7 still depends on steps 2 and 4 as written, and has not started. |
| 2026-10-11 | Q-004 answered (steps 8 and 9): admins edit the subject and the plain body text, with an allowlisted set of placeholders, inside the fixed branded layout, and there is no HTML editing. A send goes to one existing client chosen for that send, plus a clearly marked test send to the admin. There are no bulk, batch, or scheduled sends. Password and OTP templates stay source-controlled and cannot be edited. | The gate on steps 8 and 9 is lifted; neither has started. |
| 2026-10-11 | Q-011 answered: the permission codes are `clients.password_links.send` (step 3), `email_templates.write` (step 8), and `email_messages.send` (step 9, covering both the test send and the send to a client). Each is added to `seedCatalog.ts` and the frontend `permissions.ts` in the step that first enforces it. | The single superadmin receives every catalog code (Q-007), so a dedicated code widens nobody's access. |
| 2026-10-11 | Q-012 answered: production has `SEED_AUTH_ENABLED=true`, `SEED_AUTH_ALLOW_PRODUCTION=true`, and `SEED_AUTH_OVERWRITE=false`. New catalog codes are granted to the superadmin on every seed run (`seedAuth.ts:224-238`), and the overwrite flag only governs replacing an existing password hash (`seedAuth.ts:127-131`). `seedAuth.ts` stays unchanged. | Reported by the maintainer; the real `.env` was not read. The dev stack's values are not yet confirmed (the maintainer's 2026-10-11 note left that choice unfilled); the maintainer confirms them before a new code is relied on there. |
| 2026-10-11 | Order after step 2c: step 3, then step 4, each as a separate bounded run with a report after it. Steps 5 to 9 follow in plan dependency order. | Step 3 is split into three verified slices, each its own commit (3a token binding and redemption safety, 3b queued link mail and configuration, 3c the admin resend API, permission, and frontend contract handling). The admin resend and recovery UI is step 4. |
| 2026-10-11 | Q-015 answered: accept the default. Do not rotate `CRYPTO_RECIPIENT_ENC_KEY` while sealed mail is queued, and add no new key or keyring. | The drain-then-rotate procedure is added to `DEPLOY.md` in the first step 3 commit. |
| 2026-10-11 | Q-016 answered. (a) In step 3, the worker's missing-or-erased-recipient branch cancels the delivery together with the outbox row, through the existing `cancelUnsent` fence, so the delivery log is honest. (b) No reaper for sealed rows frozen in `sending`; the operator's `sending` count query in the step 2b handoff covers them. | (a) is built in slice 3b. (b) changes nothing. |
| 2026-10-11 | Release decision: all plan work ships together as one release, v0.15.0, with no intermediate release to dev or production. "Previous release" means the deployed v0.14.7 (`169d1be`), and deploy-window analyses compare the v0.15.0 state with it. No code path, migration branch, or test exists only to handle data a partial build could create, because no partial build is deployed. Released clients are the APKs up to v0.14.7, so API changes stay additive against the v0.14.7 contracts. Migrations 052 onward are applied together in one `migrate` run at the v0.15.0 deploy. Step 10 adds one combined populated-upgrade test (see step 10). The maintainer cuts v0.15.0 through `release_manager` after step 10; no step bumps `VERSION` or touches the release tooling. | Settles the release cut that Q-006 left to the maintainer. Handoff wording that implied an intermediate deployed state was corrected in the same commit. |
| 2026-10-11 | No rollback to v0.14.7, and forward development is allowed. The maintainer wrote: "feel free to develop forward just make sure not to lose the current user data. i won't be rolling back to 0.14.7." This is an explicit override of the part of `RULES.md` rule 11 that requires the previous release (the rollback target) to keep working against what a change ships, scoped to the v0.15.0 work. v0.14.7 is therefore not a rollback target: no rollback analysis, registered rollback boundary, or v0.14.7-compatible design is required, and a migration may be non-additive when it preserves the data. Not overridden: rule 11's protection of current data (no loss, corruption, or silent rewrite of customer, financial, consent, audit, application, delivery, token, receipt, or other in-flight records; pre-flight checks and refusal instead of deletion; idempotent backfills; populated-upgrade tests), released APK clients up to v0.14.7 still working against the new backend, and the deploy-window analysis of the old backend serving between `migrate` and the new backend starting. | `RULES.md` itself is unchanged; this row records the scoped override. The v0.14.7-statement run in step 10's combined upgrade test and the v0.14.7 tolerance checks that steps 3 and 8 asked for are no longer required. The coding agent for slice 3a was told the same day. |
| 2026-10-11 | New client and admin APKs are released with v0.15.0, so the APKs up to v0.14.7 are no longer a compatibility constraint. The maintainer wrote: "new apk's will be released as well so the old apk is not a concern." This overrides, for the v0.15.0 work, the part of the earlier no-rollback row that kept released APK clients up to v0.14.7 working against the new backend, and `RULES.md` rule 11's released-client bullet. | API request and response shapes, enum values, and error codes may change where that makes the feature honest or simpler, with the backend, contracts, generated operations, and frontend changed together. Still required: no loss or silent rewrite of current data, populated-upgrade tests, and the deploy-window analysis. An old APK still installed will call the new backend until it is updated, so the maintainer raises `minimumSupportedVersion` in the published app configuration with the release (recommended in the handoff, not done here). `RULES.md` is unchanged. |
| 2026-10-12 | The maintainer asked for (a) the backend's update prompt to do the job of moving clients to the new release, with a special message saying the update is required, and (b) a maintenance page served, and users notified, whenever an update is pushed to the server. Added as step 11, inside v0.15.0. This also lifts the earlier "no step touches the release tooling" line for the maintenance flag, the bundled page, and the nginx site configs. | Built in step 11. Old APKs keep their own "Update required" screen, so `GET /v1/app/update` keeps its exact shape. |
| 2026-10-12 | The maintainer gave access to the VPS (`ssh beonedge`, stacks under `/srv/dev_stack/BOE_APP/`) to develop against the deployed layout. | Used read-only: directory listings and the nginx site configs. No `.env` value was read, nothing was changed, restarted, or deployed, and rule 2 still governs any change there. |

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

These defaults are proposals, except where the decision record says otherwise: the phone change (Q-002), earlier-investment entry (Q-003), and custom templates and recipients (Q-004) were decided on 2026-10-11.

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
- The application is in production. Every schema change follows `RULES.md` rule 11 as scoped by the 2026-10-11 decisions: no loss, corruption, or silent rewrite of existing rows, with a pre-flight check and refusal instead of deletion. v0.14.7 is not a rollback target, so a schema need not stay compatible with it and forward changes that preserve the data are allowed; the old backend serving during the deploy window is still analysed. Anything that would lose data remains a separate maintainer-approved design, not part of a feature step.
- Each step that adds a migration records in its handoff the pre-flight check of existing data, the backfill and in-flight state impact, and the deploy-window effect (the old backend keeps serving until the new one starts). It needs no rollback analysis, because v0.14.7 is not a rollback target (2026-10-11). It also ships a populated-upgrade integration test where existing rows are backfilled, constrained, or retyped. The step is not complete without them.
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

Ten PR-sized implementation steps are proposed. The earlier-investment form can be prepared independently, but its complete onboarding integration depends on step 4; it is not an independent completed feature. Steps 3, 5, and 8 can otherwise progress after step 2, subject to shared-file coordination for contracts, runtime composition, permissions, and migration numbering. No agent team or parallel implementation is being started by this proposal. All steps ship together as v0.15.0 (release decision, 2026-10-11); no step is released on its own.

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
10. In the worker's missing-or-erased-recipient branch, cancel the delivery together with the outbox row through the existing `cancelUnsent` fence, so the delivery log is honest (Q-016, 2026-10-11).

Primary files/areas:

- `backend_controller/src/domain/admin/createClientAccount.ts`, `src/domain/auth/passwordCredential.ts`
- `backend_controller/src/routes/{adminClientOnboardingRoutes,passwordRoutes,adminIdentityRoutes}.ts`
- Password-token/user/email-delivery repositories, crypto context, runtime wiring, `src/db/types.ts`, permissions and migrations
- `packages/contracts/src/operations/{admin-oversight,client-web-auth}.ts`
- Frontend reset-password handling and email-delivery filters
- Tracked backend/stack env examples and dev/prod compose files

Verification: Targeted critical tests for create rollback/replay including retention beyond 24 hours; unauthorized resend; set/reset purpose; cooldown; bound-token expiry/supersession; password-change invalidation; inactive-account redemption; concurrent resend/redemption; ciphertext handling; and stale recipient/token dispatch. Preserve existing critical password and email-delivery coverage.

Exit criteria: Client creation does not wait for SMTP; a repeated create returns the same account; only a current, correctly purposed link can change an active client's password; issuing a link never changes the password itself; delivery state is honest.

Production data notes: Add the revision columns with defaults and the token binding columns nullable, and backfill the binding of unconsumed, unexpired tokens in the same migration (Q-008). Change no password hash, credential, or account state. Tokens the previous release issues during the deploy window carry no binding and are rejected by the new code; list that operator impact in the handoff. Add the new permission codes to the seed catalog and the frontend permission list; the seeded admin receives them (Q-007 in the decision record). If the template-key vocabulary widens, confirm that released admin clients (APKs up to v0.14.7) tolerate the new keys in the delivery list. The backend's own tolerance is not a constraint, because v0.14.7 is not a rollback target (2026-10-11). Validate the canonical password URL setting at link issuance, not at boot.

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

Production data notes: Template and revision tables are additive; the new permission codes are added to the seed catalog and the frontend permission list (Q-007 in the decision record). Do not rewrite template keys on existing delivery rows. If delivery filters or response schemas gain new template keys, confirm that released admin clients (APKs up to v0.14.7) tolerate rows with those keys (the enum-extension lesson in `release_manager/docs/existing-client-impl/06-sequencing-and-migrations.md`); the backend rollback limit no longer applies (2026-10-11).

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
9. Combined populated upgrade (release decision, 2026-10-11): migrate a disposable database to 051 (the v0.14.7 schema), insert representative v0.14.7 data (users, applications, password tokens, deliveries, idempotency receipts, and ledger rows), and apply 052 through the last migration in one run. Nothing is lost or rewritten and no historical mail is re-queued. The earlier requirement to run v0.14.7's own SQL statements against the final schema is dropped, because v0.14.7 is not a rollback target (no-rollback decision, 2026-10-11); the maintainer can reinstate it.
10. Seed grants: on the dev stack, `GET /v1/admin/session` for the seeded admin lists every new permission code. The maintainer reported the production values on 2026-10-11 (Q-012 in the decision record) and still confirms the dev stack's `SEED_AUTH_ENABLED` and `SEED_AUTH_ALLOW_PRODUCTION` before this check.

Browser checks should cover client/admin route navigation, form labels/focus/errors, disabled/cooldown states, mobile sizing, and explicit confirmations. Existing UI primitives/recipes and WCAG 2.2 AA requirements apply.

Separate explicit permission is required before starting a persistent local stack/mail-capture worker, emulator/Gradle run, real SMTP send, or any VPS operation. Use local synthetic accounts for verification; do not test-send to real customers by default.

Exit criteria: All requested outcomes pass relevant static/critical checks and authorized runtime scenarios. Report exactly what ran and what remains unverified. No release, push, deployed migration, or customer send happens merely because implementation is complete.

## 7. Plan changes and approval gate

- The maintainer approved implementation of the six outcomes on 2026-10-08 (Q-001 in the decision record). Q-002 to Q-004 were answered on 2026-10-11 (decision record), and the other section 3 defaults stand as conservative proposals. Changing a default or an answer changes scope.
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
| 2b. Email queue fencing, recovery, cancellation, and SMTP timeouts (step 2, tasks 3 to 6) | Done and committed; not deployed. Details below |
| 2c. Transactional enqueue with encrypted payloads and scrubbing (step 2, tasks 1 and 7) | Done and committed; not deployed. Details below |
| 3. Password-link authority, queueing, and resend API | Done and committed in three slices; not deployed. 3a token binding, redemption safety, retirement of other links, and lock order; 3b queued link mail, the link-address setting, the template-key migration, honest cancellation, and the unreadable-recipient fix; 3c the resend and status API, the permission, contracts, and frontend handling. Details below |
| 4. Admin creation recovery and resend controls | Done and committed; not deployed. Details below |
| 7. Earlier principal during onboarding | Done and committed in two parts (7a, then tasks 2, 3, and 8 with step 4); not deployed. Details below |
| 11. Required-update message and maintenance mode | Done and committed; not deployed. Details below |
| 5. Contact ownership, client profile, and phone editing | Done and committed; not deployed. Migration 056 is a major identity change recorded for the maintainer's review below |
| 6. Verified email changes and session safety | Done and committed; not deployed. Details below |
| 8. Admin template catalogue and custom-template editing | Done and committed; not deployed. Details below |
| 9. Preview, test send, and send to one client | Done and committed; not deployed. Details below |
| 10. Integrated verification and maintainer handoff | Done for everything that runs without a live stack; the browser, seed-grant, and live-mail checks are the maintainer's. Details below |

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

Verified (TESTED): `npm run check` in `backend_controller/` exits 0 with 87 test files and 956 tests (21 added across 2a and its follow-up), coverage 84.96% statements, 84.01% branches, and 91.61% functions, plus the build and both boot smokes. Each new guard was shown failing with its fix undone: durable ignored, expiry guard removed, retention removed from either route, durable made the default, request-hash comparison neutralised, a token added to the stored body, and the guard applied to every caller; removing the AUM growth line fails 2 of 19 cases in `adminReceiptRetention.test.ts`. One scoped container run (rule 3, with the maintainer's permission) executed five integration files against PostgreSQL 16 on Docker: `database` 14 of 14, including the new durable and expired receipt case, which proves the 9999 insert, `findCompleted`, and `hasExpiredRecord` against real SQL; `adminAum` 25 of 25; and `maturitySettlement` 11 of 11. `adminFundCatalog` (0 of 29) and `adminMandate` (0 of 16) return 401 on every request and gave no evidence; see below. The run left no containers; the pulled images `postgres:16-alpine` (294MB) and `testcontainers/ryuk:0.14.0` (2.4MB) remain cached. UNVERIFIED: the two durable routes themselves against PostgreSQL over HTTP, because their unit tests use an in-memory repository.

Corrected beliefs: a retry of an expired key did not execute the mutation twice. The re-run happened inside the transaction, hit `idempotency_records_scope_uk`, surfaced as a 500, and rolled back, so no duplicate was committed. It would become a real duplicate if a purge were ever added. The 24-hour value is only the code default (`IDEMPOTENCY_TTL_MS`); the deployed value is unverified. The creation receipt holds only the user id, account state, and verification state, and the invite token is never stored, so a replay does not re-send the mail.

Decided (maintainer, 2026-10-08): keep the other money writes on the 24-hour window. Each has a state guard that rejects a second execution under a new key, checked in source: ledger reversal, maturity settlement and payout status, refund retry and reconcile, receipt acknowledgement, mandate cancel, fund AUM initialize, correction, and collective growth, and user suspend, reinstate, and close. Mandate and collection reconcile are safe no-ops. The one exception was fund AUM growth by amount or percentage, which a repeat under a new key stacked as another snapshot revision, so it is durable too (`adminAumRoutes.ts`, `retention: "durable"`); the target form already rejects a zero delta. An expired key on any of the others returns the 409 and the admin reads current state. The reconcile routes read the provider before `runAdminMutation`, so an expired key still costs one read-only provider call. Client growth keeps its own inline copy of the protocol, and its receipts are referenced by a foreign key. Catalog, content, and user-lifecycle writes run with no receipt when the key is absent, and their state guards were not checked. If a purge of ordinary receipts is ever added, it removes this rejection for them; durable rows are excluded automatically.

Repaired (2026-10-08): `adminFundCatalog.integration.test.ts` and `adminMandate.integration.test.ts` created `native` sessions in their `makeUser` helpers, but admin authentication has accepted only `admin_native` since commit `5bec7a6` (2026-08-29), before this work began, and no commit had touched either file since. All 45 of their tests returned 401, and CI runs the integration suite (`.github/workflows/ci.yml:29`). Both helpers create only admin users, so the repair is the session channel in each. Verified in a container run on PostgreSQL 16: `adminFundCatalog` went from 0 of 29 to 29 of 29, and `adminMandate` from 0 of 16 to 15 of 16. The one remaining failure, `requests abandonment and enqueues cancel for setup_pending mandate`, had been hidden by the 401 and was a stale expectation, not a code defect: since `c01254c` (2026-09-09) a `setup_pending` mandate with no provider subscription and no live setup attempt is cancelled locally, and the test's fixture built exactly that mandate. It is now repaired too (see the baseline section below); `adminMandate` passes 17 of 17.

For step 4: the admin UI maps `IDEMPOTENCY_KEY_REUSED` to "Give it a moment" (`frontend_stack_ts/src/domain/failure.ts:72`), which will mislead on this 409. The UI must resolve an unknown outcome by reading current state with the original key, never by minting a new one.

### Step 2b handoff (2026-10-08)

Changed, backend only. Migration `052_email_queue_fencing.sql` is additive: `outbox_events.lease_generation integer NOT NULL DEFAULT 0` and a new `email_send_attempts` table (one row per outbox event and generation: worker, start, finish, outcome `accepted`, `retryable`, `permanent`, or `unknown`, error code, message id). Nothing is dropped, renamed, retyped, backfilled, or constrained over existing rows, and no enum value is added. Production uses `postgres:16-alpine` (both compose files), where adding a column with a constant default is metadata-only. Every claim bumps the generation, and every post-claim transition (to sending, delivered, retry, dead letter, cancel, release) is conditional on id, generation, and expected state, so a stale worker cannot overwrite a newer claim. Its late result is stored on its own attempt and never touches the newer claim. Recovery runs first in each pass and moves outbox and delivery together: an expired claim that never reached sending returns unsent, and an expired `sending` row with generation 1 or more becomes `retryable_failed` on the normal backoff (dead-lettered at the maximum attempts) with its delivery shown as `retryable_failed` or `permanent_failed` and its attempt marked `unknown`; it is no longer cancelled. The pass claims one message at a time, takes a lease sized from the send budget, and stops starting messages when the next could not finish inside the heartbeat budget. `cancelUnsent` cancels outbox and delivery together before sending and refuses once sending has committed; nothing calls it yet. SMTP timeouts are derived from `EMAIL_WORKER_LEASE_MS` in one tested function (`email/sendTiming.ts`) with no new settings. The OTP and password-link senders in the web process keep nodemailer's defaults.

Verified (TESTED): `npm run check` in `backend_controller/` exits 0 with 89 test files and 994 tests (38 added), coverage 85.00% statements, 84.04% branches, and 91.64% functions, plus the build and both boot smokes. Container runs on PostgreSQL 16 (the maintainer's permission, two runs): the new `emailQueueMigration.integration.test.ts` passes 5 of 5 and the existing `emailDelivery.integration.test.ts` passes 9 of 9. The new file migrates to 051, inserts queued, in-flight, delivered, and cancelled rows, applies 052, and shows nothing changed and the fence starting at 0; it also shows the previous release's statements still run against the new schema, a legacy unsent claim recovered and sent, and every legacy in-doubt row left exactly as recorded. Negative control: with the `lease_generation` predicate removed from the shared fence, a stale worker's settle returned true and overwrote the newer claim, and only the stale-claimant test failed; the file was restored byte-identical (sha256 `7d93e4b8…`). The agent's unit-level controls also showed each guard failing with its fix undone. UNVERIFIED: real SMTP, and the timeouts against the production mail provider.

Corrected beliefs: the plan said mail whose worker died was cancelled. It was lost only when the worker died after the `sending` commit, or when recording the result failed after the SMTP server had accepted the message; a crash before that was already retried. `db/types.ts` holds the `Database` table map, so the new table needed two lines there. The email loop sleep is 15 s in both compose files; 10 s appears only in the dev `.env.example`.

Recorded by decision and by design:

- Legacy `sending` rows stay frozen. A row left in `sending` before this migration (fence 0) is never recovered, cancelled, relabelled, or re-sent, and the claim query skips any outbox row whose delivery is `sending`. Operator pre-flight (read-only; running it on the VPS needs the maintainer's permission under rule 2): `select o.state, count(*) from email_deliveries d join outbox_events o on o.id = d.outbox_event_id where d.state = 'sending' group by o.state;`. A non-zero count means those messages stay as recorded until the maintainer decides what to do with them.
- A send has no hard overall deadline. The three nodemailer timeouts bound each phase, but the sum is not a cap: DNS sits outside the connection timeout, the connection timer re-arms per resolved address, the socket timeout is an idle timer, and nodemailer has no abort. A hard cap would need a wall-clock deadline and a process exit, which was not built.
- A late accept from a stale worker is stored on that worker's attempt only. It does not cancel a retry that was already scheduled, so a duplicate message is possible; email transport is at-least-once, and no account or ledger command is repeated.
- Watching the SMTP timeouts on the dev stack is the maintainer's step. At the default lease the budget is 20 s per send: 2 s DNS, 4 s connect, 4 s greeting, and a 10 s socket idle timeout (nodemailer's defaults were 2 minutes, 30 seconds, and 10 minutes). A slow server now produces an ambiguous timeout and a retry sooner than before. The ceiling is fixed at 20 s, so raising `EMAIL_WORKER_LEASE_MS` does not raise it.

Behavior to know: a pass now sends roughly 5 to 10 messages instead of up to 25, because it must finish inside the 60 s heartbeat; the outbox carries little volume today. Unknown outcomes reuse the error code `SMTP_TRANSPORT_ERROR`; the attempts table tells them apart, and nothing reads that table yet. The recorded SMTP response code is not stored because the sender result does not carry it. Rollback is safe: the previous release ignores the new column and table and needs no boundary. A row it finds left in `sending` by a new-release crash is cancelled by its old recovery, the bug this step fixes.

### Integration suite baseline and mandate cancel test (2026-10-11)

The stale `adminMandate` cancel test is repaired, tests only. Its fixture now gives the mandate a live `provider_pending` setup attempt, so it exercises the abandonment path it names, and it also asserts the queued cancel command row. One new test covers the local-cancel branch from `c01254c`: an expired setup attempt and no provider subscription leave the mandate `cancelled` and the SIP plan `cancelled`, with no gateway call, and the response names one `queued` cancel command of that mandate with `previous_mandate_state` `setup_pending`. The state expectations come from the `c01254c` message and the transition tables in `mandateStates.ts`, not from the route's output. The command row expectations record the route's current behavior by the maintainer's decision (Q-014); they are not an independent derivation. The pair separates the two branches only by setup-attempt state, so neither the separation nor the row assertions were shown failing under a source mutation; that needs another container run (rule 3). Two container runs of the file (the implementing agent's and the maintainer-side re-run) each passed 17 of 17.

One full run of the integration suite on PostgreSQL 16 (`npm run test:integration`, 10.06 s) gives 21 files and 233 tests, 229 passed and 4 failed:

| File | Passed | Failed | Total |
| --- | --- | --- | --- |
| adminAum | 25 | 0 | 25 |
| adminFundCatalog | 29 | 0 | 29 |
| adminIdentity | 17 | 1 | 18 |
| adminMandate | 17 | 0 | 17 |
| authDeviceLimit | 4 | 0 | 4 |
| authNative | 7 | 0 | 7 |
| authRepositories | 3 | 0 | 3 |
| authWeb | 9 | 0 | 9 |
| clientCatalog | 5 | 0 | 5 |
| clientEmailVerification | 7 | 3 | 10 |
| clientGrowth | 14 | 0 | 14 |
| database | 14 | 0 | 14 |
| deployBoot | 5 | 0 | 5 |
| emailDelivery | 9 | 0 | 9 |
| emailQueueMigration | 5 | 0 | 5 |
| emailVerificationMigration | 1 | 0 | 1 |
| mandatePersistence | 6 | 0 | 6 |
| maturitySettlement | 11 | 0 | 11 |
| metrics | 2 | 0 | 2 |
| paymentSettlement | 25 | 0 | 25 |
| publicRoutes | 14 | 0 | 14 |

Findings at that run, none fixed there and all repaired in the next section (unrelated stale expectations from deliberate code changes):

- `clientEmailVerification.integration.test.ts:251` expects `emailVerificationStatus`, but the route returns `emailVerificationState` (`clientEmailVerificationRoutes.ts:108`), which is also the contract name. Renamed in `5dc90fc` (2026-08-29).
- `clientEmailVerification.integration.test.ts:334` and `:352` post to `/v1/client/email-verification/resend` and get 404; the routes module has no resend handler. Removed in `5dc90fc`.
- `adminIdentity.integration.test.ts:440` expects the approval mail's `downloadUrl` without a query string, but `releaseFeed.ts:227` has appended `?v=<versionCode>` since `24a7449` (2026-09-10).

Finding on route behavior (Q-014, answered by the maintainer on 2026-10-11: the command row stays and `adminMandateRoutes.ts` does not change): the admin cancel route calls `createCancelCommand` after its if/else in every branch (`adminMandateRoutes.ts:552`), so the local-cancel branch (`nothingToRevoke`, `:514-517`) inserts a `mandate_cancel_commands` row in state `queued` with `previous_mandate_state` `setup_pending`, and the success response returns its id and state, which the contract requires (`admin-money.ts:677`). The client route's local-cancel branches create no command. TESTED: the local-cancel integration test asserts that row, and the full-suite run of 2026-10-11 passed `adminMandate` 17 of 17 with it. STATIC (no test runs the worker over a locally cancelled mandate): the provider is not asked. On its next pass the reconciliation worker finds the mandate `cancelled` (`mandateReconciliationWorker.ts:152`) and calls `markCancelSatisfied` (`mandatesRepository.ts:514`), which sets the row to `accepted` with `dispatch_started_at` and `accepted_at` set to that pass's time, and it counts the row in `cancelCommandsDispatched` (`:158`) although no provider call happened. `claimCancelDispatch` would refuse the row anyway, because the mandate has no provider subscription (`mandatesRepository.ts:492`). Until the pass the admin list shows the cancel as `queued`; afterwards the row reads `accepted`.

### Stale integration expectations repaired (2026-10-11)

The four stale expectations listed above are repaired. Tests only; no source file changed. In `clientEmailVerification.integration.test.ts` the status test reads `emailVerificationState`, the name the route and contract have used since `5dc90fc`. The two resend tests post to `/v1/client/email-verification/start`, the only route that issues a code (`issueCode`), so both behaviors stay covered: a request after the cooldown supersedes the earlier code, and one inside the cooldown is `RATE_LIMITED` (429). The helper's action type is narrowed to `start`, so a call to the removed route no longer type-checks. In `adminIdentity.integration.test.ts` the approval mail's `downloadUrl` is expected to end in `?v=<versionCode>`, which `releaseFeed.ts:227` has appended since `24a7449`. The expected suffix comes from the constant that writes `versionCode` into the seeded release manifest, not from the route's output.

Verified (TESTED) on PostgreSQL 16 (`postgres:16-alpine`) in the two container runs the maintainer allowed. The two repaired files alone passed 28 of 28 (`clientEmailVerification` 10, `adminIdentity` 18; 4.37 s). One full run of `npm run test:integration` then passed 21 of 21 files and 233 of 233 tests in 9.63 s, replacing the 229 of 233 baseline above. `npm run typecheck` and ESLint on the three edited test files exit 0. `docker ps -a` listed no container after either run once the Ryuk reaper had exited on its own. The 4 failures at `fb6d651` against unchanged source are the evidence that these assertions discriminate; no separate source mutation was run for them. From here any failure in the integration suite is new. Corrected baseline:

| File | Passed | Failed | Total |
| --- | --- | --- | --- |
| adminAum | 25 | 0 | 25 |
| adminFundCatalog | 29 | 0 | 29 |
| adminIdentity | 18 | 0 | 18 |
| adminMandate | 17 | 0 | 17 |
| authDeviceLimit | 4 | 0 | 4 |
| authNative | 7 | 0 | 7 |
| authRepositories | 3 | 0 | 3 |
| authWeb | 9 | 0 | 9 |
| clientCatalog | 5 | 0 | 5 |
| clientEmailVerification | 10 | 0 | 10 |
| clientGrowth | 14 | 0 | 14 |
| database | 14 | 0 | 14 |
| deployBoot | 5 | 0 | 5 |
| emailDelivery | 9 | 0 | 9 |
| emailQueueMigration | 5 | 0 | 5 |
| emailVerificationMigration | 1 | 0 | 1 |
| mandatePersistence | 6 | 0 | 6 |
| maturitySettlement | 11 | 0 | 11 |
| metrics | 2 | 0 | 2 |
| paymentSettlement | 25 | 0 | 25 |
| publicRoutes | 14 | 0 | 14 |

### Step 2c handoff (2026-10-11)

Changed, backend only, with no contract change, no configuration key, and no compose change. Migration `053_email_delivery_payloads.sql` adds one table, `email_delivery_payloads`: `email_delivery_id` is its primary key and a foreign key to `email_deliveries(id)` with `ON DELETE RESTRICT`, `ciphertext` and `nonce` are nullable `bytea`, and `key_version`, `created_at`, and `scrubbed_at` complete it. Checks require a non-blank key version, a ciphertext and nonce that are both null or a valid envelope (at least 16 bytes of ciphertext, a 12-byte nonce), and a ciphertext that is null exactly when `scrubbed_at` is set. No existing table, row, constraint, or enum value changes, so nothing is backfilled; the only effect on `email_deliveries` is the short lock the foreign key takes while the table is created. `enqueueEmail(tx, deps, input)` (`domain/email/enqueueEmail.ts`) writes the outbox event, the delivery, and an optional encrypted sidecar through the caller's transaction only. A message with a sealed payload gets the outbox topic `email.sealed`; every other message keeps `email` (`domain/email/emailTopics.ts`). The payload is encrypted with the existing recipient key (`encryptDeliveryPayload` in `crypto/context.ts`: AES-256-GCM, AAD `boe.email-delivery-payload.v1:<deliveryId>`, the key version stored beside it), so a payload cannot be moved to another delivery or swapped with a recipient envelope. The worker claims a list of topics (`claimDue`, the dispatcher config, and `workerComposition.ts`). It reads and decrypts the sidecar only after the fenced `markSending` has succeeded, in the same preparing transaction (`openSealedPayload`), so a stale, cancelled, or suppressed claim returns before any sidecar read. A missing, key-mismatched, or unreadable payload dead-letters through the fenced settle path with `EMAIL_PAYLOAD_MISSING`, `EMAIL_PAYLOAD_KEY_MISMATCH`, or `EMAIL_PAYLOAD_UNREADABLE`. The ciphertext is nulled and `scrubbed_at` set inside the delivery transitions `recordSent`, `recordSendFailure` (permanent only), and `cancel`, and in `cancelUnsent`, each only when its guarded update applied. A retryable failure keeps the payload, and `email_send_attempts` rows are untouched. `renderEmailTemplate` takes the stored `template_version` and refuses an unknown key and version pair with `TEMPLATE_VERSION_UNSUPPORTED`. `decideApplication` writes its outbox event and delivery through `enqueueEmail` with the same repository calls and arguments and no sealed payload; its unit tests and `adminIdentity.integration.test.ts` pass unmodified. By the maintainer's decision the sealed path has no caller in 2c; step 3 adds them in the same release, so the tests are its only consumer until then. Existing tests changed only for the new signatures (`topics`, the version argument).

Previous release and rollback: the migration is additive, the previous release (`169d1be`) keeps running against it, and it is not a rollback boundary. TESTED: the new `emailSealedPayloadMigration.integration.test.ts` migrates a disposable database to 052, seeds queued, processing, in-doubt `sending`, retryable, delivered, cancelled, and dead-lettered rows plus an attempt record and an idempotency receipt, applies 053, and shows every row and every existing table definition unchanged. It then runs the previous release's statements, compiled from the `169d1be` code, against the upgraded schema. The old claim takes legacy `email` rows and never an `email.sealed` row, because it filters `topic = 'email'` (`runtime/composition.ts:758` at `169d1be`), and the old `markSending` and `settleDelivered` still handle a legacy row. The old `recoverExpiredLeases` is the one statement with no topic filter. After a rollback it can reopen an expired sealed claim, `processing` or `sending`, as `retryable_failed` and clear its lease; it changes nothing else, the delivery row and ciphertext stay as they were, and the old claim still skips the row. On the next roll-forward the new worker sends an unsent sealed claim with its decrypted payload and scrubs it. A sealed row that was in doubt in `sending` keeps its delivery in `sending` and its ciphertext, and the claim skips it as it skips legacy in-doubt rows, so the operator's `sending` count query in the step 2b handoff now covers these too. STATIC: the previous release's contract types `lastErrorCode` as a plain string (`admin-oversight.ts:85`), so the new error codes are tolerated; the frontend was not run. `outbox_events.topic` has only a non-blank check, and no code outside `outboxRepository.ts` reads `outbox_events`, so metrics, health, and admin views do not see the new topic differently. No sealed row exists until step 3 writes one, and step 3 ships in the same release (v0.15.0).

Verified (TESTED): `npm run check` in `backend_controller/` exits 0 with 91 test files and 1011 tests (2 files and 17 tests added over 2b), coverage 85.06% statements, 84.20% branches, and 91.73% functions, plus the build and both boot smokes (RUNTIME for the boot only, with no database). The implementing agent and the maintainer-side re-run each passed the full integration suite on PostgreSQL 16 with 23 files and 254 tests (11.78 s on the re-run): the 21 files in the corrected baseline above unchanged, plus `emailSealedPayload` (17) and `emailSealedPayloadMigration` (4). They cover real-SQL rollback of the event, delivery, and payload when the caller aborts; send-time rendering from the decrypted payload with no copy left in the database; scrubbing on sent, permanent failure, dead letter, cancelled, and `cancelUnsent`, and none on retry or recovery-retry; kept attempt evidence; the three damaged-payload codes; the unsupported version; the composed worker claiming `email.sealed`; and the admin delivery list and application detail showing no secret and no ciphertext. `docker ps -a` was empty before every run and after the Ryuk reaper exited on its own, about 15 seconds later.

Negative controls: each mutation made at least one test fail, and the file was then restored and compared byte for byte. The maintainer-side re-hash after the work gave these values for the five files.

| Control | Mutation | Failing tests | sha256 of the original and restored file |
| --- | --- | --- | --- |
| a1 plaintext stored | `enqueueEmail.ts` merges the sealed payload into the outbox payload | the enqueue unit test that no other write contains the payload | `1f790ab63d70fe862a5ccbbeaa791fef6cd9e028a133104476fb7a47d25b7031` |
| a2 plaintext stored | `context.ts` stores readable JSON bytes as the "ciphertext" | the payload round-trip test in `context.test.ts` and the enqueue unit test | `887211e390b7efad8fd3b5f055947a4ed7d51e8cc1b57cf9689cb86ff7a9500c` |
| b1 scrub skipped | `emailDeliveryRepository.ts` no longer scrubs in `recordSent` | 3 integration tests (accepted, rendering, retry then send) | `27bf0451d5081ff831e1ec63b1d3f1f686d176bf8adb906c3577dc81668a3ca0` |
| b2 scrub too early | the same file also scrubs on a retryable failure | 2 integration tests (retry keeps the payload, recovery retry keeps the payload) | `27bf0451d5081ff831e1ec63b1d3f1f686d176bf8adb906c3577dc81668a3ca0` |
| c stale claim decrypts | `dispatchDueDeliveries.ts` ignores the fence result | the new stale-claim unit test and the 2b fencing test | `b7d50c58a78fcd4fe7b7378a34b31ea06f62ee9bdaf53af802b8fd11c32b0f30` |
| d no rollback | `enqueueEmail.ts` commits early | the integration rollback test (row counts 2, 2, 2 instead of 1, 1, 1) | `1f790ab63d70fe862a5ccbbeaa791fef6cd9e028a133104476fb7a47d25b7031` |
| e topic not claimed | `workerComposition.ts` claims only `email` | the composed-worker integration test | `252cf8b2a12b886690124f59b22ab6b480bed9ae20beab689cb44b95b9cb2b72` |

Control (a) has no mutation for the admin list returning the payload: the sidecar is a separate table that `selectAll()` on deliveries cannot reach, and the route-level integration test is its guard. Control (d) stands in for writes that escape the caller's transaction.

Corrected beliefs:

- The scouting belief that migration 025 kept a per-key reference matrix was partly wrong. 025 dropped it, and only the key whitelist `email_deliveries_template_check` remains.
- The immutable content reference was not enforced before this step: the renderer ignored the stored `template_version` and always rendered the latest body for the key.
- The 2b migration test's "previous release statements" were hand-written approximations. The new test uses the statements compiled from the `169d1be` code, and step 10's combined upgrade test replaces the approximations (release decision, 2026-10-11).
- The earlier reader inventory missed that the previous release's `recoverExpiredLeases` has no topic filter.
- Reusing the recipient key is sound for this volume: the key encrypts only recipient addresses and these payloads, far below the random-nonce limit of AES-GCM, and the AAD separates the two uses. Rotation was left open as Q-015; the maintainer settled it on 2026-10-11: drain the queue first, using the procedure in `DEPLOY.md`.

Noticed, not changed:

- When a delivery's recipient is missing or erased, `prepare` cancels the outbox row and leaves the delivery `queued`, so a sealed ciphertext would stay (Q-016, answered on 2026-10-11: slice 3b of step 3 cancels the delivery with the outbox row, and there is no reaper for frozen rows). Nothing sets `erased_at` today.
- Recipient ciphertexts carry no AAD, so anyone with database write access can swap them between rows. This predates 2c.
- A trigger that makes `template_key` and `template_version` immutable would alter an existing table, so none was added. Only the two insert creators write them (STATIC).

For step 3:

- Widening `email_deliveries_template_check` needs its own migration with a previous-release analysis, as 024 and 025 did. The contract's `AdminEmailDeliveryState` is a strict enum, so add template keys, not delivery states. `templateKey` on list items is `z.string()`, so a new key is tolerated by the previous release's contract (STATIC).
- A new template needs a `buildTemplate` case and an entry in `TEMPLATE_VERSIONS` in `email/emailTemplates.ts`, or the worker dead-letters it as `TEMPLATE_UNKNOWN` or `TEMPLATE_VERSION_UNSUPPORTED`. `EmailTemplateSubject` in `enqueueEmail.ts` accepts only the two existing keys and extends with the delivery creators.
- Secrets go in `sealedPayload`. The outbox `payload` stays plaintext.

UNVERIFIED: real SMTP, the dev stack, the VPS, a production-sized `email_deliveries` table (the foreign key's lock while the table is created), the frontend rendering of the new error codes, and whether production holds an unsent row with a `template_version` other than `v1`. The live release wrote only `v1` (STATIC, `decideApplication.ts` at `169d1be`), but an unsent row with another version would now dead-letter with `TEMPLATE_VERSION_UNSUPPORTED`. Proposed read-only check, not run (the VPS needs the maintainer's permission under rule 2): `select template_key, template_version, state, count(*) from email_deliveries where state in ('queued', 'retryable_failed', 'sending') group by 1, 2, 3;`.

### Step 3a handoff (2026-10-11)

Slice 3a of step 3 (token binding, redemption safety, retirement of other links, lock order). Changed, backend only: no contract, frontend, environment, compose, seed, permission, queue, or worker change, and mail goes out exactly as before. Slices 3b and 3c follow.

Migration `054_password_link_binding.sql` adds `users.email_revision bigint NOT NULL DEFAULT 1` (CHECK > 0) and the nullable `bound_email_revision` and `bound_credential_version` on `password_credential_tokens`, which are both null or both set (two CHECKs). The credential version reuses `user_credentials.version`, which every password replace already bumps; 0 means no credential yet. Both null means unbound, and the code rejects an unbound link, so there is no legacy-token path. Backfill record (Q-008, approved 2026-10-08): the same migration binds each unconsumed, unexpired token to its account's current email revision and credential version. It writes only the two new columns, reads `users` and `user_credentials`, writes no other table, and sends no mail. Read-only pre-flight, for a copy of production (the VPS needs the maintainer's permission under rule 2): `select count(*) filter (where consumed_at is null and expires_at > now()) as live, count(*) filter (where consumed_at is null and expires_at <= now()) as expired_unconsumed, count(*) filter (where consumed_at is not null) as consumed from password_credential_tokens;`. `live` is what the backfill binds; the other two stay unbound. It is not destructive: it adds columns and constraints that every existing row satisfies and rewrites no existing value (TESTED: a before and after snapshot of every table, minus the three new columns, is equal). It is idempotent: the statement is guarded by `bound_email_revision IS NULL`, a second run changes 0 rows (TESTED), and the runner never re-runs an applied file. The DDL holds `ACCESS EXCLUSIVE` locks on `users` and `password_credential_tokens` until the migration commits; its time on production-size tables was not measured.

Domain: `issuePasswordToken(tx, deps, { userId, requestId, requester })` no longer takes a purpose. Under the user lock it derives set (no password yet) or reset, refuses an account that is not `active` (`ACCOUNT_NOT_ACTIVE`), binds the link to the email revision and credential version, retires the older outstanding link, and audits the requester (`system`, `user`, or `admin`); admin-created invites now audit the creating admin and not the new user. The forgot route turns `ACCOUNT_NOT_ACTIVE` into the same 202 as an unknown or throttled address. `redeemPasswordToken` reads the token unlocked to find its user, then locks the user, the credential, and the token, and rechecks expiry, attempts, and the binding (`unbound`, `inactive_account`, `stale_email`, `stale_credential`, `credential_present`). The reset route maps every non-redeemed outcome to the same `INVALID_CREDENTIALS` 401, so no new error code and no account state reaches an unauthenticated caller (TESTED: identical body for an unknown, a stale, and an inactive-account link). Every successful set, reset, or change consumes the user's other outstanding links through `consumed_at`, the column the one-active-link-per-user index already depends on. Lock order is user, credential, tokens everywhere.

Deploy window (STATIC, from `release_manager/stacks/_shared/_boe_deploy.sh`, the compose files, and DEPLOY.md). The deploy runs `pg_dump` while the old stack still serves, then `compose up -d` with the new version: `migrate`, `seed`, then the backend and workers. Whether Compose stops the old backend before or after `migrate` depends on the VPS's Compose version, and Compose was not run, so the order is UNVERIFIED. If the old backend keeps serving, the window runs from the 054 commit until Compose stops it: the seed runtime plus Compose reaching `backend` plus the default 10-second stop grace period. No script timeout bounds it, because the script's timeouts bound only the new backend's start. Otherwise the window is about zero. During it the old backend issues unbound links from the forgot route and from admin client creation. A link lives 10 minutes (`EMAIL_VERIFICATION_CODE_TTL_MS`, the code default and both stack examples; the deployed `.env` was not read). The old backend's insert does not fail on the new schema (nullable columns; TESTED with SQL compiled from `169d1be`), and links that exist when `migrate` runs are backfilled and still redeem (TESTED). User impact: a client who opens an unbound link gets the generic 401 and requests a fresh link; a repeat inside the 60-second cooldown is silently swallowed, so they wait a minute. An admin-created invitee uses the forgot route until the 3c resend exists. Not measured: Compose ordering, seed runtime, production traffic in the window, the deployed lifetime and cooldown values, and migration time on production-size tables.

Cooldown (TESTED): per user, measured from the latest token's `created_at` whether or not it was consumed, answered with `RATE_LIMITED` 429. The window is `EMAIL_VERIFICATION_RESEND_COOLDOWN_MS` (60 s code default and prod example, 15 s dev example). The forgot route, admin callers, and system callers share it, and 3a does not change it. A throttled forgot request returns the same 202 as any other.

Verified (TESTED): `npm run check` in `backend_controller/` exits 0 with 91 test files and 1033 tests (22 added), coverage 85.06% statements, 84.20% branches, and 91.73% functions, plus the build and both boot smokes. The full integration suite on PostgreSQL 16 passes 25 files and 276 tests (14.67 s): the 23 files of the 2c baseline plus `passwordLinkAuthority` (17) and `passwordLinkBindingMigration` (5). Together they cover issuance, the redemption rechecks, retirement of other links, three concurrency cases on two real connections, the route responses, and the populated upgrade with consumed, expired, and live tokens of both kinds. `docker ps -a` was empty after every run. When the maintainer ruled out a rollback to v0.14.7, the test that the previous release also retires a link the new release retires, and the previous release's credential-replace statement, were removed from the migration test; the previous release's token statements stay as deploy-window evidence.

Negative controls: each mutation failed the stated tests and the file was restored and compared byte for byte (`cmp` and `sha256sum`; the original and restored hashes are equal).

| Control | Mutation | Failing tests | sha256 of the file |
| --- | --- | --- | --- |
| 1a | `passwordTokenBinding.ts` accepts an unbound link | 1 unit, 2 integration | `c00d5033b65f9acbcbe5acdeca3dc05635c2c79dcb822f86be2a6a12cc66798f` |
| 1b | the same file writes a wrong binding | 1 unit, 5 integration | same file |
| 2a | account-state recheck removed | 1 unit, 3 integration | same file |
| 2b | email-revision recheck removed | 1 unit, 1 integration | same file |
| 2c | credential-version recheck removed | 1 unit, 2 integration | same file |
| 2d | set-over-existing-password recheck removed | 1 unit, 1 integration | same file |
| 2e | `passwordCredential.ts` issues for an inactive account | 3 unit, 2 integration | `fd14c4559f5bdad66d509cf58701623a7a7a433a01a4cf80ab7638b88e5aeb07` |
| 3 | the same file stops retiring links on set, reset, or change | 3 unit, 2 integration | same file |
| 4a | the same file stops retiring the older link on a newer issuance | 1 unit, 3 integration | same file |
| 4b | redemption locks the token before the user | 2 unit; integration "deadlock detected" (final file: 1 failure in 1.0 s) | same file |
| 4c | `FOR UPDATE` removed from `userRepository.ts` and `credentialRepository.ts` | 3 integration (final file: 3 failures, 13.7 s) | `7e50b629dd7962a97310bd56341aaf7091630518deb47147f35df8e725c91b36` and `d2e066a0cf2a878c0e07facf98114e76dd1cac481f2b4c82df4e92d00df10874` |
| 5a | the backfill in `054_password_link_binding.sql` binds nothing | 3 integration | `470f2674fe1ca8f3711258b96a0e4d58a5a38ee52bf2756e857383278911127a` |
| 5b | the backfill also binds consumed tokens | 1 integration | same file |
| 5c | the backfill also binds expired tokens | 1 integration | same file |
| 6 | the forgot route stops swallowing `ACCOUNT_NOT_ACTIVE` | 1 integration | `32d51c6a129ea3845cb067972aeb928cf5f36372d83ba8e5dfa55d3da522e7b4` |

The implementing agent ran controls 1a to 4c; the maintainer-side verification re-ran 4b and 4c on the final test file and ran 5a to 6.

Corrected beliefs:

- The table is `password_credential_tokens`. Redemption locked the token and then the user while issuance locked the user and then the token, so the two could deadlock. Reproduced by mutation as PostgreSQL "deadlock detected".
- The plan's "purpose" and "set over an existing password" rechecks are one rule. A reset link on an account with no password still redeems, so backfilled links of accounts that never set a password keep working.
- `seedAuth.ts` overwrite does not bump `user_credentials.version`, so it retires no links. Unchanged.
- Set and reset links share the 10-minute lifetime of the email code. That is a product question for the maintainer (Q-017); nothing changed.

For slices 3b and 3c:

- `issuePasswordToken` returns `{ userId, email, rawToken, expiresAt, purpose }` and has no token id yet; 3b adds it. It throws `RESOURCE_NOT_FOUND`, `ACCOUNT_NOT_ACTIVE` (403), and `RATE_LIMITED` (429 with `retryAfterSeconds`).
- Issuance checks only `account_state`. The 3c route must itself refuse accounts that hold an active role grant.
- 3b calls issuance in the same transaction as `enqueueEmail` and puts the raw token only in the sealed payload. Before it sends, the worker calls `assessPasswordTokenBinding({ token, user, credential })` plus the consumed and expired checks, and cancels the unsent mail when the result is not null.
- The template comes from `issued.purpose`; the forgot route still sends the reset template today.
- Step 6 must bump `users.email_revision` and call `consumeActive` in the same transaction as an email change.

UNVERIFIED: the Compose stop order on the VPS, the migration time on production-size tables, and the deployed lifetime and cooldown values.

### Step 3b handoff (2026-10-11)

Slice 3b of step 3: queued password mail and its configuration. The coding agent built most of it and its usage limit ran out before it committed; a separate session reviewed the work, added the unreadable-recipient fix and the `DEPLOY.md` correction, ran the checks, and committed it. Backend, tracked env examples, and compose passthroughs only; no contract or frontend change.

Changed:

- Admin client creation and the forgot route no longer send mail from the web request. `issuePasswordLinkMail` (`domain/auth/passwordLinkMail.ts`) issues the token and, in the same transaction, queues it through `enqueueEmail` on `email.sealed`, with the link only in the sealed payload and the token id (`passwordTokenId`) in the plain payload. The template follows the issued purpose (`password_set_link` or `password_reset_link`). Creation commits the account, token, mail, receipt, and audit together, and a replay queues nothing new. The removed synchronous send was the source of the timeout in finding 2A.
- The client link address is the new setting `CLIENT_PASSWORD_LINK_URL` (`domain/auth/passwordLinkUrl.ts`), replacing the first `WEB_ORIGIN_ALLOWLIST` origin. It is read at issuance, never at boot. If it is missing or unusable, admin creation answers 503 `DEPENDENCY_UNAVAILABLE` naming the setting and saves nothing, and the forgot route keeps its uniform 202, logs the problem, and issues nothing. Production also requires https.
- After a successful set or reset, the app-download mail is queued inside the redemption transaction behind a savepoint (`db/savepoint.ts`), so a queueing failure never undoes the password change. The response keeps its existing values; a queued mail is reported as `unconfirmed`, never `sent`.
- Migration `055_password_mail_templates.sql` widens `email_deliveries_template_check` to add `password_set_link`, `password_reset_link`, and `password_app_download`. It replaces one CHECK with a strictly wider one in one transaction, writes no row, and every existing row satisfies it.
- The email worker runs a send guard per template key before it marks a message sending. For link mail (`domain/email/passwordLinkMailGuard.ts`) it reloads the token, user, and credential and cancels the unsent mail through `cancelUnsent` when the token is missing, belongs to another user, is consumed or expired, or fails the 3a binding. A retry sends the same link and issues no new token.
- Q-016 (a): a missing or erased recipient now cancels the delivery together with its outbox event through `cancelUnsent`, so the delivery log no longer shows such mail as queued.
- A recipient address that cannot be decrypted (another key, or damaged ciphertext) now dead-letters that one message with `EMAIL_RECIPIENT_UNREADABLE`. Before, `decryptRecipient` threw inside `prepare`, the pass aborted, the claim expired without counting an attempt, and the next pass reclaimed the same message, so one such row stopped all mail behind it. The rotation section of `DEPLOY.md` now describes the new behavior.

Configuration for the operator: add `CLIENT_PASSWORD_LINK_URL` to each stack `.env` before the v0.15.0 deploy, because a deploy never overwrites it. The tracked examples use the first web origin plus `/reset-password`, the address the old code built: `https://dev-app.beonedge.in/reset-password` (dev) and `https://app.beonedge.in/reset-password` (prod). The compose files pass it to the backend. Password mail now leaves only while `email-worker` runs with SMTP configured.

Verified (TESTED): `npm run check` in `backend_controller/` exits 0 with 93 files and 1104 tests, coverage 84.90% statements, 84.31% branches, and 91.54% functions, plus the build and both boot smokes. The full integration suite on PostgreSQL 16 passes 28 files and 313 tests, including the new `passwordLinkMail` (creation, replay, rollback of everything when queueing fails, the admin list showing the new key with no secret, identical forgot answers, and the download mail), `passwordLinkMailWorker` (retry sends the same link, a newer link supersedes, expiry cancels a retry, cancellation never opens the payload, composition wires the guard), and `passwordMailTemplatesMigration` (populated upgrade: every existing delivery in every state keeps its row, only the CHECK changes, the new keys are accepted, unknown and blank keys are still refused). No container was left. The replaced route tests assert the queued behavior in place of the removed synchronous-send ones; none was dropped without a replacement. Negative controls, each restored by checksum (`dispatchDueDeliveries.ts` `1d3adaa97a19aa97`): ignoring the guard's cancel verdict fails 3 tests; dropping the `cancelUnsent` call for a missing recipient fails 2; before the unreadable-recipient fix, both new tests failed with the pass throwing "unable to authenticate data". The agent's own controls for the rest of 3b were not recorded and were not repeated.

Deploy window (STATIC): migration 055 only widens a CHECK. While the v0.14.7 backend still serves after `migrate`, it keeps sending invites and reset mail synchronously, which the wider CHECK does not affect. No rollback to v0.14.7 is planned (decision record), so the old worker meeting `email.sealed` rows is not analyzed further.

Corrected beliefs: none beyond the unreadable-recipient behavior above, which `DEPLOY.md` described as a throwing pass.

Not verified (UNVERIFIED): real SMTP, the mail as rendered in real clients, the deployed `.env` values, and the production delivery volume.

### Step 3c handoff (2026-10-12)

Slice 3c of step 3: the admin resend and status API, its permission, contracts, and the frontend handling. No migration.

Changed:

- `POST /v1/admin/clients/{userId}/password-link` (`sendAdminClientPasswordLink`): CSRF, `clients.password_links.send`, a required idempotency key (ordinary retention; a repeat with a new key only issues a newer link that retires the older one), and an empty body. It refuses an account with any active role grant (`STATE_CONFLICT`, "only for client accounts"), and turns issuance's `ACCOUNT_NOT_ACTIVE` for the target into `STATE_CONFLICT` so it is not confused with the admin's own session state. It shares the per-user cooldown with the forgot route (`RATE_LIMITED` 429) and answers 503 naming `CLIENT_PASSWORD_LINK_URL` before writing anything when the link address is unusable. The answer is the user, purpose, expiry, delivery id, and `deliveryState: "queued"`. The audit actor is the admin (3a).
- `GET /v1/admin/clients/{userId}/password-link` (`getAdminClientPasswordAccess`): `users.read` or the new permission. It reports whether a password exists, when the next link is allowed (the cooldown end, or null), and the latest link's purpose, state (`active`, `expired`, or `closed` for used or replaced), times, and its delivery's state, last error code, and sent time. No token material. The delivery is found through the outbox deduplication key `password_link:<token id>`.
- Client creation's response adds `passwordLink` (purpose, expiry, delivery id, `queued`). It is optional in the contract only because creation receipts stored by v0.14.7 lack it and replay as stored.
- The permission `clients.password_links.send` is in `seedCatalog.ts` (superadmin through the full catalog, and the onboarding role) and the frontend `PERMISSION_CODES`.
- Delivery filters accept and label the three password-mail template keys (backend query schema, contract enum, admin screen).
- The reset response reports `queued` when the app-download mail was queued, `unconfirmed` when queueing or the APK lookup failed, and `unavailable` when no APK is published; `sent`, which nothing produces any more, is gone. The reset screen says the link is on its way rather than sent.
- Fixed a live bug (STATIC, since `24a7449`, 2026-09-10): the reset response contract only accepted a download URL ending in `.apk`, but the backend appends `?v=<versionCode>`. The web client validates every response, so whenever an APK was published, a successful password set was shown to the client as a failure. The pattern now accepts an optional `?v=<positive integer>` and still refuses other hosts, paths, queries, and fragments.

These response changes are allowed by the 2026-10-11 decision that new APKs ship with v0.15.0.

Verified (TESTED): `packages/contracts` `npm run check` exits 0 with 98 tests and a valid OpenAPI file. `backend_controller` `npm run check` exits 0 with 93 files and 1104 tests, coverage 84.91% statements, 84.31% branches, and 91.54% functions, plus both boot smokes. The full integration suite on PostgreSQL 16 passes 28 files and 323 tests; `passwordLinkMail` gained 10 cases: a fresh link retires the replaced one and appears in the status, same-key replay issues nothing, the cooldown answers 429 and writes nothing, an admin account and suspended and closed clients are refused with nothing written, unknown users get 404 on both routes, an unusable link address gives 503 with nothing written, a support admin is denied on both routes, and a client with a password and no link reports exactly that. `frontend_stack_ts` `npm run check` exits 0 with 22 files and 212 tests and the bundle boot check. Negative controls, each restored by checksum: removing the client-only check fails the admin-account case; widening the send guard to `users.read_limited` fails the support case; the old download-URL pattern fails 2 of the 3 new contract tests. Two existing tests were updated for intended changes: the creation response now has four fields (the stored receipt still holds no token), and a successfully queued download mail now reports `queued`.

Not verified (UNVERIFIED): the admin screens that use these endpoints (step 4), and any browser run.

### Step 7a handoff (2026-10-11)

Built by a separate session, with the maintainer's authorization, in the worktree `../boe_app-step7a` on branch `plan/step7a` from `5cdc6fd`, in parallel with step 3. It touches no step 3 file. It covers step 7 tasks 1, 4, and 6, and task 5's server validation and confirmation. Tasks 2 and 3 (the form on `CreateClientScreen`, `UserDetailScreen`, and `ApplicationDetailScreen`) and task 8's gates on those screens wait for step 4. There is no migration, permission, environment key, or response-shape change.

Changed. Server (`6794cfb`): the recorded-contribution route checks `effectiveDate` with `z.iso.date()`, the calendar check the AUM and maturity routes already used, instead of a shape-only regex. `amountPaise` uses one bounded positive-paise schema, now in `adminRouteKit.ts` and shared with the maturity routes, so `9223372036854775808` and above are refused with a field error instead of reaching PostgreSQL. Surrounding whitespace in `amountPaise` is no longer trimmed; the contract never allowed it and the form never sends it. The contract body's `effectiveDate` is `z.iso.date()` too, and OpenAPI is regenerated (`format: date`). Frontend (step 7a commit): `rupeeTextToPaise` in `domain/money.ts` converts typed rupees with at most two decimal places to paise with BigInt arithmetic and the bigint bound, never through a number. `isUnknownWriteOutcome` in `api/errors.ts` treats transport failures, 5xx, `IDEMPOTENCY_IN_PROGRESS`, `IDEMPOTENCY_KEY_REUSED`, and unrecognised errors as unknown, and a definite 4xx or a request refused before sending as nothing applied. `EarlierInvestmentForm.tsx` is the one shared form, extracted from `ClientPositionDetailScreen.tsx` (458 to 319 lines). It takes rupees through `AmountInput` (new `decimals` option), shows a confirmation that this records money invested before the app, not a charge and not growth, and uses the existing `useIdempotencyKey` with an explicit attempt counter. After an unknown outcome the inputs lock to the exact request: Check again resends the same key and body, and Start a new attempt needs a confirmation that tells the admin to check the ledger first. After success, Record another investment is the only way to a new key. The mutation takes the caller's key and refreshes the investor's positions and ledger on any settle. The success message shows INR instead of raw paise. On the same screen, a reversal with an unknown outcome no longer says "Nothing was written"; its key handling is unchanged, because a ledger entry can be reversed only once (step 2a decision).

Verified (TESTED), all in the worktree: `packages/contracts` `npm run check` exits 0 with 95 tests and a valid OpenAPI file. `backend_controller` `npm run check` exits 0 with 92 files and 1034 tests (23 new), coverage 85.09% statements, 84.41% branches, and 91.73% functions, plus both boot smokes. `frontend_stack_ts` `npm run check` exits 0 with 23 files and 223 tests, and `build:client` (17 assets, 844538 bytes, Android budget and boot check) and `build:admin` both exit 0. Negative controls, each restored and checked by checksum: the shape-only date fails 11 of 11 impossible-date cases; removing the bigint bound fails both oversized amounts; classifying 5xx and key reuse as rejected fails 2 of 6 classifier tests; classifying transport and unrecognised errors as rejected fails 3 of 6; a number-based rupee conversion fails 2 of the rupee-text tests. Expected values come from calendar rules, `2n ** 63n - 1n`, and hand-computed paise, not from the implementation.

Not verified (UNVERIFIED): the integration suite (no container run in this session; the route's database path is unchanged apart from refusing earlier), the form in a running browser (no dev server was started), and keyboard and focus behavior beyond the existing dialog and field primitives.

Findings for the maintainer:

- "Today" is the UTC date on both the server (`assertNotFuture`) and the form. Between 00:00 and 05:30 IST an admin cannot record an investment dated that IST day until 05:30. This predates step 7a; changing it is a product decision.
- `adminClientGrowthRoutes.ts:91` has the same shape-only date check for growth adjustments. It was left alone because the client-growth wall is outside step 7.
- `z.iso.date()` accepts year `0000`, which PostgreSQL rejects, so such a request fails in the database and rolls back. The AUM and maturity routes behave the same way.
- An unknown outcome is held only while the form is mounted. Switching investor or reloading drops it, and the message points the admin to the ledger. The embedded uses after step 4 inherit this.
- Any single amount up to the bigint maximum is accepted. Adding it to an already large position could overflow the position sum in the database, which fails and rolls back rather than corrupting data.

Merge into `main` after step 3: keep both entries in this section, regenerate `packages/contracts/generated/` instead of hand-merging it, update the header status, and run the contracts, backend, and frontend checks and both builds before committing the merge.

### Step 4 and step 7 (tasks 2, 3, and 8) handoff (2026-10-12)

Changed, frontend plus one backend read field:

- Create client (`CreateClientScreen.tsx`): the idempotency key comes from `useIdempotencyKey` over the trimmed body plus an attempt counter, minted at the submission boundary and held across retries (step 4 task 1). A definite refusal unlocks the form; an unknown outcome (transport failure, 5xx, idempotency conflict, per `isUnknownWriteOutcome`) holds the form on the exact request and offers Check again (same key and body; the durable creation receipt from step 2a returns the account even after 24 hours), Find the account (the directory, prefilled through `?q=`), and Start a new attempt behind a confirmation (task 3). "Nothing created" and "The invite has been emailed" are gone: refusals say "Not created", a duplicate identity says it may be the earlier attempt's account and links to the directory rather than treating it as proof (task 5), and success says the link is queued and shows its purpose and expiry from the creation response (task 2).
- `PasswordLinkPanel.tsx` (new), on the creation success view and on user details for client accounts: whether a password exists, the latest link's purpose, state, and expiry, its email's delivery state and error code, and when the next link is allowed; Send a new password link behind a confirmation that says the earlier link stops working and the password does not change; the same unknown-outcome handling; Refresh. The action needs `clients.password_links.send` in the component (task 6) and an active client account; without the permission it says which one is needed. Queries live in `passwordLinkQueries.ts` because `adminQueries.ts` is near the 800-line limit; the resend invalidates the status query.
- `UserDirectoryScreen.tsx` seeds its search from `?q=` (trimmed, at most 120 characters).
- Step 7 task 2: the shared `EarlierInvestmentForm` (7a) appears on creation success and on user details for client accounts that are not closed, gated by `client_position.write` (task 8). Task 3: application details now carry `linkedUserId` (backend `findLinkedUserId`, contract `AdminApplicationDetailData.linkedUserId`), and an approved application shows Open the client account, which leads to user details and the form.

Verified (TESTED): contracts check 98 tests; backend check 94 files and 1127 tests (coverage 84.94% statements, 84.52% branches, 91.54% functions) plus both boot smokes; the integration suite on PostgreSQL 16 passes 28 files and 323 tests; frontend check 25 files and 230 tests; `build:client` (17 assets, 844606 bytes, Android budget and boot check) and `build:admin` pass. New component tests: `CreateClientScreen.test.tsx` (a lost reply holds the form and Check again sends the identical key and body; a gateway failure is unknown too; only a confirmed new attempt changes the key; a refusal unlocks the form, keeps the key for the same body, and changes it for a corrected body) and `PasswordLinkPanel.test.tsx` (the send action appears only with the permission and for an account that can receive a link). Negative control: minting a new key on every render fails 2 of the 4 screen tests; restored by checksum (`401c95d70915c7c4`).

Not verified (UNVERIFIED): a browser session against a running stack, keyboard and focus order in the new dialogs beyond the existing primitives, and the plan's runtime check of a committed creation with a lost reply (needs a persistent local stack).

Findings: the client app's generic `IDEMPOTENCY_KEY_REUSED` copy in `domain/failure.ts` ("Give it a moment") is still used by client screens; the admin screens no longer reach it for these actions, because they classify that code as an unknown outcome.

### Step 11 handoff: required-update message and maintenance mode (2026-10-12)

Requested by the maintainer on 2026-10-12 (decision record). VPS evidence (read-only, permitted): Cloudflare Tunnel reaches nginx on port 80; nginx proxies `app.beonedge.in` and `dev-app.beonedge.in` to each stack's frontend and backend ports and serves the APK folders from `/srv/dev_stack/BOE_APP/<stack>/`; the site configs are staged in `/srv/dev_stack/BOE_APP/NGINX` and installed by a person, as `lib/nginx_ship.sh` describes.

Changed:

- Required update. The existing mechanism stays: `minimumSupportedVersion.android` makes the update feed answer `mandatory`, and every APK, including v0.14.7, then shows its blocking "Update required" screen with the install panel. `GET /v1/app/update` keeps its exact shape, because v0.14.7 parses it strictly and is the client this must move. The admin config gains `minimumSupportedVersion.message` (up to 500 characters, backend and contract); apps from v0.15.0 read it from `GET /v1/app-config` (a loose record, so old apps ignore it) and show it under a firmer default text.
- Advance notice. `maintenance.scheduledFor` joins `maintenance.enabled` and `maintenance.message`. Apps from v0.15.0 read the app config when they open or regain focus, at most every five minutes, and every 30 seconds only while the maintenance screen is up (`features/app-notice/`) and show a banner: "Planned maintenance from <time>" until that time, or "Maintenance in progress" while `enabled` is true. Nothing read `maintenance` before.
- Maintenance during a push. The deploy and rollback scripts raise `<stack_dir>/maintenance/active` and install the bundled `maintenance.html` (`stacks/_shared/maintenance.html`, shipped by `export.sh` and `deploy.sh`, required by `verify.sh`). The flag goes up before the pre-deploy backup and comes down after the health checks pass or an automatic rollback is healthy; on exit it is lowered again if the running stack was never touched, and kept, with instructions, if the stack may be down. `--maintenance-on` and `--maintenance-off` toggle it by hand under the lock. The three site configs answer API locations with a 503 `SERVICE_MAINTENANCE` JSON body, `X-BOE-Maintenance: 1`, `Retry-After: 60`, and `no-store`, and the web-app location with the page and a 503; APK downloads, app links, and health probes are untouched. The frontend HTTP client turns a 503 with that header into `SERVICE_MAINTENANCE` and a `maintenance` transport outcome; both shells show a blocking "We are updating BeOnEdge" screen that probes every 30 seconds and closes on the first success. `SERVICE_MAINTENANCE` (503, retryable) is added to the contract error catalogue; only nginx produces it.
- `ConnectivityBanner`'s offset logic moved into `useChromeOffset`, shared with the notice banner.
- `verify.sh` exempts `CLIENT_PASSWORD_LINK_URL` from its secret-name check (it matched `*PASSWORD*` but is a public page address); before this, `verify.sh` failed 2 checks on the committed 3b examples.

Verified: RUNTIME, nginx 1.27 in a disposable container with the three configs, the shared config, the headers snippet, and the page: `nginx -t` passes; with the production flag present, `/api/v1/portfolio`, the login route, and `/api/newuser` answer 503 with the JSON body and the four headers plus the security headers, `/` and `/portfolio` answer 503 with the page, the APK download and `assetlinks.json` answer 200, the page itself is not directly reachable (404), and the dev host is unaffected; with the flag removed, every route proxies again (502 with no upstream in the test). The Tailscale admin host answers maintenance when the dev flag is present. TESTED: `http.test.ts` (a marked 503 becomes `SERVICE_MAINTENANCE` and a maintenance outcome; an unmarked 503 stays the server's error), the contracts, backend, and frontend checks, both builds, `verify.sh` (110 passed, 0 failed), and every `release_manager/tests/*.test.sh`; `apk_ship.test.sh` needed `maintenance.html` in its bundle fixtures, because a bundle without it is now incomplete. The test container was removed; the `nginx:1.27-alpine` image stays cached.

Corrected during the work: the first version polled the app config every five minutes, and both builds then hung after printing "check-bundle-boots passed", because that guard waits for the event loop to drain. A diagnostic that recorded pending timers found React Query's five-minute cache-cleanup timer, scheduled by the first query that fetches at boot (the app config, in every shell). The query now has `gcTime: Infinity` (it lives for the whole session), refreshes on open and focus instead of on a timer, and polls every 30 seconds only while the maintenance screen is shown; the guard is unchanged.

Findings: nginx runs the flag check before the Tailscale allow-list, so during maintenance an address outside the list gets the static maintenance JSON instead of 403; nothing is proxied. `expires -1` does not apply to 503 responses, so the page carries no explicit cache header (browsers do not cache 503 by default).

Operator steps for v0.15.0: install the updated nginx site configs with the commands the deploy prints, then `nginx -t` and reload (the flag has no visible effect before that); after publishing the v0.15.0 APK, raise `minimumSupportedVersion.android` and optionally set `minimumSupportedVersion.message`; announce planned maintenance with `maintenance.message` and `maintenance.scheduledFor`.

Not verified (UNVERIFIED): the deploy and rollback scripts were not run (rule 2), a real Android install path, the Cloudflare edge's handling of the 503 page, and the apps' screens in a browser.

### Step 5 handoff: contact ownership, client profile, and phone editing (2026-10-12)

Changed:

- Ownership. Users own their current email and phone; only `submitted` applications reserve identifiers. `findActiveConflict` (signup and admin creation) now checks users plus submitted applications, and the new `findContactOwner` takes either identifier and an optional user to exclude. Approved applications stay as immutable history but no longer reserve a contact that their user has since replaced.
- Locks. `identityLockRepository.lockIdentities` takes transaction-scoped advisory locks on `identity:email:<email>` and `identity:phone:<phone>`, in sorted order, before any row lock, in public signup, admin client creation, application approval, and the phone change. Approval reads the application first, takes the locks, and only then locks the row, because a signup inserting the same email would otherwise wait on the approval's row while the approval waited on the signup's lock. Database uniqueness stays the final guard.
- Approval rechecks under the lock that no other account now holds the application's email or phone, and refuses with `STATE_CONFLICT`, writing nothing, if one does.
- Client profile. `GET /v1/client/profile` returns the server's view of the account (email, email verification, phone, `phoneVerified: false`, version). `POST /v1/client/profile/phone` takes the new number and the current password: the number is normalised to E.164 (`domain/shared/phoneNumber.ts`, now shared with admin creation); under the identity lock, then the user and credential row locks, the password is verified (the same pattern as `changePassword`, so the credential is rechecked under lock before commit); an unchanged number is a no-op; a number held by another user or a submitted application is refused; the guarded update bumps the user version; the audit row records only the last four digits; and a token-free `contact_phone_changed` notice to the current email carries only the last four digits. Both routes accept the client app's bearer token or the client web cookie (with CSRF on the write), and refuse admin sessions. No SMS verification is claimed (Q-002).
- Frontend: Profile, Contact details (`/profile/contact`) shows the email, its verification, the phone as "Not verified by SMS", and a change form; a lost reply says the outcome is unknown and points to the reloaded number.
- Refactors in the same change: `PasswordMailTemplateKey` and `createPasswordMailDelivery` from 3b are now `UserMailTemplateKey` and `createUserMailDelivery`, since user-only mail is no longer only password mail.

Migration `056_contact_ownership.sql` (major identity change, for the maintainer's review before release). What it touches: the two partial unique indexes on `applications` and the `email_deliveries` template CHECK. It drops `applications_active_email_uk` and `applications_active_phone_uk` (predicate `state NOT IN ('rejected','withdrawn')`) and creates `applications_submitted_email_uk` and `applications_submitted_phone_uk` (predicate `state = 'submitted'`) in the same transaction, so uniqueness on submitted applications is never absent; it adds `contact_phone_changed` to the template CHECK. It rewrites, deletes, or backfills no row. Pre-flight: none is needed for the indexes, because the new predicate is strictly narrower, so every existing row already satisfies it; the old index guarantees no duplicate submitted pair exists. Behaviour change on live data: a contact held only by an approved application whose user has moved to a different contact becomes free for a new signup or another user. Deploy window: the old backend, while still serving, keeps its own (wider) conflict checks, so it is stricter than the new schema and cannot create a duplicate. No rollback to v0.14.7 is planned (decision record). The index builds take an exclusive lock on `applications` for their duration; not measured on production-size data.

Verified (TESTED): contracts check 98 tests; backend check 94 files and 1127 tests (coverage 84.71% statements; the new route and domain are covered by the integration suite, not the unit run) and both boot smokes; the full integration suite passes 30 files and 340 tests; frontend check 25 files and 232 tests (the route-manifest guard required declaring the new Contact details link); `build:client` and `build:admin` pass. On PostgreSQL 16: `contactOwnershipMigration` (6): before 056 a released contact is refused by the old indexes; applying it changes no application or user row; the new indexes exist and the old ones are gone; a released contact is accepted afterwards; duplicate submitted applications and duplicate users are still refused; the template CHECK accepts the new key. `contactOwnership` (11): profile read; anonymous and admin-session denial; a phone change with the notice (last four digits only) and audit; wrong password (401, nothing changed); unchanged number (no notice); another user's or a pending application's number refused; a number once used by an approved application whose account moved on accepted; the phone change waits for the shared identity lock; two clients racing for one number end with exactly one holder and a clean refusal; a public signup may use a released number; an approval is refused, writing nothing, when its number now belongs to another account. Negative controls, each restored by checksum: without the identity lock, the lock-wait test fails; with approved applications reserving again, the released-number test fails; without the approval recheck, the approval test fails (the first race test alone did not prove the lock, because the users unique constraint already turns that race into a clean 409; the lock-wait test was added for that reason).

Not verified (UNVERIFIED): the screens in a browser, the index build time on production data, and SMS (not built, by decision).

### Step 6 handoff: verified email change and session safety (2026-10-12)

Changed:

- Request: `POST /v1/client/profile/email` takes the new address and the current password. Under the identity lock on the new address, then the user and credential row locks, it verifies the password, treats the current address as a no-op, refuses an address held by another user or a submitted application, applies the shared resend cooldown, retires any older request, and stores one active request in the new `email_change_requests` table: the target address encrypted with the recipient key, a hashed 6-character code (the generator from email verification, now exported), the email revision and credential version it is bound to, attempts, and expiry (the email-verification code lifetime and limits). The code goes only to the new address, queued on `email.sealed` (`email_change_code`, code only in the sealed payload). The current address and login keep working until confirmation.
- Confirm: `POST /v1/client/profile/email/confirm` takes the code. It reads the pending request, takes the identity lock on its target, then locks the user, the credential, and the request; it checks expiry, attempts (wrong codes are counted, then the request locks), the code, and the binding (a request made before a password or email change is refused and retired), and rechecks ownership. It then, in one transaction: replaces the address, bumps `users.email_revision` and the version, marks the new address verified, consumes the request, the email-verification codes, and every outstanding password link, revokes every session and refresh token, audits masked addresses, and queues token-free `contact_email_changed` notices to the old address (with the masked new one) and the new address.
- Login safety: `webLogin` and `nativeLogin` now refuse, inside the session-issuing transaction, a login whose account email or `email_revision` no longer matches what was verified before the password check, so a sign-in that began with the old address cannot create a session after the change.
- The worker guard `email_change_code` cancels unsent code mail whose request was used, replaced, or has expired.
- Profile read returns `pendingEmailChange` (masked address and expiry). Contracts: `requestClientEmailChange`, `confirmClientEmailChange`, and `ClientProfileViewData`.
- Frontend: Contact details gains an email-change panel (new address and password, then the code); success, and a lost confirmation reply, both lead to signing in again, and the unknown case says to try the new address first, then the old one, never to replay the change.

Migration `057_email_change_requests.sql`: a new table with a partial unique index (one active request per user) and the template CHECK widened with `email_change_code` and `contact_email_changed`. It touches no existing row; the combined populated-upgrade test in step 10 covers it with the other migrations.

Verified (TESTED): contracts check 98 tests; backend check 94 files and 1127 tests (coverage 83.99% statements; the new paths are covered by the integration suite) and both boot smokes; the full integration suite passes 31 files and 350 tests; frontend check 25 files and 232 tests; both builds pass. On PostgreSQL 16, `emailChange` (10): a request sends a sealed code only to the new address, stores no plaintext target or code in any table, and shows the pending change; wrong password, another account's address, and a pending application's address are refused with nothing stored; confirmation replaces and verifies the address, bumps the revision, revokes every session and link and code and request, queues both notices, and the old access token is refused afterwards; wrong codes lock the request; an expired code is refused; a request made before the password changed is refused and retired; a newer request retires the older code; the worker guard sends a live code and cancels used or expired ones; and for both web and app sign-in, a login verified with the old address before the change commits cannot create a session. Negative controls, each restored by checksum: without the login recheck in `webAuth.ts`, then in `nativeAuth.ts`, the matching race test fails; without session revocation the confirmation test fails; without the binding check the stale-request test fails.

Not verified (UNVERIFIED): the panel in a browser, and real mail delivery.

Finding: asking to change to an address another account holds answers that it is taken, so a signed-in client can learn whether an address has an account, limited by the resend cooldown. A silent path would only defer the same answer to the confirmation.

### Step 8 handoff: admin email template catalogue (2026-10-12)

Changed:

- Migration `058_email_templates.sql` adds `email_templates` (slug, name, description, preloaded, current revision, archived time, version) and `email_template_revisions` (one immutable row per save: subject, body, author, time). The database refuses a blank or over-long name, a slug of the wrong shape, a subject over 150 characters or containing a line break, and a body over 5000 characters. It preloads five templates (welcome note, account update, support follow-up, education reminder, general team message), each starting "Hello {{first_name}}," and signed off by the shared layout. Bracketed lines mark text to replace before sending.
- Content rules (`domain/admin/emailTemplateContent.ts`): the only placeholders are `{{first_name}}` and `{{full_name}}`; any other placeholder, including a link, code, or password token, and any stray braces are refused. The subject is a single line. Password, verification, and other account emails stay in source and are not in this catalogue, and nothing here issues a token.
- Routes under `/v1/admin/email-templates`: list (optionally with archived), detail with the last 20 versions, create, save a new version (`expectedVersion` required; a stale one answers 409), archive, and restore. An archived template refuses edits. Reads need `email_templates.write` or `email_messages.send`; writes need `email_templates.write`, CSRF, and an idempotency key. Every write is audited (`email_template.created`, `revised`, `archived`, `restored`). Both codes are in the seed catalog and the frontend permission list; `email_messages.send` is added now because the read routes already accept it, and step 9 enforces it for sending.
- Contracts: six operations in `operations/admin-email.ts`. Frontend: an Email templates screen (in use or including archived), a new-template screen, and a template screen with the editor, archive and restore, and earlier versions. A save keeps the same key on a lost reply ("Check again"), and a stale save offers to load the latest version instead of overwriting.

Delivery rows are unchanged: no template key is added until step 9, and the admin delivery list already returns `templateKey` as an open string.

Verified (TESTED): contracts 98 tests; backend check 95 files and 1144 tests (coverage 84.02% statements, 84.36% branches, 90.27% functions) with both boot smokes; frontend check 25 files and 232 tests; `build:client` (17 assets, 858908 bytes, Android budget and boot check) and `build:admin` pass. On PostgreSQL 16 the integration suite passes 32 files and 362 tests; `emailTemplates` (12): the preloaded catalogue uses only allowed placeholders; create derives the slug and is audited as the admin; a header-injecting subject, an unknown placeholder, a password-link placeholder, and an empty body are refused with nothing saved; a duplicate name is refused; a new version leaves the earlier one exactly as it was; a stale version is refused; an archived template leaves the list, refuses edits, and can be restored; a support admin can neither read nor write and nothing is saved; no session gives 401. Negative control: without the write-permission check the support test fails; restored by checksum (`c74cddd3c786d930`).

Corrected belief: the integration suite's coverage gate (80% over routes, domain, and repositories) has been failing for longer than this session; earlier handoffs reported its tests, not its exit code. Measured on the same machine: 74.72% lines at `5cdc6fd` (23 files, 254 tests), 78.9% at `6774079` (31 files, 350 tests), and 79.15% lines and 77.9% branches now. Every test passes each time, and the threshold was not lowered. CI is not affected: `.github/workflows/ci.yml` runs the suite with `--coverage.enabled=false`, so only the local `npm run test:integration` exits 1. The remaining gap is mostly older admin and client routes with little integration coverage; step 10 records it for the maintainer.

Not verified (UNVERIFIED): the screens in a browser.

### Step 9 handoff: preview, test send, and send to one client (2026-10-12)

Changed:

- Preview: `GET /v1/admin/email-messages/preview?templateId=&userId=` renders the template's current version through the shared branded layout. Without a client it uses the sample name Asha Verma and says so; with a client it uses their name and returns the masked address, the address revision, whether the account can be sent mail (not a client, inactive, or suppressed after a bounce or complaint), and when the next send is allowed. It writes nothing and queues nothing.
- Send to a client: `POST /v1/admin/email-messages` takes the template, the previewed version, the client, and the previewed address revision, and nothing else; the server resolves the address. Under the client's row lock it refuses an archived or changed template, a non-client, an inactive or suppressed account, a changed address, and a second send within the cooldown (the email-verification resend cooldown). It then queues one sealed `admin_message` (subject and body with the name filled in; only the template key, a message id, and the test flag are left in the plain outbox payload) and records the send in the new `admin_email_messages` table: template, version, recipient, admin, address revision, and delivery. The send is audited as `email_message.sent`.
- Test send: `POST /v1/admin/email-messages/test` goes only to the signed-in admin's own address, uses the sample name, starts the subject with [Test], and opens with a paragraph saying it was not sent to a client. Audited as `email_message.test_sent`.
- Both sends need `email_messages.send`, CSRF, and an idempotency key. A replay returns the same message; a key used again after its replay window is refused, never sent twice.
- Worker guard `admin_message`: before sending, it cancels the mail if the recipient's address revision changed, the account is no longer active, or the template was archived or revised after the send was approved. Mail already handed to the provider cannot be recalled.
- The shared layout now turns a line break inside a paragraph into a line break in the HTML; no existing email has one, so their output is unchanged. The delivery log's template filter gains the step 5, 6, and 9 keys.
- Frontend: a Send email screen (template, client search, the exact preview in a sandboxed frame with no scripts, then Send a test to me and Send to client, each confirmed first). A lost reply keeps the same key ("Check again"); a new key needs a confirmed new attempt after checking the delivery log. The template screen links to it.

Migration `059_admin_email_messages.sql`: a new table that references the immutable template version, and the template CHECK widened with `admin_message`. It touches no existing row; step 10's combined upgrade test covers it.

Verified (TESTED): contracts 98 tests and a valid OpenAPI file; backend check 95 files and 1149 tests (coverage 84.08% statements) with both boot smokes; frontend check 26 files and 236 tests; `build:client` (17 assets, 858942 bytes, Android budget and boot check) and `build:admin` pass. On PostgreSQL 16 the integration suite passes 33 files and 374 tests; `adminEmailMessages` (12): previewing shows a marked sample or the client's name and masked address and queues nothing; markup in a template is escaped in the preview; a send queues one sealed message bound to the version and address, with no name in any plain table, audited as the admin; delivery carries the approved words, the client's name, and line breaks, with no test marking; a same-key replay sends nothing more, and the same key after its window is refused; a recipient field in the request is refused, as is a stale address revision; a template changed or archived after the preview is refused; an admin account, a suspended client, and a suppressed address are refused; a second send inside the cooldown answers 429; a test goes only to the admin with the sample name and the marking; the worker cancels a queued message whose client changed address or whose template was revised; support and onboarding admins can neither preview nor send, and a send without CSRF is refused. Renderer unit tests cover escaping, test marking, and refusal of a line break in the subject or a blank body. `SendAction.test.tsx` (4): nothing is sent before confirming; Check again resends the same key; only a confirmed new attempt changes it; a refusal is shown and the button unlocks. Negative controls, each restored by checksum: a guard that ignores the address revision fails the guard test; no address-revision check fails the stale-address test; no template-version check fails the changed-template test; no send permission fails the permission test; a new key on every attempt fails the Check again test.

Integration coverage: 79.61% lines and 78.03% branches, up from 79.15% and 77.9%; the gate is still below 80% (see the step 8 handoff).

Not verified (UNVERIFIED): the screen in a browser, and real mail delivery.

### Step 10 handoff: integrated verification and what the maintainer still does (2026-10-12)

Changed:

- `test/integration/releaseUpgrade.integration.test.ts` is the combined populated upgrade (scenario 9). It migrates a disposable PostgreSQL 16 database to 051, the v0.14.7 schema, and inserts representative data: an admin, an approved client with a credential and a verified address, an admin-created client, a suspended client, submitted and rejected applications, live, expired, and consumed password links, approval and rejection mail in queued, delivered, and cancelled states, ordinary, expired, and durable idempotency receipts, and a fund with an order, payment, allocation, contribution, and growth entry. It then applies 052 to 059 in one run. Every row of every table that existed at 051 keeps every column value exactly, and no row is added to those tables; no outbox event changes state, no send attempt or sealed payload appears, and every fence starts at 0; only live links are bound (to revision 1 and the credential version as it stood); the new tables are empty apart from the five preloaded templates; and the template CHECK accepts every new key while still refusing an unknown one.
- Synthetic review of every email (scenario 6) found one wording flaw: a link valid for a whole number of hours read "1440 minutes". Whole hours now read as hours ("24 hours", "1 hour"); minute and second wording, and so the 10-minute OTP and link text, are unchanged.
- `README.md` points to this section. `CLAUDE.md` is git-ignored, so its matching update stays on the maintainer's machine.

Verified (TESTED), the final sweep on this tree: `packages/contracts` `npm run check` exits 0 (98 tests, valid OpenAPI). `backend_controller` `npm run check` exits 0 with 95 files and 1149 tests (coverage 84.08% statements, 84.51% branches, 90.35% functions), the build, and both boot smokes. `npm run test:integration -- --coverage.enabled=false`, the CI form, exits 0 with 34 files and 380 tests; the local form passes the same 380 tests and exits 1 only on the coverage gate (79.61% lines, 78% branches; see the step 8 handoff). `frontend_stack_ts` `npm run check` exits 0 with 26 files and 236 tests; `build:client` (17 assets, 858942 bytes, Android budget and boot check) and `build:admin` exit 0. Negative control for the upgrade test: a statement appended to 059 that re-queues cancelled mail fails both history tests; the file was restored by checksum (`277c3eb63186a8df`). No container was left.

Acceptance scenarios, and where each is proven:

| Scenario | Evidence | Not covered |
| --- | --- | --- |
| 1. Creation with a stalled transport | `passwordLinkMail`: creation queues and returns; a failing queue rolls everything back; the worker sends or retries later | A real SMTP stall |
| 2. Lost creation reply, replay, resend, newest link only | `CreateClientScreen.test.tsx`, durable receipts (2a), `passwordLinkMail` cooldown and supersession, `passwordLinkAuthority` | One end-to-end run on a live stack |
| 3. Email change and session safety | `emailChange` (10), `contactOwnership` | Browser flow |
| 4. Phone change | `contactOwnership` (11) | Browser flow |
| 5. Earlier investment | `recordContribution` unit tests, durable receipts, 7a date and amount guards | Browser flow |
| 6. Every email's text and HTML | Rendered with synthetic data in this step; renderer unit tests | The HTML viewed in a mail client |
| 7. Preview, test, send | `adminEmailMessages` (12), `SendAction.test.tsx` | Browser flow, real delivery |
| 8. Worker crashes and leases | `emailDelivery`, `emailQueueMigration`, `passwordLinkMailWorker` | None beyond real SMTP |
| 9. Combined populated upgrade | `releaseUpgrade` (6) | A copy of production data |
| 10. Seed grants on the dev stack | The three codes are in the seed catalog, and superadmin receives every catalog code | Not run: it needs the dev stack |

The maintainer's remaining steps before and during the v0.15.0 release (nothing here was done):

1. Raise `VERSION` to 0.15.0 through the release flow (`release_manager/status.sh`).
2. Set `CLIENT_PASSWORD_LINK_URL` in each stack's `.env` (DEPLOY.md). Without it, admin client creation answers 503 and saves nothing.
3. Install the updated nginx site configs with the maintenance-flag check (step 11 handoff); a deploy only raises the flag the configs read.
4. After the new APK is published, raise `minimumSupportedVersion` in the app configuration so older APKs are asked to update.
5. Confirm the dev stack's `SEED_AUTH_ENABLED` and `SEED_AUTH_ALLOW_PRODUCTION` (Q-012), deploy, and check that `GET /v1/admin/session` for the seeded admin lists `clients.password_links.send`, `email_templates.write`, and `email_messages.send` (scenario 10). The codes reach the superadmin only when the deploy's seed step runs.
6. Decide Q-017: set and reset links share the 10-minute email-code lifetime.
7. Review migration 056 (step 5 handoff), the one identity change: application uniqueness now covers only submitted applications.
8. Migration 056 builds two unique indexes on `applications` without `CONCURRENTLY`, which locks writes to that table while they build; 057 to 059 create indexes only on new, empty tables.
9. Browser checks on a local or dev stack (they need a running stack, which needs separate permission): client contact details and email change, admin client creation and its password-link panel, earlier-investment entry, email templates, and the send screen; labels, focus, errors, disabled and cooldown states, confirmations, and phone-width layout.
10. A real test send to an address the maintainer controls, before any client send.
11. Optionally, more integration coverage for the older admin and client routes so the local coverage gate passes again.

### Pre-release security fixes for v0.15 (2026-10-12)

The maintainer asked for a security and bug review before the production push, then for both findings to be fixed.

Changed:

- Current-password checks are now limited per client (Q-018). `POST /v1/client/profile/phone` and `POST /v1/client/profile/email` (new in v0.15) and the existing `POST /v1/auth/password/change` share one limiter, `auth/passwordRecheckLimiter.ts`, consulted after the request is authenticated and parsed and before any password is verified. Before this, those endpoints sat under nginx's general zone (20 requests a second per address) with no per-client limit, so someone holding a stolen session could guess the password far faster than sign-in allows and then move the account to an address they control, and any signed-in client could test whether another customer's email or phone is registered, because "already used" is answered before any cooldown. The app's messages for these refusals now say to wait.
- Dependencies with published advisories: backend `fastify` 5.12.1 to 5.12.5 and `nodemailer` 9.0.5 to 10.1.0 (10.x is needed to close every advisory; its breaking changes are Node 20 or later, which the stack already runs, and bundled types, so `@types/nodemailer` was removed), with `fast-uri` 3.1.6 and 4.1.3 moved to 3.1.8 and 4.2.2 within their ranges; frontend `@capacitor/android`, `@capacitor/core`, `@capacitor/cli`, and the transitive `@capacitor/ios` 8.5.0 to 8.5.3 (GHSA-rvm3-566m-v7fv: remote content at the app origin through the internal HTTP proxy path, which needs an attacker-controlled link activated inside the WebView; no such link is rendered today, and every client installs the new APK anyway). Installs ran in a one-shot `node:22` container with npm 11.16.0, the versions the project and CI pin. `npm audit --omit=dev` now reports no vulnerabilities in the backend, the frontend, or contracts.

Reviewed and unchanged (STATIC unless marked): every new admin write requires CSRF and its permission, and every read a permission; the client cookie channel requires CSRF on every unsafe method; both name entry points refuse control characters, so a name cannot break a subject; the only HTML rendered from the server is the fully sandboxed email preview; no new log line carries an address, code, or token; v0.15 added no dependency. VPS (read-only, authorized): the production schema dump matches a fresh database migrated to 051 line for line after comments are removed, so 052 to 059 meet the same schema on production as on dev and in `releaseUpgrade`.

Verified (TESTED): backend check 95 files and 1149 tests (coverage 84.11% statements) with the build and both boot smokes; the integration suite in its CI form passes 34 files and 381 tests, including the new `emailChange` case: five wrong guesses spread over the three endpoints are refused with 401, then the right password is refused with 429 on all three with the credential and email unchanged, while another client is unaffected. Frontend: 26 files and 236 tests, typecheck, lint, and `build:android` and `build:android:admin` with the size, boot, and native PhonePe guards. Negative control: with the limiter call removed from the password-change route alone, the new test fails; restored by checksum (`f11780a80e5460d8`).

Not verified (UNVERIFIED): a Gradle build of the APKs against Capacitor 8.5.3 (the export builds them), and real SMTP through nodemailer 10 (a test send after the next dev deploy covers it).

