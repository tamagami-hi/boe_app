# PostgreSQL and TypeScript Rearchitecture Plan

## Decision-complete companion specifications

This plan is the delivery outline. The following approved companion documents
are normative wherever this outline abbreviates a schema, lifecycle, API,
security, testing, rollout, or product decision. If wording here is less
specific, implement the companion specification; resolve any true conflict in
the documents before writing runtime code.

- [Product and architecture decisions](./02-product-architecture-decisions.md)
  defines the product boundary, source-of-truth map, migration/cutover policy,
  exact maker-checker action set, phase gates, and deployment ADR.
- [Schema and lifecycle specification](./03-schema-lifecycle-specification.md)
  defines canonical PostgreSQL types/tables/constraints, derived eligibility,
  transitions, lock ordering, project repository interfaces, and legacy-table
  disposition.
- [API, security, and test specification](./04-api-security-test-specification.md)
  defines the first-slice wire contract, authentication/CSRF/cookie policy,
  RBAC, idempotency, SES/SNS processing, dependency-reuse workflow, coverage,
  and per-slice review gates.
- [System, TypeScript, tooling, and contract architecture](./05-system-tooling-diagrams.md)
  defines the system diagrams, package/install boundaries, mixed-JS/TypeScript
  migration rules, single OpenAPI/typed-client pipeline, exact tooling pins,
  CI dependency graph, and phase-specific tooling acceptance gates.

## 1. Architecture and Product Decisions

- Keep one PostgreSQL database and one backend, organized by business domain.
- Replace the whole-store `pgAdapter.js` with explicit Kysely repositories implemented directly in strict TypeScript.
- Treat landing signup as an application, not an authenticated learner account:
  - Collect name, normalized email, E.164 phone, and versioned consent.
  - Require email verification before admin review.
  - Create the user and activation invitation only after approval.
  - Create the password during activation; remove pre-approval username/password credentials.
  - Collect KYC and risk information after authenticated activation.
- Keep the `/v1` namespace and response envelope, but replace unsafe signup/auth contracts because no installed APK compatibility is required.
- Retain the custom router during the first vertical slice. Migrate to Fastify only after the slice passes contract tests, using route-parity tests as the compatibility boundary.
- Use additive target migrations during vertical migration. Replace the migration history with one clean baseline only after all legacy table dependencies are removed.
- Treat pool/AUM as a dated, admin-published snapshot—not an accounting ledger. Do not implement a fake double-entry ledger.
- Use Amazon SES with an outbox worker and signed SNS delivery/bounce/complaint events.
- Target direct APK distribution through an official HTTPS download page, signed artifacts, published checksums, minimum-version metadata, and verified Android App Links.
- Implement domain RBAC for `superadmin`, `onboarding`, `finance`, `content`, and `support`; the initial MVP admin receives every permission.
- Apply maker-checker only to the closed six policy categories in
  [02, section 7](./02-product-architecture-decisions.md#7-maker-checker-policy):
  every investable fund/term publication; resume or archive of a fund that is
  or was published; published NAV/AUM correction; booked-order reversal;
  above-threshold redemption approval; and runtime role/permission grant,
  revocation, or mapping changes. Ordinary onboarding, provider transitions,
  refunds, mandates, settlements, account actions, position corrections,
  content publication, and emergency fund pause do not use maker-checker.
- Postpone support tickets and generated receipts/statements. Preserve authoritative transaction data and document metadata extension points.

### Documentation baseline

Phase 0 must reconcile and update `PRODUCT.md`, because its learner-account model conflicts with the handoff. Approved implementation APIs must be checked against:

- Fastify v5 TypeScript and schema/type-provider documentation.
- Kysely transactions, PostgreSQL locking, migrations, and generated database types.
- `jose` v6 `SignJWT` and `jwtVerify`.
- Node Argon2 using `argon2id`.
- Capacitor v8 `App.getLaunchUrl()`, `appUrlOpen`, and `appRestoredResult` APIs ([Capacitor App API](https://capacitorjs.com/docs/apis/app), [deep-link guide](https://capacitorjs.com/docs/guides/deep-links)).
- AWS SES v2 and SNS signature-verification documentation.

The repository methods in this plan and
[03, section 7](./03-schema-lifecycle-specification.md#7-project-repository-interfaces)
are intentionally project-defined domain interfaces; they are not claims about
Kysely. Third-party APIs—including Fastify plugins, Kysely clauses, Capacitor
hooks, SES/SNS parameters, and package integrations—must exist in the selected
version's primary vendor documentation. Follow the dependency research,
licensing, registry/security review, pinning, and narrow-adapter workflow in
[04, section 7](./04-api-security-test-specification.md#7-openapi-and-typed-client-pipeline)
before selecting or upgrading a package.

## 2. Canonical Model, Interfaces, and Lifecycles

### Domain tables

- Identity and onboarding:
  `applications`, `application_details`, `application_consents`, `application_reviews`, `verification_tokens`, `users`, `user_credentials`, `activation_invites`, `auth_sessions`.
- Administration:
  `roles`, `permissions`, `role_permissions`, `user_roles`, `approval_actions`, `audit_events`.
- Compliance:
  `investor_profiles`, `kyc_cases`, `kyc_documents`, `kyc_reviews`,
  `risk_assessments`. Investing eligibility is derived at read/command time and
  is never stored in a table, status column, configuration, JWT claim, or
  client-owned row.
- Catalog:
  `funds`, `fund_disclosure_versions`, `fund_nav_prices`, `fund_positions`, `fund_aum_snapshots`.
- Investing:
  `sip_plans`, `investment_orders`, `investment_executions`, `holdings`, `holding_lots`.
- Payments:
  `payments`, `payment_attempts`, `mandates`, `provider_events`.
- Platform:
  `idempotency_records`, `outbox_events`, `email_deliveries`, `notifications`, versioned site content and configuration.
- Postponed:
  support tables, generated documents, portfolio performance snapshots, and accounting journals.

Use integer paise for INR amounts, scaled PostgreSQL `numeric` for NAV and units, and string/decimal representations in TypeScript. Never convert database monetary values to JavaScript `Number`.

### Current-table disposition

- Merge `products`, `funds`, and `app_config_versions.mobile.products` into authoritative `funds`; configuration retains presentation and feature flags only.
- Split `investment_plans` into recurring `sip_plans`; merge purchase/redemption intent from `transactions` and `orders` into `investment_orders`.
- Replace booked transaction results with immutable `investment_executions`.
- Replace dynamic `portfolio_<userId>` and `portfolio_snapshots` ownership with `holdings` and `holding_lots`.
- Replace payment/mandate webhook tables with `provider_events`.
- Replace `admin_audit_logs` with append-only `audit_events`.
- Derive client timeline views from orders, executions, payments, notifications, and audit-safe events.
- Remove `receipts`, `timeline_events`, `capital_transactions`, `withdrawal_previews`, duplicate disclosures, and JSON parity tables after their consumers are migrated.
- Rename landing `plans` to `membership_plans`.
- Archive the old migration chain only as historical reference after the clean baseline is verified.

### Canonical transitions

- Application:
  `pending_email_verification → submitted → in_review → approved | rejected`; `pending_email_verification | submitted → withdrawn`.
- User:
  `invited → active → suspended → active | closed`; `closed` is terminal.
- Activation invite:
  `pending → accepted | revoked`; expiry is derived from `expires_at`. Resend revokes the current invite and creates a replacement.
- Email delivery:
  `queued | retryable_failed → sending → sent → delivered`; pre-acceptance
  failures transition to `retryable_failed` or `permanent_failed`, and obsolete
  unsent work transitions to terminal `cancelled`. `outbox_events` alone owns
  claim, lease, due time, attempt count, retry schedule, and terminal transport
  result; `email_deliveries` is provider/business evidence and never schedules
  a resend. A short transaction locks outbox/delivery/token or invite and commits
  both rows as `sending` before SES; that commit is the point of no return.
  Revocation before it cancels with a token/invite-specific code; revocation
  after it leaves any delivered bearer invalid. A signed post-acceptance reject/bounce/complaint cannot move a
  delivered outbox back to retryable work.
- Auth session:
  `active → revoked | expired`; every refresh persists the client-generated
  rotation ID, rotates opaque refresh and web CSRF pairs, and keeps the previous
  pair/key versions for one 30-second ambiguous-retry grace. Same-pair/same-ID
  retry reproduces the successor; different-ID, expired, or older reuse revokes
  the entire family.
- KYC:
  `pending_submission → submitted → in_review → approved | rejected | needs_information`.
- Risk:
  `not_started → submitted → assessed`. Derived eligibility follows
  [03, section 2.3](./03-schema-lifecycle-specification.md#23-derived-investing-eligibility):
  closed/suspended users yield `suspended`; any other non-active account yields
  `blocked`; missing, unapproved, or expired KYC or missing/unassessed risk
  yields `pending_compliance`; only an active user with current approved KYC
  and assessed risk yields `eligible`. Investment commands lock and re-read
  those prerequisites before acceptance.
- Fund:
  `draft → review_pending → published → paused | archived`; every first or
  later immutable investable fund/term publication requires maker-checker,
  without a sensitivity flag or ordinary-publication bypass. Resume and archive
  after publication and published NAV/AUM correction also require it; emergency
  pause, a never-published draft/review archive, position correction, and a
  current-date first NAV/AUM observation use ordinary authorized transitions.
- SIP:
  `draft → pending_mandate → active → paused → active | cancelled | completed`.
- Order:
  `submitted → payment_pending → payment_confirmed → booked`; failure branches are `payment_failed`, `cancelled`, `rejected`, `refunded`, or `reversed`.
- Payment attempt:
  `created → provider_pending → succeeded | failed | expired`; refunds produce separate immutable provider evidence.
- Mandate:
  `created → pending_user_authorization → active → paused | revoked | failed | expired`.
- Redemption:
  `submitted → units_reserved → approved → settlement_pending → settled`; rejection or cancellation releases reservations.
- Provider event:
  `received → processing → processed`; retryable errors return to `received`, exhausted errors become `dead_lettered`.

Later finance uses immutable `holding_lot_movements` as the economic trail.
Booking, redemption settlement, and an approved reversal append executions and
movements and update holding/lot projections in one transaction; originals are
never edited. NAV/units use scale 8 with round-half-to-even exactly once,
partial-lot cost basis assigns the aggregate paise residual to the last FIFO
lot, confirmed-funds rejection starts a refund workflow, and a refund is
separate immutable provider/execution evidence rather than a mutation of the
original booking.

Every transition records actor, reason, prior state, timestamp, request ID, and version. Use guarded updates or row locks; invalid and conflicting transitions return deterministic `409` errors.

### Repository and transaction boundary

Repositories accept a Kysely transaction object and return new immutable domain
values. Every list is keyset-cursor paginated with an explicit maximum (100 or
the smaller domain bound). Required interfaces include:

```ts
applicationRepository.createSubmission(tx, input)
applicationRepository.lockById(tx, applicationId)
applicationRepository.findQueuePage(tx, query)
applicationRepository.findDetail(tx, query)
applicationRepository.findActiveIdentityCollisions(tx, identifiers)
applicationRepository.markEmailVerified(tx, applicationId, verifiedAt)
applicationRepository.recordDecision(tx, decision)
userRepository.createFromApprovedApplication(tx, application)
activationInviteRepository.revokeCurrent(tx, userId, reason)
activationInviteRepository.create(tx, invite)
activationInviteRepository.lockByTokenHash(tx, tokenHash)
credentialRepository.create(tx, userId, argon2Hash)
userRepository.lockByNormalizedEmailWithCredential(tx, email)
authSessionRepository.lockActiveBySid(tx, sid)
authSessionRepository.lockActiveNativeByUserAndDeviceHash(tx, query)
authSessionRepository.rotate(tx, command)
emailDeliveryRepository.findPage(tx, query)
retentionRepository.findEligibleCleanupPage(tx, query)
outboxRepository.enqueue(tx, event)
auditRepository.append(tx, event)
```

Atomic transactions must cover:

1. Application, consent, hashed verification token, and verification-email outbox.
2. Verification-token consumption and review-queue transition.
3. Approval: locked application, review, user, invite, audit, and SES outbox.
4. Invite resend and prior-token revocation.
5. Activation and Argon2id credential creation.
6. Refresh rotation and token-family reuse revocation.
7. Email pre-send validation and committed `sending` point before SES.
8. Fund and disclosure publication.
9. Idempotent order creation.
10. Provider-event inbox insertion.
11. Payment start: payment, attempt one, provider outbox, and order transition.
12. Payment success, execution, holding/lot update, notification, and audit.
13. Redemption reservation, rejection release, and settlement consumption.
14. Content publication.

External SES and Razorpay calls occur only outside database transactions through outbox/inbox workers.
Every outbox row supplies the complete versioned envelope defined in `03`:
`id`/internal `eventId`, `topic`, `event_type`, `event_version`, `aggregate_type`, `aggregate_id`,
`occurred_at`, `request_id`, nullable `causation_id`, nullable workflow
`correlation_id`, unique `deduplication_key`, and typed `payload`.

## 3. API and Client Contracts

Use Zod as the request, response, environment, and provider-data boundary. Generate OpenAPI and typed clients from shared contracts.

### First-slice endpoints

- `GET /v1/public/consent-documents`
- `POST /v1/applications`
- `POST /v1/applications/verify-email`
- `GET /v1/admin/applications`
- `GET /v1/admin/applications/:applicationId`
- `POST /v1/admin/applications/:applicationId/review`
- `POST /v1/admin/applications/:applicationId/decision`
- `POST /v1/admin/users/:userId/activation-invites/resend`
- `GET /v1/admin/email-deliveries`
- `POST /v1/activations/complete`
- `POST /v1/auth/native/login`
- `POST /v1/auth/native/refresh`
- `POST /v1/auth/native/logout`
- `POST /v1/auth/web/login`
- `GET /v1/auth/web/csrf`
- `POST /v1/auth/web/refresh`
- `POST /v1/auth/web/logout`
- `POST /v1/provider-events/aws-sns`

This list is exhaustive: first-slice withdrawal is an authenticated internal
application-service command only, not a public HTTP route. General courses,
membership plans, FAQs, and content authoring remain deferred; only immutable
terms/privacy consent documents are first-slice content.

Preserve the envelope `{ ok, data, error, meta }` and stable machine-readable error codes.

- Browser admin uses the synchronizer-token design and exact cookie/CSRF policy
  in [04, sections 3.4 and 4.3](./04-api-security-test-specification.md#34-browser-admin-authentication-and-csrf):
  `__Host-boe_access` and `__Host-boe_refresh` are `HttpOnly; Secure;
  SameSite=Lax; Path=/` with no `Domain`; access `Max-Age` is 600 seconds and
  refresh `Max-Age` cannot exceed its remaining idle/absolute lifetime.
  Successful login/refresh and the authenticated CSRF recovery route return a
  rotating synchronizer token held only in browser memory. Cookie-authenticated
  unsafe methods require `X-CSRF-Token`, constant-time session-hash comparison,
  exact Origin (or exact Referer fallback), Fetch Metadata checks, and exact
  credentialed CORS allowlisting. Refresh tokens never appear in JSON.
- Access JWTs use ES256 only, a versioned protected-header `kid`, current
  PKCS#8 private signing PEM, and current/retired SPKI public verification PEMs.
  Every protected native/admin request rechecks `sid`, channel, active session,
  account state, and current permission in PostgreSQL for immediate revocation.
- Capacitor uses a short-lived bearer access token held only in memory and an opaque rotating refresh token stored through `platformStorage.secure`.
- Native refresh is single-flight. Native and web refresh accept one
  client-generated `rotationId` per logical rotation; an ambiguous retry uses
  the same token/cookie and ID so the server deterministically reproduces the
  committed successor. Web retry also presents the saved previous CSRF token;
  CSRF recovery accepts only a current refresh cookie and cannot bypass consumed
  token reuse. Web tabs coordinate through a same-origin lock/channel
  and share the reproduced CSRF result; a concurrent tab never invents a
  second ID for the same cookie generation.
- Logout awaits server revocation before local cleanup, with local cleanup guaranteed in `finally`.
- Landing accesses the backend through its same-origin Next.js BFF.
- Email delivery reads authorize either `email_deliveries.read` for the full
  safe administrative projection or `email_deliveries.read_masked` for a
  strictly masked support projection with no subject/SES/provider/crypto detail.
- Proxy trust is route-aware: nginx overwrites internet-supplied forwarding
  headers; direct nginx-to-API routes trust only that one verified hop; landing
  BFF routes accept the preserved original client IP only from an authenticated
  internal landing source and never from client-controlled forwarding headers.
- Every client-owned query includes `user_id` in SQL and never filters ownership after loading records.

### Android/direct APK

- Host an official HTTPS download page and version manifest containing version, minimum supported version, SHA-256 checksum, signing-certificate fingerprint, release date, and APK URL.
- Publish `assetlinks.json` for activation, password reset, payment return, and mandate return paths.
- Put verification and activation bearer secrets only in the URL fragment.
  The verification page may remove its fragment and POST verification. The
  activation fallback never calls the native completion route: it offers APK
  download and “Open BeOnEdge” while preserving the fragment for the installed
  Capacitor client, which alone supplies password/device data and stores native
  refresh credentials. Fallback responses set `Referrer-Policy: no-referrer`,
  load no third-party resources, exclude/redact these paths from analytics, and
  nginx logs record no query/fragment-bearing request target.
- Handle cold-start links with `App.getLaunchUrl()` and warm links with `appUrlOpen`.
- Use `appRestoredResult` only for restoration of an interrupted Capacitor
  plugin call. Normal application/payment/mandate workflow resumption persists
  only a non-sensitive local workflow ID and refetches authoritative server
  state; it does not misuse the plugin callback as a general lifecycle event.
- Disable cleartext and mixed content in release builds.
- Exclude refresh tokens, activation state, PIN/biometric metadata, and device identifiers from Android backup and device transfer.

## 4. Delivery Phases

1. **Planning and architecture**
   - Produce the PRD, PostgreSQL ADR, diagrams, vocabulary/ownership map, state-machine catalog, ERD/schema specification, table disposition matrix, API fixtures, security model, worktree map, and deployment ADR.
   - Reconcile `PRODUCT.md` with application-first onboarding.
   - Approval gate: every MVP screen and endpoint maps to one authoritative domain source.

2. **Test and TypeScript foundation**
   - Standardize development, CI, Docker, and VPS on Node `>=22.19.0 <23`.
   - Add strict TypeScript, `tsx`, production `tsc`, Vite-5-compatible Vitest/coverage, linting, Zod, Kysely types, `jose`, Argon2id, phone normalization, structured logging/redaction, and the single Zod → committed OpenAPI → `openapi-typescript` → `openapi-fetch` contract pipeline.
   - Compile the complete backend `src` tree with `allowJs: true`,
     `checkJs: false`, build `rootDir: src`, and `outDir: dist`. Conditional
     package imports resolve legacy `#` aliases to `src` only under the
     `development` condition and to `dist` by default. New TypeScript uses
     NodeNext-relative `.js` specifiers without requiring an immediate
     `server.ts` conversion.
   - Keep every existing `node:test` suite unchanged and running alongside new
     Vitest suites. Enforce 80% statements, branches, functions, and lines on
     new or changed TypeScript packages; merge or replace a legacy module's
     coverage only when that module is converted.
   - Accept this phase on the foundation harness, deterministic
     generation/staleness check, typecheck, lint, both test runners, coverage
     configuration, source-mode and emitted-mode smoke tests, production build,
     and basic backend/landing image build-start smoke using database-independent
     `/health/live` and a BFF proxy-to-live endpoint without PostgreSQL. Do not switch the
     live entrypoint or make an image `dist`-only until both runtime smoke tests
     pass. Later repository, transaction, provider, E2E, Android, and worker
     test plans/fixtures may be committed, but enabled known-failing tests may
     not. RED is observed when the owning slice begins and must become GREEN
     before that slice/phase is accepted.
   - Before changing release builds, narrowly track the source release scripts,
     libraries, Compose template, and public examples needed by Phase 2 while
     keeping local environments, images, dumps, manifests, and rollback state
     ignored. A broad `release_manager/` unignore is forbidden.
   - Treat every Phase 2 and Phase 3 image as an isolated, non-production build
     artifact. Local `docker save`/OCI-layout archive creation is allowed only
     inside isolated rehearsal so archive integrity can be tested; the artifact
     remains local and is marked non-release. Do not transfer, deploy to VPS,
     publish, or route external traffic to it until Phase 4 replaces the reachable legacy HS256/environment-admin
     backend paths and Phase 5 replaces insecure client token storage, with both
     phases' security gates passing. Pin release base images by digest and make
     rehearsal verify the local image ID/config digest plus SHA-256 for each
     archive and manifest. Record `RepoDigest` only after an actual registry
     push/pull; an OCI-layout export instead records its manifest digest.

3. **Additive canonical identity schema**
   - Add applications, identity, session, RBAC, audit, idempotency, outbox, and email tables alongside legacy tables.
   - Implement typed database models and repositories.
   - Introduce the PostgreSQL repository and transaction harness with exact
     `testcontainers@12.0.4` and `@testcontainers/postgresql@12.0.4` pins and the
     documented `PostgreSqlContainer` API; verify constraints, indexes, rollback
     behavior, concurrency, normalized uniqueness, and restricted deletion.

4. **First backend vertical slice**
   - Implement application submission, email verification, admin review, approval/rejection, SES delivery, invite resend, activation, native/web login, refresh rotation, logout, and authorization.
   - Retire direct user creation from landing signup.
   - Keep the custom router only as the transport adapter, but implement the
     complete first-slice security contract now: strict Zod boundary/output
     validation, request IDs, stable safe errors, payload/content-type limits,
     secure cookies and synchronizer CSRF, exact CORS, RBAC, database-backed
     idempotency, rate limits, raw-body SNS validation, signature checks,
     redacted structured logging, and secret startup validation. None of these
     controls waits for Fastify.
   - Acceptance gate: the complete handoff flow passes with concurrent approvals, duplicate submissions, expired tokens, SES failure, and rollback cases.

5. **Surface and Android cutover**
   - Landing worktree: replace credential signup with application/verification UI.
   - Admin worktree: application queue, reasoned decisions, delivery inspection, and resend.
   - Client worktree: activation, secure native sessions, direct-APK links, deep links, and restoration.
   - Activate cross-surface E2E, Android, and release-image behavior gates here,
     after their runtime surfaces exist. This extends, rather than postpones,
     the basic image build-start-health gate established when shared contracts
     are introduced in Phase 2.
   - Integrate shared contracts and backend changes only through `main`.

6. **Fastify transport migration**
   - Preserve the already-enforced `/v1` envelopes, error codes,
     authorization, CORS, cookies, CSRF, security headers, rate limiting,
     request IDs, raw webhook bodies, validation, and logging while changing
     the transport; add Fastify/Helmet integration without weakening behavior.
   - Port one route group at a time with parity tests; remove the custom router only after every route is accounted for.

7. **Catalog and content**
   - Establish authoritative funds, NAV, positions, disclosures, and AUM
     snapshots first. Courses, membership plans, and general versioned content
     remain later Phase 7 work; the first slice creates only the immutable
     `consent_documents` content needed by signup evidence.
   - Remove products from application configuration.

8. **Financial vertical slices**
   - Implement in order: one-time order → payment attempt → provider event → execution/allotment → holdings/lots → SIP/mandate → redemption.
   - Before Phase 8 approval, enforce `payments (id, user_id)` uniqueness for
     the attempt ownership FK; make `beginPayment` create payment, attempt one,
     and provider outbox atomically; make `sendPaymentToProvider` consume that
     attempt without creating another; require refund money/provider evidence
     with null NAV/units; preserve append-only lot movements/projections; and
     book the linked order atomically on redemption settlement.
   - Apply maker-checker only to the covered actions and separation-of-duty
     invariants in [02, section 7](./02-product-architecture-decisions.md#7-maker-checker-policy).
   - Do not add accounting journals unless a later custody/AUM decision establishes a real accounting requirement.

9. **TypeScript completion and cleanup**
   - Convert shared Vite services/platform code, client, admin, and remaining backend modules.
   - Make landing consume generated shared contracts.
   - Disable `allowJs`; remove JS/JSX, compatibility adapters, JSON parity persistence, duplicate tables, and dead routes.

10. **Clean baseline and release**
    - Generate and independently review a clean migration baseline.
    - Recreate an empty database, seed it, run all suites, export/deploy through the release manager, and verify the direct APK.
    - Preserve the prior deploy bundle and database dump as rollback artifacts.

## 5. Verification, Security, and Acceptance

- Follow RED → GREEN → REFACTOR for every slice.
- Apply the complete review gate in
  [04, section 9](./04-api-security-test-specification.md#9-per-slice-review-and-release-gates)
  separately to application submission, verification, review,
  activation/email, web auth, native auth, and each later domain slice. Every
  slice requires general code review, TypeScript review, and security review;
  CRITICAL/HIGH findings block integration, and the affected test/coverage
  matrix must be rerun after fixes with commands/results recorded.
- Before new implementation or dependency selection, follow the reuse workflow
  in [04, section 7](./04-api-security-test-specification.md#7-openapi-and-typed-client-pipeline):
  search maintained GitHub implementations first, inspect package-registry
  metadata/security/license posture, verify the exact API in primary vendor
  docs, record the selected version and rejected alternatives, and prefer a
  compatible maintained dependency or narrow adapter over hand-rolled code.
- Maintain at least 80% statements, branches, functions, and lines in each changed package, with 90% branch coverage for the security/queue modules named in `04`. Exclude only generated OpenAPI types and declarative migration files.
- Unit tests: Zod schemas, normalization, immutable transition guards, money/decimal helpers, token hashing, JWT claims, and RBAC.
- PostgreSQL integration tests: constraints, ownership, transactions, row locks, concurrent approval/refresh, idempotency, outbox claims with `SKIP LOCKED`, retries, and rollback.
- API tests: envelopes, error codes, cookies, CSRF, bearer separation, role permissions, rate limits, and sensitive-data redaction.
- E2E tests: application → verification → admin approval → SES event → activation → native sign-in → refresh → logout; fund publication; purchase/allotment; SIP/mandate; webhook retry; redemption.
- Android tests: secure storage, cold/warm App Links, expired activation, process death, restoration, offline retry, release HTTPS policy, backup exclusions, version manifest, APK checksum, and signature verification.
- Security gates: no secrets in bundles, hashed single-use tokens, Argon2id credentials, SES/SNS signature validation, Razorpay raw-body verification, parameterized SQL, least-privilege database grants, PII encryption/redaction, CSP/CORS/CSRF controls, and distributed rate limiting.
- Retention gates match `03` exactly and honor active holds on the entity or its
  retention-owning parent: unverified application PII tombstones at 30 days;
  rejected/withdrawn and closed-user plus linked approved-application direct PII
  at 180 days; normalized identifiers become reusable tombstones; closure erases the
  credential hash immediately. Holds use the typed application/user/delivery/
  provider-event/audit/investor-profile/KYC/risk/marketing-lead/order/payment/mandate allowlist
  and declared child propagation; consent/audit evidence remains pseudonymous for
  its evidence period. Consent-IP, rate-limit, and suppression HMACs use
  distinct versioned keys.
- Performance gates: indexed admin queues and worker scans, bounded pagination, no whole-table reads, no N+1 queries, explain plans for critical queries, and load tests for login, application submission, queue polling, and webhook bursts.
- Each phase must leave the repository buildable and internally acceptable. From the phase
  that introduces `packages/contracts`, both backend and landing images build
  from repository-root contexts, start, and pass health smoke before the phase
  passes its internal gate. Production release eligibility remains blocked
  until the Phase 4/5 security boundary passes. A failed phase rolls back its route/config switch while
  retaining additive schema objects until final cleanup.

## Assumptions

- There is no production data or installed APK population to preserve.
- The first application collects only name, email, E.164 phone, and versioned legal/privacy consent.
- Email verification precedes admin review; password and KYC are deferred until activation.
- Amazon SES, SNS delivery events, and the official sending domain are available before first-slice acceptance.
- Direct APK distribution uses an official HTTPS domain and the existing release manager.
- Support tickets and generated documents are not MVP requirements.
- AUM is presentation data, so double-entry accounting is postponed.
