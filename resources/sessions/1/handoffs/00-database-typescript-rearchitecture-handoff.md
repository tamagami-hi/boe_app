# Planning Handoff: PostgreSQL and TypeScript Rearchitecture

## Purpose

This document is the complete context handoff for a planning agent. The planning
agent must turn the agreed direction below into implementation-ready planning
artifacts. It must inspect the repository before finalizing the plan, challenge
weak assumptions, and keep the design aligned with the actual landing, admin,
client, backend, Capacitor, and release workflows.

This is a planning task. Do not implement code, rewrite migrations, install
packages, rename files, or modify runtime behavior while producing the plan.

## Executive Summary

BeOnEdge currently has three application surfaces over one backend:

- A Next.js public landing site for education, application submission, and
  applicant information gathering.
- A browser-based admin portal for application review, approval, fund/catalog
  management, finance operations, support, content, and audit workflows.
- A React/Vite client packaged as an Android application with Capacitor and
  Gradle. Approved users install this application and sign in to access funds,
  investments, payments, mandates, holdings, transactions, notifications, and
  related client workflows.

The project is still under development. There is no production data that must
be preserved. Old JavaScript files and the existing migration chain may be
removed after their replacements are verified.

The confirmed architectural direction is:

1. Keep PostgreSQL. Do not migrate to MongoDB.
2. Redesign the database schema before implementing the wider JavaScript to
   TypeScript migration.
3. Do not rewrite the database access layer in JavaScript and then rewrite it
   again in TypeScript. The new repositories must be implemented directly in
   TypeScript against the new PostgreSQL schema.
4. Use one PostgreSQL database and one backend. Organize persistence by business
   domain, not by frontend surface.
5. Keep the landing site on Next.js.
6. Keep the admin, client, and landing worktrees and their surface ownership.
7. Replace suitable custom infrastructure with established libraries, while
   retaining explicit domain logic for approvals, sessions, payments, holdings,
   accounting, and state transitions.
8. Implement and validate one vertical slice at a time. The first slice should
   cover landing application submission through client activation and sign-in.

## Confirmed Product Flow

The following flow supersedes ambiguous behavior in the current implementation:

1. A prospective user visits the public landing site.
2. The landing site gathers the signup/application information.
3. The applicant verifies ownership of their email address.
4. The submitted application appears in the admin portal.
5. An administrator reviews the application and approves or rejects it.
6. Approval creates the client identity/account and a one-time activation
   invitation in one database transaction.
7. The backend queues an approval email from the official company email domain.
8. A backend worker sends the email. The admin browser never receives SMTP or
   email-provider credentials.
9. The email contains the official app download/Play Store link and a one-time
   activation link or activation code.
10. The approved user installs the Capacitor Android client.
11. The user activates the account, creates a password if password creation is
    deferred until activation, and signs in from the client application.
12. The backend creates a revocable device session. The native application
    keeps the short-lived access token in memory and the rotating refresh token
    in native secure storage.

An application and an authenticated user are intentionally separate records.
Rejected applicants should not leave active credentials or device sessions.
Every approved application may create exactly one user.

## Confirmed Boundaries

### Landing

Landing is an education and application surface. It may:

- Read published education and company content.
- Submit marketing leads.
- Submit user applications.
- Verify applicant email addresses.
- Display submission/verification outcomes.

Landing must not read or write funds, holdings, orders, payments, mandates,
ledger records, or another applicant's information.

### Admin

Admin is a privileged control plane over shared domain data. It may:

- Review and decide applications.
- Resend or revoke unused activation invitations.
- Suspend or close client accounts.
- Review KYC and risk information where those workflows are in scope.
- Publish funds, NAV, disclosures, and fund composition.
- Review payments, mandates, redemptions, support work, and audit history.
- Publish landing and application configuration/content.

Admin does not own a duplicate copy of client or landing records. It changes the
authoritative records through protected backend endpoints.

### Client

Client is the authenticated Android application. Only approved and activated
users may sign in. A client may:

- Read published funds and disclosures.
- Create SIP and one-time investment requests.
- Complete payments and mandate authorization.
- Read only their own holdings, orders, payments, mandates, transactions,
  notifications, support records, and documents.
- Request SIP changes or redemptions where enabled.

### Database Access

Only the backend connects to PostgreSQL. The Next.js landing site may use a BFF
or same-origin proxy, but the landing, admin, and Capacitor bundles must never
contain database credentials or connect directly to PostgreSQL.

## Repository Topology

The repository has four Git worktrees including the integration checkout:

- `/home/nethunter07/PROJECTS/boe_app`: `main`, full integration and release
  checkout.
- `/home/nethunter07/PROJECTS/boe_app-admin`: `wt/admin`.
- `/home/nethunter07/PROJECTS/boe_app-client`: `wt/client`.
- `/home/nethunter07/PROJECTS/boe_app-landing`: `wt/landing`.

The required operating model is documented in `WORKFLOW.md`:

- Surface-specific work happens in the corresponding sparse worktree.
- Shared contracts, backend, database, build tooling, and migration work must be
  integrated centrally through `main`.
- Releases happen only from the main checkout.
- Shared commits should land once and then be merged/rebased into the surface
  branches. Do not independently redesign shared schemas, manifests, lockfiles,
  or API types in all three worktrees.

## Current Stack and Scale

- Backend: Node.js ESM, custom HTTP router, PostgreSQL `pg`, Razorpay.
- Client/admin: React 18, Vite, npm workspaces.
- Landing: Next.js 14, React 18, TypeScript, Vitest.
- Native client: Capacitor 8, Android/Gradle.
- Existing native dependencies include Capacitor App, Browser, Android, secure
  storage, and biometric support.
- The repository contains approximately 280 JavaScript/JSX files and 60
  TypeScript/TSX files.
- Backend source contains approximately 84 files.
- Automated coverage is thin: five backend test files and four frontend test
  files were found during the architecture review.

The landing application is already predominantly strict TypeScript. The largest
conversion work is the backend, shared Vite packages, client, and admin.

## Current Sources of Truth to Inspect

The planning agent must read at least:

- `PRODUCT.md`
- `WORKFLOW.md`
- `resources/db_schema/db.schema.md` (the actual filename is `schema`, not
  `shema`)
- `backend_controller/db/migrations/001_core_identity_onboarding.sql`
- `backend_controller/db/migrations/002_products_nav_disclosures.sql`
- `backend_controller/db/migrations/003_investments_payments_ledger_statements.sql`
- `backend_controller/db/migrations/005_json_collections_parity.sql`
- `backend_controller/db/migrations/007_courses_and_plans.sql`
- `backend_controller/db/migrations/008_request_idempotency.sql`
- `backend_controller/src/http/router.js`
- `backend_controller/src/http/validate.js`
- `backend_controller/src/http/idempotency.js`
- `backend_controller/src/db/pgAdapter.js`
- `backend_controller/src/security/auth.js`
- `backend_controller/src/security/tokens.js`
- `backend_controller/src/security/passwords.js`
- `backend_controller/src/shared/routes/authRoutes.js`
- `backend_controller/src/shared/services/authService.js`
- `backend_controller/src/website/services/onboardingService.js`
- `backend_controller/src/client/routes/clientRoutes.js`
- `backend_controller/src/admin/routes/adminRoutes.js`
- `backend_controller/src/client/services/sipService.js`
- `backend_controller/src/client/services/orderService.js`
- `backend_controller/src/admin/services/paymentReconcileService.js`
- `backend_controller/src/shared/services/webhookService.js`
- `backend_controller/src/shared/services/appConfigService.js`
- `frontend_stack/packages/client/src/services/_util.js`
- `frontend_stack/packages/client/src/services/authApi.js`
- `frontend_stack/packages/client/src/platform/storage.js`
- `frontend_stack/app/capacitor.config.json`
- `frontend_stack/app/vite.config.js`
- `frontend_stack/packages/landing_page/src/lib/auth.ts`
- `frontend_stack/packages/landing_page/src/app/api/auth/proxy.ts`

## Known Schema and Persistence Problems

The current 731-line schema document describes the existing migrations rather
than a clean target model. Migration `005` is explicitly a JSON-store parity
layer and is the main source of ambiguity.

### Competing Catalog Sources

The current runtime contains three potential fund/product sources:

- `products`
- `funds`
- `app_config_versions.mobile.products`

The target must have one authoritative `funds` catalog. Application configuration
may control presentation and feature flags, but never canonical NAV, investment
minimums, risk, status, or disclosures.

### Orders and Plans

The current model overlaps `orders` and `investment_plans`, while services fall
back between both. The target vocabulary should be:

- A SIP plan is a recurring instruction.
- An investment order is an intent to buy, process a SIP installment, redeem,
  refund, or adjust.
- An investment execution is the immutable booked/allotted result of an order.
- A one-time purchase is an order, not an investment plan.

### Missing Authoritative Client Holdings

`product_holdings` describes the assets held by a fund, not units owned by a
client. Client portfolio code currently reads dynamic `portfolio_<userId>`
objects that the PostgreSQL adapter cannot map. The target must include:

- Immutable unit movements or executions.
- Current holdings, unique by user and fund.
- Holding lots with acquisition date, cost basis, original units, remaining
  units, and reservations when redemption requires lot-level accounting.

Portfolio snapshots may later be introduced as a read/performance cache. They
must never be the source of ownership truth.

### Onboarding Persistence Mismatch

The current landing onboarding service writes collections that do not exist in
the PostgreSQL adapter map. The new application flow must use explicit
PostgreSQL tables and repositories.

### Status Conflation

The current `users` row mixes account, approval, KYC, and risk state. Current
admin approval code also changes KYC and risk states together. The target must
separate:

- Application review state.
- User account state.
- Activation invitation state.
- KYC case state.
- Risk-assessment state.
- Investing eligibility state.

### Whole-Store Adapter

`pgAdapter.js` reads complete tables, filters in JavaScript, mutates an in-memory
store, and computes persistence differences. It must not be ported to
TypeScript. Replace it with explicit domain repositories and transaction-scoped
operations.

### Event Duplication

The current model overlaps:

- `admin_audit_logs`
- `receipts`
- `timeline_events`
- `transactions`
- `capital_transactions`
- `ledger_entries`

The plan must give each surviving concept one responsibility. Audit evidence is
not a client timeline. A generated receipt is not an audit record. A financial
ledger is not a mutable transaction table. Timeline should initially be a
derived read model unless persistence is justified by a concrete query need.

### Current Ledger Is Not Double Entry

The existing `ledger_entries` table has debit and credit values on one row but
no journal, account, or enforced balance. If fund AUM/pool values represent real
money, replace it with balanced accounting structures:

- `ledger_accounts`
- `ledger_journals`
- `ledger_postings`

Corrections must use reversals. Financial postings and audit evidence must be
append-only. If pool/AUM is presentation-only, do not pretend it is an
accounting ledger; store it as a dated, admin-published snapshot instead.

## Target Domain Model for Planning

The following is the current planning hypothesis. The planning agent must refine
it and produce a keep/merge/remove/postpone matrix. It should optimize for one
clear source of truth, not for the smallest possible table count.

### Applications and Identity

- `applications`
- `application_details`
- `application_documents` if documents are collected during application
- `application_consents`
- `application_reviews`
- `users`
- `user_credentials`
- `activation_invites`
- `auth_sessions`
- `verification_tokens`

Important invariants:

- Only one active application per normalized email/phone.
- Approved application to user is one-to-one.
- Approval is idempotent.
- Invitation tokens are single-use, short-lived, revocable, and stored only as
  hashes.
- Rejected applicants do not receive active credentials.
- Email/phone normalization and uniqueness are enforced in PostgreSQL.

### Landing and Content

- `marketing_leads`
- `site_config_versions`
- `content_items`
- `content_versions`
- `courses`
- `membership_plans`

General FAQs, legal/static pages, news, and general disclosures may use the
versioned content model. Fund-specific disclosures remain in the catalog domain.
Rename the current landing `plans` concept to avoid confusion with SIP plans.

### Compliance and Eligibility

This domain remains partly dependent on a product decision about whether KYC is
collected before approval on landing or after activation in the client:

- `investor_profiles`
- `kyc_cases`
- `kyc_documents`
- `kyc_reviews`
- `risk_assessments`

Do not store full Aadhaar. Encrypt sensitive PAN/FATCA values, keep uploaded
documents in private object storage, store opaque object keys and checksums, and
define a retention/deletion policy for rejected applications.

### Fund Catalog

- `funds`
- `fund_disclosure_versions`
- `fund_nav_prices`
- `fund_positions` for assets/companies held by the fund
- Optional `fund_performance_snapshots` only if calculations justify storage

Validated JSONB is acceptable for presentation-only fields such as taglines,
chart settings, and advanced display ratios. Canonical money, NAV, minimums,
status, risk, and publication state must be typed columns.

### Investing

- `sip_plans`
- `investment_orders`
- `investment_executions`
- `holdings`
- `holding_lots`
- Optional `plan_change_requests` if SIP changes require admin review
- `approval_actions` for dual-control workflows

Redemption should normally be represented as a sell/redemption order. Submitted
redemption calculations should capture the NAV/tax/disclosure versions used.
Unsubmitted previews may remain ephemeral.

### Payments and Providers

- `payments`, with multiple payment attempts allowed per order where required
- `mandates`
- `provider_events`, replacing separate payment/mandate webhook inbox tables

Provider event IDs, provider order/payment IDs, and idempotency keys require
appropriate unique constraints. External provider calls cannot be included in a
PostgreSQL transaction; use state machines, idempotency, reconciliation, and
inbox/outbox patterns.

### Platform and Operations

- `audit_events`
- `idempotency_records`
- `outbox_events`
- `email_deliveries`
- `notifications`
- `support_tickets` and `support_ticket_messages` only if support remains MVP
- Generated document metadata later when real receipts/statements are produced

Idempotency uniqueness should be scoped by actor, route, and key rather than a
single global key. Audit and financial evidence must redact credentials and
sensitive PII.

## Proposed Lifecycle Separation

The planner must produce exact allowed transitions, timestamps, responsible
actor, and failure/retry behavior for each state machine. A starting point is:

### Application

- `submitted`
- `in_review`
- `approved`
- `rejected`
- `withdrawn`

Email verification may either be a separate timestamp/gate or an explicit
pre-review state. The planner must recommend one approach and justify it.

### User Account

- `invited`
- `active`
- `suspended`
- `closed`

### Activation Invitation

- `pending`
- `sent`
- `accepted`
- `expired`
- `revoked`

### Investment Eligibility

- `blocked`
- `pending_compliance`
- `eligible`
- `suspended`

Payment, SIP, order, mandate, redemption, webhook, KYC, and risk states must be
reconciled against the code and redesigned into canonical state machines. The
existing code and SQL already disagree on several status names.

## Critical Transaction Boundaries

The plan must specify repository methods and PostgreSQL transaction boundaries
for at least:

1. Application submission, consent capture, verification token, and verification
   email outbox.
2. Email verification and transition into the admin review queue.
3. Admin approval: lock the application, create the user, create the activation
   invite, record the review/audit event, and enqueue the approval email.
4. Invitation resend: revoke the previous unused token, create a new token, and
   enqueue a new email idempotently.
5. Account activation and password creation.
6. Refresh-token rotation and reuse/revocation handling.
7. Fund publication with its disclosure version.
8. SIP or one-time order creation with idempotency.
9. Provider webhook inbox insertion and processing.
10. Payment success/allotment: order transition, immutable execution, holdings
    and lot updates, accounting postings if required, notification, and audit.
11. Redemption submission: lock/reserve units/lots and create the sell order.
12. Redemption rejection/settlement and unit reservation release/consumption.
13. Fund allocation or pool movement if the AUM represents real money.
14. Content publication and published-version switching.

## Money and Data Integrity Rules

- Prefer integer paise (`bigint`) for INR amounts when arithmetic does not need
  fractional paise.
- Use explicit PostgreSQL numeric scales for NAV and units, for example
  `numeric(24,8)` where justified.
- Do not pass PostgreSQL numeric money through JavaScript `Number`.
- Every client-owned row must be scoped to its user in the repository query, not
  filtered after loading.
- Use `RESTRICT` for financial history and only cascade truly dependent or
  ephemeral records.
- Add compare-and-swap/version fields or guarded state updates for concurrent
  workflows.
- Add work-queue indexes for pending applications, outbox events, provider
  events, due SIPs, pending approvals, and expiring sessions.
- Enforce coherent composite relationships so a payment cannot reference an
  order owned by another user and a mandate cannot reference another user's SIP.
- Use normalized E.164 phone values and case-insensitive normalized emails.
- `updated_at` must be maintained consistently by repository code or a shared
  trigger; defaults alone are insufficient.

## Authentication and Session Direction

Replace the hand-written JWT implementation with `jose`.

Because there is no production credential data to preserve, new credentials may
use Argon2id directly. If existing seeded/development accounts remain useful,
the plan may include a temporary multi-scheme verifier or reseed them.

Use separate transports over one server-side session model:

- Next.js landing/BFF and browser admin: `HttpOnly; Secure; SameSite` cookies,
  with an explicit CSRF strategy. Do not expose the web refresh token in JSON.
- Capacitor client: bearer access token held in memory and a rotating opaque
  refresh token held in native secure storage.

The current Vite client stores both tokens in `localStorage` even though a native
secure-storage abstraction already exists. The new typed auth client must be
asynchronous and must use secure storage on native. Implement a single-flight
refresh path and retry the original request at most once.

Access tokens should be short-lived. Device sessions must support revocation,
expiry, rotation, token-family/reuse detection, and reliable logout.

## Capacitor and Android Constraints

- Production networking must use HTTPS.
- Current Capacitor/Android configuration permits cleartext and mixed content;
  these allowances must be restricted to debug development only.
- Review Android backup/device-transfer configuration so tokens, activation
  state, PIN metadata, and device identifiers are excluded.
- Add verified HTTPS App Links for activation, password reset, payment, and
  mandate return flows.
- Handle both cold-start links and `appUrlOpen`.
- Handle Android process death while an external payment/browser activity is
  open, including `appRestoredResult` where applicable.
- Persist only a non-sensitive pending workflow identifier and refetch the
  authoritative server state on resume.
- Do not embed signup proxy secrets or email-provider credentials in the APK.
- Released app versions cannot be upgraded atomically with the backend; preserve
  `/v1` compatibility until a deliberate `/v2` decision is made.

## Email and Activation Requirements

- Email is sent server-side through an outbox worker.
- Configure SPF, DKIM, and DMARC for the official sending domain.
- Store provider message ID, attempt count, status, last error, sent time, and
  delivery time where the provider supplies delivery events.
- Admin approval must not report success if account/invitation/outbox creation
  did not commit.
- Email delivery failure must be retryable without approving or creating the
  user twice.
- Admin must be able to inspect delivery state and safely resend an invitation.
- Store only hashes of verification, activation, and reset tokens.
- Prefer a verified HTTPS activation link that opens the installed app and has a
  safe web/Play Store fallback. The activation token is not a normal login token.

## TypeScript and Library Direction

The database model is designed first, but the new runtime implementation begins
with a TypeScript backend foundation. Avoid a JavaScript database rewrite.

Preferred baseline tools:

- TypeScript in strict mode.
- `tsx` for backend development and `tsc` for production builds/type checks.
- Zod for request, response, environment, and external-data boundaries.
- Kysely with `pg` for typed PostgreSQL access while retaining explicit SQL and
  transaction control. Drizzle is an acceptable alternative only if the planner
  can justify the additional schema rewrite. Prisma is not the default choice
  for this SQL/transaction-heavy codebase.
- `jose` for JWT issuance and validation.
- `argon2` using Argon2id for passwords.
- `libphonenumber-js` for phone parsing/normalization.
- Pino-compatible structured logging with redaction.
- OpenAPI generation and a typed client derived from shared contracts.
- TanStack Query on the client for server cache, cancellation, controlled retry,
  and foreground refetch where it fits the existing UI.
- Vitest, Playwright, and PostgreSQL integration tests/Testcontainers.

Broad `validator` usage is likely redundant beside Zod. Libraries should replace
generic infrastructure, not hide domain state transitions or accounting rules.

Fastify plus official cookie, CORS, helmet, and rate-limit plugins is a reasonable
target for replacing the custom HTTP router. The planner must decide whether to:

- Migrate the transport before domain repositories,
- Retain the current router temporarily while repositories are replaced, or
- Build the first new TypeScript vertical slice on Fastify and retire old routes
  incrementally.

Do not change the HTTP framework, entire database layer, auth model, and every
frontend in one untestable step. The plan must define compatibility boundaries.

## Agreed Migration Order

The agreed high-level order is:

1. Finalize requirements and workflow/state-machine decisions.
2. Produce the canonical schema architecture and ERD.
3. Produce a current-table keep/merge/remove/postpone matrix.
4. Define API contracts and acceptance tests for critical flows.
5. Replace the existing migration history with a reviewed clean baseline after
   the schema is approved. Preserve old migrations only as archived reference if
   useful.
6. Establish the TypeScript backend/tooling foundation.
7. Implement the new PostgreSQL repositories directly in TypeScript.
8. Implement the application/approval/email/activation/login vertical slice.
9. Implement the canonical fund catalog and publishing flow.
10. Implement financial workflows incrementally: one-time order, payment,
    webhook, allotment/holding, SIP/mandate, redemption, then accounting.
11. Convert frontend shared contracts/API/session/platform code.
12. Convert client pages, admin code, shared Vite packages, and remaining entry
    points to TypeScript/TSX.
13. Make the already-TypeScript landing site consume the shared contracts.
14. Disable `allowJs`, remove remaining JS/JSX, remove compatibility adapters,
    and run complete backend, web, Android, and release verification.

## First Vertical Slice Acceptance Flow

The first implementation milestone must demonstrate all three surfaces and the
new persistence/auth patterns:

1. Landing submits a valid application.
2. Duplicate active email/phone is rejected deterministically.
3. Verification email is queued and sent.
4. Verified application appears in the admin queue.
5. Admin approval requires a reason and is idempotent.
6. Approval creates one user, one current activation invite, one review event,
   one audit event, and one email outbox event atomically.
7. Approval email contains a valid app/download and activation path.
8. Activation token can be used exactly once and expires correctly.
9. Activated client can sign in from the Capacitor app.
10. Refresh token is stored in native secure storage, rotates correctly, and is
    revoked on logout.
11. Rejected or unapproved applicants cannot sign in to the client app.
12. Admin can inspect email delivery and resend by revoking the previous unused
    invitation.

## Testing and Quality Gates

The existing test suite is not sufficient to safely guide the rewrite. The plan
must include a testing pyramid and named test cases before implementation.

Required categories:

- Unit tests for schemas, normalization, state-transition guards, money helpers,
  token handling, and immutable domain functions.
- PostgreSQL integration tests for constraints, repositories, concurrency,
  transactions, idempotency, outbox/inbox processing, and rollback behavior.
- API integration tests for auth, authorization, envelopes, cookies/bearer
  behavior, status codes, and error codes.
- E2E tests for landing application, admin approval, activation, app sign-in,
  fund publication, one-time payment, SIP, webhook retry, and redemption.
- Capacitor/Android checks for secure storage, deep links, app restart, process
  restoration, offline/retry behavior, and release HTTPS policy.
- Coverage reporting with a minimum target of 80 percent, with higher confidence
  expected around authentication, authorization, money, and persistence.

Follow test-first implementation for new behavior. Tests should validate the
desired target behavior, not blindly preserve known defects in the current code.

## Known Current Defects and Risks to Account For

- Cookies are manually serialized and are not currently marked `Secure`.
- Backend auth accepts bearer tokens first and cookies second.
- Web responses expose access and refresh tokens in JSON while also setting
  cookies.
- The Vite client stores tokens in `localStorage`.
- A `401` can clear the refresh token before the current client attempts refresh.
- Logout invokes asynchronous revocation without awaiting it.
- Access-token lifetime is currently 24 hours and refresh lifetime 365 days.
- Native secure storage exists but is not used by the auth token helpers.
- Android release configuration currently permits cleartext/mixed content.
- There is no complete activation/deep-link flow.
- Current signup/origin policy cannot safely embed its secret in an APK.
- In-memory rate limiting is process-local.
- Current services and SQL disagree on several status values.
- Existing money code repeatedly converts database monetary values to JavaScript
  `Number`.
- Current provider calls may complete before database persistence, creating an
  orphan/reconciliation risk.
- Current receipts may be created after business state commits rather than in
  the same transaction.
- Landing lead input includes fields that the backend currently drops.
- Approval currently creates an in-app notification but no reliable email.
- The current app config can act as a third product catalog.
- Current admin routes declare only the `admin` role despite unused operations
  and support roles in the schema.

The plan must distinguish defects to fix before migration from behavior that
will disappear naturally with the new vertical slices.

## Non-Goals

- No MongoDB migration.
- No requirement to preserve development database contents.
- No need to retain old JS/JSX files after verified replacement.
- No need to preserve the eight-migration history as an executable chain if a
  clean baseline is approved.
- No direct database access from any frontend.
- No separate client, admin, and landing copies of shared users, funds, orders,
  or payment data.
- No speculative microservices split.
- No speculative generic repository or event system that obscures domain rules.
- No portfolio snapshot as the source of financial ownership.
- No fake ledger if AUM is presentation-only.
- No email, database, activation, or signup secrets in frontend bundles.

## Open Decisions the Planner Must Resolve or Escalate

The planning agent should recommend defaults, record tradeoffs, and ask only
questions that materially change implementation:

1. Exactly which fields are collected by the landing application?
2. Is email verification required before the application enters admin review?
3. Is the password created during landing signup or only during post-approval
   activation? Deferred activation is the current recommended default.
4. Are KYC/risk details collected on landing before approval or in the client
   after activation? Sensitive KYC collection after authenticated activation is
   the safer current default unless product requirements say otherwise.
5. Is fund pool/AUM display-only, or does it represent real pooled money? This
   determines whether proper double-entry accounting is mandatory in the first
   release.
6. Are support tickets part of the first release?
7. Are downloadable/generated statements and receipts part of the first
   release, or can they be derived/postponed?
8. Does any action require two distinct administrator approvals in the MVP?
9. Is app distribution through Google Play, managed/private Play, or direct APK?
10. Which email provider will send transactional mail, and are delivery webhooks
    required in the first release?
11. Is the current `/v1` API envelope a hard compatibility contract, or may the
    rewrite introduce `/v2` before any production release?
12. Is a single `admin` role acceptable for MVP, or are content, onboarding,
    finance, support, and superadmin permissions required immediately?

## Required Planner Deliverables

The planning agent should create a coherent planning set, not a generic task
list. At minimum it must provide:

1. Product Requirements Document for the rewrite scope and MVP boundaries.
2. Architecture decision record for one PostgreSQL database organized by domain.
3. System context/container/component diagrams.
4. Canonical domain vocabulary and ownership map.
5. Application, activation, auth, fund, order, payment, mandate, redemption,
   webhook, and accounting state-machine definitions.
6. ERD and detailed schema specification with columns, types, constraints,
   indexes, foreign keys, deletion policies, and sensitive-data handling.
7. Current-table keep/merge/remove/postpone matrix.
8. Migration strategy for replacing the current SQL chain with a clean baseline.
9. Repository interfaces and transaction/unit-of-work boundaries.
10. API contract plan for landing, admin, client, internal worker, and provider
    webhook endpoints.
11. Authentication/session/activation/email architecture.
12. TypeScript package, build, alias, runtime, and test-tooling architecture.
13. Worktree-aware file-change and ownership map.
14. Phased task list with dependencies, risks, rollback points, and acceptance
    criteria for every phase.
15. Unit, integration, E2E, Android, security, performance, and coverage test
    plan.
16. Security review checklist covering PII/KYC, auth, authorization, tokens,
    cookies, mobile storage, email, audit redaction, payments, webhooks, rate
    limiting, and database roles/grants.
17. Deployment and cutover plan for development, CI, local Docker/PostgreSQL,
    Android builds, and the existing release manager.

The first executable phase must be small enough to verify independently and
must not require the whole JS-to-TS conversion to complete before any behavior
works.

## Planning Success Criteria

The plan is ready for implementation only when:

- Every MVP screen and API workflow has an authoritative domain source.
- Duplicate catalog, order, transaction, portfolio, and event concepts have been
  resolved.
- Application approval and app activation are fully specified.
- Every sensitive or financial state change has an explicit transaction and
  concurrency strategy.
- Money types and conversions are unambiguous.
- Frontend access rules and backend authorization are explicit.
- Worktree ownership prevents parallel agents from editing the same shared files.
- Test cases exist before implementation tasks.
- Each phase leaves the repository buildable and has clear acceptance criteria.
- Open product decisions are either resolved or clearly block only the affected
  later phase.


## Related notes (Obsidian graph)

- Produced the plan: [[plans/01-postgresql-typescript-rearchitecture-plan|Master rearchitecture plan]]
- Companion specs: [[specifications/02-product-architecture-decisions|02]] · [[specifications/03-schema-lifecycle-specification|03]] · [[specifications/04-api-security-test-specification|04]] · [[specifications/05-system-tooling-diagrams|05]]
- Later handoffs: [[handoffs/06-planning-completion-handoff|06 · Planning completion]] · [[handoffs/07-backend-ts-migration-and-later-domain-handoff|07 · Backend TS + later-domain]]
- Home: [[README|Session 1 home]]
