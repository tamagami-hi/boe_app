# Product and Architecture Decisions for the PostgreSQL/TypeScript Rearchitecture

**Status:** Phase 0 approved; Phase 2 implementation in progress through the
contracts scalar, error/envelope, public-onboarding, native-activation, and
native-authentication operation kernels

**Applies to:** Phases 0-10 of the rearchitecture plan

**Supersedes:** Conflicting learner-account, persistence, migration-order, and release assumptions in current product and schema documentation

## 1. Product Requirements and MVP Boundary

### 1.1 Product objective

Deliver one verifiable path from public signup through approved Android access,
backed by authoritative PostgreSQL domain data and a strict TypeScript backend.
The result must separate an applicant from an authenticated user, keep the public
experience education-only, and establish patterns that the later catalog and
financial slices can reuse without another persistence rewrite.

### 1.2 Users and surfaces

| Actor or surface | MVP responsibility | Explicit boundary |
|---|---|---|
| Public visitor | Learn in plain language; submit name, email, phone, and versioned consent; verify email | Has no authenticated account, financial visibility, or access to another application |
| Applicant | Receive verification and outcome/next-step emails | Is represented by an `application`, never by usable credentials or a device session |
| Onboarding administrator | Review verified applications, record an approval/rejection reason, inspect delivery, resend an unused invitation | Cannot silently alter KYC, risk, or investing eligibility while deciding an application |
| Approved user | Activate once, create a password, sign in to the Android client, and hold revocable sessions | Exists only after an approval transaction commits |
| Finance/content/support administrator | Use permissions for its domain | Does not inherit another domain's powers merely by using the admin surface |
| Landing | Education, application capture, verification outcome, official APK/download information | No funds, orders, holdings, payments, mandates, KYC, risk, or internal decision copy |
| Admin | Protected control plane over authoritative shared data | No duplicate admin-owned copy of users, applications, funds, or financial records |
| Client APK | Activation, authentication, then approved client workflows | No signup proxy secret, provider credential, database credential, or pre-approval access |
| Backend and workers | Sole database access, transactions, authorization, provider integration, audit, inbox/outbox processing | No frontend connects directly to PostgreSQL or sends transactional email itself |

### 1.3 MVP functional requirements

The first release must provide all of the following:

1. Landing submission creates an `applications` row, consent evidence, a hashed
   email-verification token, an email delivery, an audit event, and an email
   outbox event in one transaction. `application_details` is a postponed
   extension and is not created, read, or written in the first slice.
2. Name, normalized case-insensitive email, normalized E.164 phone, and the
   accepted legal/privacy version are the only application inputs. Password,
   PAN, KYC documents, risk answers, and investing information are not collected
   on landing.
3. A verified email is required before the application appears in the admin
   review queue. Active-email/phone uniqueness is deterministic internally, but
   every public duplicate returns the same generic `202 { accepted: true }` as
   a new submission and exposes no duplicate disposition.
4. Approval/rejection requires a reason and is idempotent. Approval creates
   exactly one user, one current activation invitation, one review, one audit
   event, one activation delivery, and one email outbox event atomically.
   Rejection creates a review, audit event, required rejection-email delivery,
   and rejection outbox event atomically, but no user, invite, credential, or
   session.
5. The SES worker claims only `outbox_events`; that row alone owns due time,
   lease, attempt count, backoff, retry, cancellation, and terminal transport
   result. `email_deliveries` records message/provider and safety evidence and
   never schedules work. A short transaction commits outbox/delivery `sending`
   after revalidating the token/invite; that commit is the point of no return
   before SES. Pre-send revocation cancels with the exact token/invite code;
   post-send revocation leaves any arriving link invalid. Signed SNS events update delivery, bounce, complaint,
   delay, and reject outcomes idempotently without reopening a delivered outbox
   or scheduling a `sent`/`delivered` message for resend.
6. Resending revokes the previous unused activation invitation and creates a
   new hashed, single-use, expiring invitation without recreating the user.
7. Activation creates an Argon2id password credential and activates the invited
   user exactly once. KYC and risk collection begins only after authenticated
   activation.
8. Browser sessions use secure HttpOnly cookies plus CSRF protection. Native
   sessions use an in-memory short-lived access token and an opaque rotating
   refresh token in native secure storage. Refresh reuse revokes its token
   family; logout awaits server revocation. Both web and native refresh accept
   a client `rotationId`; an ambiguous retry deterministically reproduces the
   same successor, and web refresh requires/reproduces the previous CSRF pair as
   well. CSRF recovery accepts current refresh only. Web tabs coordinate one
   rotation through locks/BroadcastChannel.
9. Domain RBAC exists for `superadmin`, `onboarding`, `finance`, `content`, and
   `support`. The initial MVP administrator may be assigned all permissions, but
   authorization remains permission-based.
10. The public HTTPS domain hosts the landing site, activation fallback,
    verified Android App Links, an immutable signed APK, and version/checksum
    metadata. Release Android networking forbids cleartext and mixed content.
    Verification and activation secrets appear only in URL fragments. The
    verification page may POST verification; activation fallback only offers
    APK download and an App Link preserving the fragment, and never calls the
    native activation endpoint. Only installed Capacitor supplies password/
    device data and stores refresh. `Referrer-Policy: no-referrer`, analytics
    redaction, and nginx logging rules keep bearer tokens absent.
11. The established `/v1` envelope `{ ok, data, error, meta }` and stable error
    codes remain the compatibility boundary while routes are ported.
12. Every new slice follows test-first delivery and maintains at least 80% of
    statements, branches, functions, and lines in each changed package (not
    merely repository aggregate), with concurrency and failure tests around auth,
    authorization, money, state transitions, and persistence.
13. Public signup and verification responses contain no application UUID, user
    UUID, internal state, duplicate flag, reviewer data, or eligibility result.
    Public pages retain only a short-lived opaque browser flow handle when one is
    required for presentation; the handle is not a database identifier.
14. The first release has no public withdrawal route. An authenticated
    onboarding/internal-support command may withdraw only an unverified or
    submitted application when applicant-request evidence and a reason exist;
    it revokes outstanding verification tokens and conflicts once review starts.
15. Credential lockout is row-locked and enumeration-safe: the fifth failure
    inside one 15-minute window locks for 15 minutes; an expired window restarts
    at failure one, locked attempts neither extend the lock nor change the
    counter, and success clears counter/window/lock.
16. Proxy trust is route-aware. Internet nginx overwrites, rather than appends,
    client `Forwarded`/`X-Forwarded-For`; direct API routes trust only the
    verified nginx hop. Landing-BFF routes accept a preserved original client
    IP only after validating the internal landing source and its signed request
    metadata, and never trust browser-supplied forwarding headers.
17. Capacitor `appRestoredResult` is used only when the operating system restores
    an interrupted plugin call. Ordinary workflow recovery stores a
    non-sensitive local workflow ID and refetches server state.
18. Access JWTs are ES256 with current PKCS#8 signing material and versioned
    current/retired SPKI verification keys selected by protected-header `kid`.
    Every protected admin/native request rechecks session `sid`, channel,
    account state, and current permissions for immediate revocation.
19. Repository outputs are immutable. Queue/detail/delivery/retention reads use
    keyset cursors and explicit maximum limits. Email delivery authorization is
    `email_deliveries.read` for the full safe projection or
    `email_deliveries.read_masked` for strict support masking.

### 1.4 Success criteria

The MVP is accepted only when a clean environment can demonstrate the complete
application-to-sign-in flow across landing, admin, SES/SNS, backend, PostgreSQL,
and the signed APK, including duplicate submission, concurrent approval, expired
and replayed tokens, retryable email failure, refresh reuse, logout, and rollback
of failed database transactions. No unapproved or rejected application may
authenticate, and no approval or email retry may create a duplicate user.

Operationally, the same tested commit must build the backend/landing release
bundle and APK; CI must be green; local Docker deployment must pass readiness;
the VPS must pass public and internal smoke checks; the published APK checksum
and signing fingerprint must match the artifact; and rollback artifacts must be
captured before traffic switches.

### 1.5 Non-goals

- MongoDB, microservices, a database per frontend, or direct frontend database access.
- Preserving development data, unsafe signup/auth contracts, JSON-store parity,
  dynamic `portfolio_<userId>` data, or the eight old migrations as the eventual
  executable history.
- Creating learner credentials at public signup or publicly describing admin
  approval, investing eligibility, KYC, risk assessment, funds, SIPs, returns,
  portfolios, or an investment invitation.
- Collecting KYC/risk before activation, storing full Aadhaar, or putting private
  documents in PostgreSQL/public object storage.
- Support tickets, generated receipts/statements, stored portfolio performance
  snapshots, or a speculative document generator in MVP.
- General courses, membership plans, FAQs, and site-content authoring in the
  first slice. Only immutable terms/privacy `consent_documents` required for
  signup evidence are in that slice; broader content remains Phase 7 work.
- A fake double-entry ledger. AUM/pool is a dated, admin-published presentation
  snapshot unless a later custody decision proves that real accounting is needed.
- A generic repository/event abstraction that hides domain transitions.
- Preserving the development JavaScript router or a mixed-runtime bridge. The
  TypeScript reset installs Fastify first; canonical repositories and business
  routes follow on that sole transport.
- Play Store release automation. The approved first distribution path is direct
  APK from the official HTTPS domain.

## 2. Public Product Copy Reconciliation

### 2.1 Decision

`PRODUCT.md` now defines **Join BeOnEdge** as an education membership/signup
experience while the backend persists a non-credentialed `application`. No
account, credential, or session exists before private activation. Public copy
must remain education-only and must not expose investing eligibility or the
admin decision model.

The binding product policy is:

> The public site is education-only and lets a learner submit their details to
> join BeOnEdge's education membership. Submission does not create an account or
> immediate sign-in access. BeOnEdge verifies the learner's email and
> communicates any next step privately. Internal access and administrative
> workflows are never described or surfaced on the public site.

This is a deliberate distinction between public language and persistence:

- Internal domain term: `application` / `applicant`.
- The primary public call to action is exactly “Join BeOnEdge”. Supporting
  instructions may say “Submit your details” and “Verify your email”.
- The submission confirmation is exactly “If these details can be used to
  continue signup, check your email.”
- Forbidden public claims: “account created”, “application approved/pending”,
  “eligibility”, “investment access”, “fund access”, “portfolio”, “returns”,
  “SIP”, “KYC review”, or any promise that verification guarantees access.
- “Learner” remains the audience description and educational voice; it is not a
  persisted account type.
- Admin and email copy may use “application”, “approved”, and “activation” where
  disclosure is necessary. It must still avoid claiming investing eligibility.

The public UI may show a generic submitted/verified outcome keyed by a
short-lived opaque flow handle. It must never return or embed the application
UUID, queue position, reviewer identity, internal reason, risk/KYC state, user
ID, eligibility result, or whether a user record has been created.

## 3. ADR: One PostgreSQL Database Organized by Domain

### 3.1 Context

The current implementation has competing catalog sources, a whole-store adapter,
JSON parity tables, dynamic portfolio collections, and overlapping event and
financial concepts. Separate surface databases would make application-to-user,
payment-to-execution, and holdings invariants distributed problems while the
product still has one backend and a small deployment footprint.

### 3.2 Decision

Use one PostgreSQL 16 database, reachable only by the backend and its workers.
Organize code, repositories, migrations, permissions, and table names by business
domain rather than by landing/admin/client surface. Kysely repositories operate
on an explicitly supplied transaction and return new immutable values. Cross-
domain state changes use an application service/unit of work; repositories do
not call providers or commit independently.

One backend image supplies the API, migration command, and worker command. API
and worker processes use separate least-privilege database roles in production:

- `boe_migrator`: DDL only during the one-shot migration job.
- `boe_api`: domain read/write required by request paths; no schema ownership.
- `boe_worker`: outbox/provider inbox claim and domain transitions required by
  worker handlers; no schema ownership.
- `boe_readonly`: operational diagnostics only, never bundled in an application.

### 3.3 Domain ownership and dependency direction

| Domain | Authoritative concepts | May depend on | Must not own |
|---|---|---|---|
| Identity/onboarding | applications, consents, reviews, users, credentials, invites, sessions, verification tokens; application details only in a later slice | Platform outbox/audit | KYC decision, investing eligibility, funds, money |
| Administration | roles, permissions, role grants, maker-checker requests, audit evidence | Identity actors and domain entity references | Duplicate business records or editable audit history |
| Compliance | investor profile, KYC case/documents/reviews, and risk assessment; eligibility is computed from these and account state | Activated user | Stored/cached eligibility, application approval, or account lifecycle |
| Catalog | funds, disclosure versions, NAV prices, positions, AUM snapshots | Administration publication evidence | Client holdings, application configuration products |
| Investing | SIP instructions, orders, executions, holdings, lots, unit reservations | Identity, compliance eligibility, catalog, payments | Provider webhook payloads or presentation snapshots as ownership truth |
| Payments/providers | payments, attempts, mandates, provider events | Identity and investment order references | Holdings or execution mutation outside a transaction service |
| Content | courses, membership plans, site/content versions | Administration publication evidence | Canonical fund terms, NAV, risk, or disclosures |
| Platform/operations | idempotency, outbox, email deliveries, notifications, audit transport metadata | Stable opaque references to all domains | Business state machines or secrets in audit payloads |

Dependencies flow from transport to application services to domain/repositories
to PostgreSQL. Provider adapters and workers sit outside database transactions;
they consume committed outbox/inbox records and call application services.
Frontends consume generated contracts and cannot import repositories.

### 3.4 Consequences

- Approval, payment booking, holding updates, and audit/outbox writes can be
  enforced atomically with foreign keys, unique constraints, row locks, and
  guarded versions.
- Scaling starts with more stateless API/worker processes and indexed queues;
  no distributed transaction or service-to-service auth is introduced.
- Domain ownership must be enforced in modules and review because PostgreSQL
  does not make every cross-domain write invalid automatically.
- PostgreSQL `bigint` paise and scaled `numeric` values remain strings/decimal
  values in TypeScript and never become JavaScript `Number`.
- A future service split, if justified by measured load or organizational
  ownership, must consume stable domain contracts; it is not pre-built now.
- Every outbox producer supplies the complete `03` envelope: event ID, topic, event type
  and version, aggregate type and ID, occurrence time, request ID, nullable
  causation ID, nullable workflow correlation ID, unique deduplication key, and a typed
  payload. Workers reject unsupported event versions rather than guessing.
- Consent-IP, rate-limit, and suppression identifiers use distinct versioned
  HMAC keyrings. Consent and suppression evidence persists its non-secret key
  version; rate-limit buckets include the key version so rotation cannot merge
  incompatible hashes. No one purpose reuses another purpose's key.
- Financial booking and settlement append immutable executions and
  `holding_lot_movements` while updating holding/lot projections atomically.
  Reversal appends one linked exact inverse and never edits an original.
  NAV/units use scale 8 and one round-half-to-even step; FIFO partial-lot cost
  basis puts the aggregate paise residual on the last consumed lot. Rejection
  after confirmed funds starts the refund workflow, and refund evidence is
  separate and immutable.

### 3.5 Initial administrator bootstrap

The initial administrator is created only by the idempotent bootstrap seed. The
seed first upserts the canonical role/permission catalog, then optionally creates
one non-application admin user, Argon2id credential, active `superadmin` role
grant, and redacted audit event in one transaction.

The exact configuration contract is:

- `BOOTSTRAP_ADMIN_ENABLED=true` is required to create the user. It defaults to
  false in every environment.
- `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PHONE_E164`, and
  `BOOTSTRAP_ADMIN_FULL_NAME` are required and pass the same normalization and
  validation as normal identity data.
- Exactly one of `BOOTSTRAP_ADMIN_PASSWORD_HASH` or
  `BOOTSTRAP_ADMIN_PASSWORD_HASH_FILE` is required. The value is an encoded
  Argon2id hash meeting the selected production parameters; a raw password is
  never accepted by the seed. The file form is preferred for Docker/VPS secrets.
- Production startup/seed rejects missing explicit values, placeholder values,
  known development identities, non-Argon2id hashes, and any enabled default
  development credential. No fallback email, phone, name, hash, or password is
  compiled into source, examples, images, or Compose.

Idempotency is keyed by normalized bootstrap email plus a stable bootstrap
purpose. A retry may add missing canonical roles/permissions and the missing
initial grant, but it never overwrites an existing credential, changes an
existing identity, reopens a closed/suspended user, or creates a second admin.
An email/phone collision with a different identity fails closed for operator
resolution. Seed output reports only created/already-present/refused IDs in
masked form; it never prints a password, encoded hash, secret-file content,
token, complete email, or complete phone.

The `superadmin` role receives the complete seeded permission catalog, including
the first-slice application/read/review/decision, invitation, delivery, user,
role/account administration permissions and the reserved finance, approval,
fund, content, and support permissions. This gives the initial administrator all
current permissions without route-level `isInitialAdmin` exceptions.

On that user's first successful web login, the login transaction appends an
`admin.bootstrap_first_login` audit event. Any later bootstrap seed refuses to
run while that event exists and `BOOTSTRAP_ADMIN_ENABLED=true`; the operator must
set the flag false and remove the hash/hash-file secret before the next deploy.
Readiness is degraded and an operational alert remains open until this is done.
Normal role and credential workflows, never the seed, govern the account after
the first login.

## 4. Domain Vocabulary and Source-of-Truth Map

| Term | Exact meaning | Authoritative source | Derived/presentation only | Never interchangeable with |
|---|---|---|---|---|
| Learner | Public audience/persona | Product copy only | Public education experience | User/account role |
| Marketing lead | Contact-interest submission unrelated to access | `marketing_leads` | Campaign reporting | Application |
| Application | Request submitted on landing before any user exists | `applications` plus consents/reviews; `application_details` is postponed | Public generic signup/verification outcome without a database ID | User, KYC case, eligibility |
| Applicant | Person represented by an application | Application fields | Admin queue row | Authenticated user |
| Email verification | Proof of control of applicant email | Hashed `verification_tokens` plus verified timestamp | Email-delivery status | Approval or authentication |
| Application review | Reasoned onboarding decision | `application_reviews` and guarded application state | Admin queue filters | KYC/risk review |
| User | Identity created once from an approved application | `users` | Display profile | Application or credential |
| Credential | Password verifier for one user | `user_credentials` Argon2id hash | None | Session or activation token |
| Activation invitation | One-time authority to establish a credential | Hashed `activation_invites` | Email link/code | Login/refresh token |
| Auth session | Revocable device/browser session and refresh family | `auth_sessions` | Short-lived JWT access claims | User/account state |
| Account state | Invited/active/suspended/closed access lifecycle | `users.account_state` | UI label | Application/KYC/eligibility state |
| KYC case | Compliance document/review lifecycle | `kyc_cases`, documents, reviews | UI checklist | Application review |
| Risk assessment | Versioned answers and assessed risk outcome | `risk_assessments` | Explanatory UI | Account state |
| Investing eligibility | Current permission to initiate financial actions | Derived at read/command time from `users.account_state`, latest KYC case/expiry, and latest risk assessment | Client affordances; never stored in a table, column, configuration, JWT, or client row | Approval or authentication |
| Fund | Canonical investable catalog entity and terms | `funds` | App-config ordering/taglines | Product JSON/config item |
| Disclosure version | Immutable fund-specific published disclosure | `fund_disclosure_versions` | Rendered document | General site content |
| NAV price | Dated, versioned price observation | `fund_nav_prices` | Charts | AUM or execution price without captured version |
| Fund position | Asset/company held by the fund | `fund_positions` | Allocation chart | Client holding |
| AUM snapshot | Dated admin-published presentation value | `fund_aum_snapshots` | Dashboard/chart | Cash ledger or client ownership |
| Membership plan | Education/membership offering on landing | `membership_plans` | Marketing layout | SIP plan |
| SIP plan | Recurring client investment instruction | `sip_plans` | Schedule preview | One-time order |
| Investment order | Intent to buy, run an installment, redeem, refund, or adjust | `investment_orders` | Timeline projection | Execution or SIP plan |
| Investment execution | Immutable booked/allotted economic result | `investment_executions` | Transaction timeline row | Mutable transaction/order status |
| Holding | Current units for one user and fund | `holdings`, reconciled from executions/lots | Portfolio summary | Fund position or snapshot |
| Holding lot | Acquisition/cost/reservation detail | `holding_lots` | Tax/lot display | Portfolio snapshot |
| Payment | Aggregate payment obligation/result for an order | `payments` | UI status | Provider attempt/event |
| Payment attempt | One provider interaction for a payment | `payment_attempts` | Retry history | Payment aggregate |
| Mandate | Provider-backed recurring debit authority | `mandates` | Authorization UI | SIP plan |
| Provider event | Immutable idempotent inbound provider evidence | `provider_events` | Operations queue | Audit event |
| Audit event | Append-only who/what/why evidence | `audit_events` | Redacted admin history | Notification, client timeline, receipt |
| Approval action | Pending/approved/rejected maker-checker request | `approval_actions` | Approval queue | Application review |
| Outbox event | Committed request for an external side effect | `outbox_events` | Worker queue metrics | Business record or provider event |
| Email delivery | Attempt/provider lifecycle for one email request | `email_deliveries` | Admin delivery UI | Application/invitation state |
| Notification | User-facing message reference | `notifications` | Client timeline | Audit evidence |
| Timeline | Joined read model from authoritative domain events | Query/read model, initially not stored | Client chronological UI | Audit/event store |
| Receipt/statement | Generated document, postponed | Future immutable document metadata | Rendered file | Execution or audit evidence |

### 4.1 Retention and erasure triggers

Retention periods begin from the exact terminal timestamp below, not merely
from row creation. The typed hold set includes application, user, delivery,
email-provider event, audit event, investor profile, KYC case, risk assessment,
marketing lead, investment order, payment, and mandate. User holds propagate through their
compliance and financial children; KYC/order/payment/mandate holds propagate to
their exact documents, attempts, executions/movements, refunds, and provider or
audit evidence as specified in `03`. A legal hold suspends every applicable
expiry. Cleanup runs in bounded batches under a separate retention role, emits
metrics and audit evidence, and pseudonymizes or purges encrypted PII fields
before deleting a row when relational evidence must remain.

Encrypted-field purge means nulling the primary-database ciphertext envelope;
it is not per-record key destruction. Encrypted backups/WAL have a maximum
35-day restricted recovery lifetime, and any restore reruns retention
reconciliation before application access.
Every cleanup query anti-joins an active hold on the exact entity or its
retention-owning parent and rechecks that hold while the candidate row is
locked; a hold never silently broadens retention for unrelated rows.
The allowlist is the typed set above; `email_provider_event` protects unmatched
reconciliation and source-linked suppression evidence. An unconverted
marketing lead is held directly; a converted lead resolves its linked
application. Application holds propagate to details, consents,
reviews, tokens, and pre-user deliveries. User holds and the typed
KYC/order/payment/mandate parents propagate exactly as specified in `03`.

| Record/evidence | Trigger and minimum retention | Terminal action |
|---|---|---|
| Applications | Seven years after decision/withdrawal, after submission when never decided, or after creation when never verified | `RESTRICT`; unverified direct PII becomes unique non-reversible tombstones 30 days after `created_at`; rejected/withdrawn direct PII does so at 180 days; linked approved-application PII does so with a closed user at `closed_at`+180 days; normalized identifiers become reusable; state and pseudonymized evidence remain for seven years |
| Consent documents | Indefinite after publication | Append-only; retire by timestamp and publish a new version |
| Application consents/reviews | Seven years after decision/withdrawal, after submission when never decided, or after application creation when never verified | Append-only; no application-role update/delete |
| Verification/reset tokens | 90 days after the latest of consumed, revoked, or expired | Delete hash row only after audit captured outcome |
| Activation invitations | Seven years after the latest of accepted, revoked, or expired | Preserve activation evidence; raw token never exists in storage |
| Terminal auth sessions and refresh rows | 180 days after `revoked_at` or `expired_at` | Delete session metadata and its ephemeral refresh rows together; refresh reuse evidence remains until then |
| RBAC grants/catalog | While referenced by audit evidence | Revoke grants with timestamp/audit; do not delete referenced grants |
| Audit events | Seven years for onboarding/security; at least ten years for financial events | Append-only, redacted, application role cannot update/delete |
| Idempotency records | Public application: 24 hours after completion; admin/financial: seven days after completion | Bounded deletion using `expires_at`; replay bodies contain no secrets/raw PII |
| Outbox events | Delivered or cancelled: 90 days; dead-lettered: one year, from the corresponding terminal timestamp | Delete only transport record; never business/audit evidence |
| Email deliveries | Seven years after latest delivery, bounce, complaint, permanent failure, cancellation, or creation | Purge recipient/failure ciphertext, nonce, and encryption-key-version columns from the primary database; retain suppression HMAC/key version, mask, state, and legal/audit evidence |
| Email provider events | Matched: delivery's seven-year period; unmatched valid events: seven days after receipt; subscription records: one year | Purge raw provider fields from the primary database after the applicable trigger; retain safe outcome evidence |
| Users/credentials | Never physically delete while financial, compliance, consent, or audit evidence exists | Closing immediately revokes sessions/invites and erases the credential hash; absent an active legal hold, user and linked approved-application name/email/phone become unique non-reversible tombstones 180 days after `closed_at`, making original normalized identifiers reusable while the stable pseudonymous user ID remains |
| Compliance/KYC/risk | At least eight years after user relationship closure | Purge sensitive ciphertext fields from the primary database and lifecycle-delete encrypted objects from the active object store after expiry; backup/WAL copies age out under the separate 35-day recovery lifecycle; legal hold suspends |
| Published catalog/disclosures/NAV/positions/AUM | Indefinite after publication | Append revisions/corrections; deletion forbidden |
| Orders/executions/holdings/lots/SIPs/redemptions | At least ten years after user relationship closure | Preserve immutable financial results; legal hold suspends |
| Payments/attempts/mandates/provider digests | At least ten years after terminal state | Preserve redacted digest/outcome |
| Encrypted raw financial-provider payload | Seven years after processing | Purge encrypted payload fields from the primary database, retain digest/redacted outcome; legal hold suspends |
| Notifications | 24 months after creation | Delete user-facing projection only, never source business/audit evidence |
| Unconverted marketing lead PII | 24 months after creation; converted leads inherit linked application retention | Purge encrypted fields from the primary database and close the row |
| Published content versions | Indefinite after publication | Append-only; archive rather than mutate published history |

## 5. Migration and Compatibility Decision

Source-code replacement and data/API compatibility are separate concerns. The
application migration is direct: a migrated backend or frontend area is replaced
by strict production TypeScript and its superseded JavaScript/JSX source and
tests are deleted in the same bounded batch. The old mixed JavaScript runtime is
not required to build or run between batches, and `allowJs` is not used to copy
legacy application code into the new production output. Unmigrated files may
remain temporarily only as an explicit backlog and are outside the authoritative
TypeScript runtime.

The database and external compatibility rules below still apply. Forward-only
schema safety, evidence preservation, the stable `/v1` contract, and supported
APK behavior must not be weakened merely because old source code can be removed.

### 5.1 Expansion first, clean baseline last

The handoff's high-level order suggested replacing the old migration chain before
the TypeScript foundation. The approved plan intentionally resolves that
conflict by using additive target migrations during each vertical slice and
squashing only after all legacy consumers are gone.

For database evolution and released external contracts, this is safer because it:

- keeps every migrated dependency closure independently buildable and testable;
- avoids designing a final baseline before repository and concurrency tests
  validate constraints;
- provides a route/config rollback without reversing schema or losing evidence;
- exposes hidden legacy dependencies before destructive cleanup; and
- prevents one simultaneous database, framework, auth, and frontend cutover.

Database/domain slices follow expand/migrate/contract. This sequence does not
require the deleted JavaScript runtime to coexist with its TypeScript replacement:

1. **Expand:** add new tables, constraints, indexes, repositories, contracts,
   and disabled code paths. New migrations are forward-only and additive.
2. **Verify:** run clean-database, contract, concurrency, and rollback
   tests. Where a source must move, perform an explicit idempotent backfill and
   compare counts/checksums; do not add indefinite dual writes.
3. **Switch:** enable the canonical TypeScript route/service through an atomic
   routing/config change. Pre-release JavaScript paths are deleted, not retained
   for a compatibility release.
4. **Observe:** verify error, queue, reconciliation, and data-integrity metrics.
5. **Contract:** remove the old path/table only after all repository, route,
   job, frontend, reporting, seed, and deployment references are zero.

### 5.2 Compatibility policy

- Preserve `/v1`, the response envelope, HTTP semantics, and stable error codes.
  Unsafe signup/auth payloads may change before an installed APK exists, but
  contract fixtures define the new baseline before clients integrate.
- Fastify is the sole authoritative TypeScript transport beginning with the
  `/health/live` runtime reset. Business routes are added directly from authored
  contracts/fixtures; the deleted development custom router is not a parity
  target.
- Database migrations must be backward compatible with the previously deployed
  backend until its traffic is stopped. A release may not require an old binary
  to understand a newly mandatory column without a default/backfill.
- External events are versioned. Workers ignore unsupported future versions and
  dead-letter invalid payloads without mutating business state.
- Direct APK releases are non-atomic and may remain installed. Backend `/v1`
  compatibility is retained for every APK at or above the published minimum
  version. Raising minimum version is an explicit release decision, not a
  side-effect of backend deployment.
- Do not use database views or dual writes as permanent compatibility layers.
  A temporary adapter must have an owner, removal gate, and test.

### 5.3 Final squash gates

Replace the additive target migrations with one reviewed baseline only when all
of these are true:

1. All runtime JS/JSX and `pgAdapter.js` dependencies are removed; migrated
   packages have enforced `allowJs: false` throughout replacement.
2. No code, tests, seed, query, report, Docker command, or release script refers
   to legacy/JSON parity tables or old status vocabulary.
3. All landing, admin, client, API, worker, provider, and scheduled flows use the
   canonical repositories and generated contracts.
4. Legacy-to-target reconciliation reports zero unexplained differences, even
   if the checked data is only fixtures/development data.
5. The complete unit, PostgreSQL integration, API, E2E, Android, security,
   performance, and 80% coverage gates pass against the additive schema.
6. An independent schema review approves types, checks, unique/composite foreign
   keys, deletion policy, indexes, grants, sensitive-data controls, and migration
   locking behavior.
7. The proposed baseline recreates an empty PostgreSQL database, applies seed
   data, and yields the same canonical schema fingerprint as the verified target.
8. A release bundle and database dump from the last additive release are stored
   and a restore rehearsal succeeds.
9. No installed supported APK or deployed web bundle needs a removed table or
   old API behavior.
10. The squash lands only at a declared development reset/release boundary. It
    is never applied over a database that already recorded the old migration
    chain; such an environment is recreated or restored explicitly.

After the squash, retain the old SQL chain in version control as non-executable
historical reference only if useful. The runtime migration directory contains
only the clean baseline and migrations created after it.

## 6. Worktree and File Ownership

The observed worktrees are `main`, `wt/admin`, `wt/client`, and `wt/landing`.
Sparse visibility is not write ownership: surface worktrees can see shared paths
for compilation and review, but shared changes land once through `main`.
The canonical planning set is staged for tracking at
the structured Markdown tree under `resources/sessions/1/` in the primary
checkout. Once its commit is
merged/rebased, the existing `resources` sparse patterns expose that same set
read-only to all three surface worktrees. No surface owns or copies a private
planning set.

| Owner | Writable implementation scope | Read-only or coordination scope | Must not change there |
|---|---|---|---|
| `wt/landing` | `frontend_stack/packages/landing_page/**` | Main-owned `packages/contracts/**`, backend contracts, and `resources/**` needed to implement landing | Backend, migrations, shared Vite packages, root/workspace manifests, release tooling |
| `wt/admin` | `frontend_stack/packages/admin/**` | Main-owned `packages/contracts/**`, app shell, client, shared packages, backend contracts, resources needed to build admin | `frontend_stack/app/**`, client behavior, backend/migrations, shared manifests/contracts, release tooling |
| `wt/client` | `frontend_stack/packages/client/**`; `frontend_stack/app/**` including Capacitor/Android and client app entry points | Main-owned `packages/contracts/**`, shared packages, backend contracts, resources required for the APK | Admin/landing behavior, backend/migrations, shared manifests/contracts, release tooling |
| `main` | Everything shared or cross-surface, listed below; integration, testing, release, and final conflict resolution | All surfaces | No release from sparse worktrees |

`main` owns these paths exhaustively by category:

- Backend and database: `backend_controller/**`, including source, tests,
  migrations, scripts, Dockerfile, package manifest, and backend lockfile.
- Shared HTTP contracts: `packages/contracts/**`, including authored Zod
  operations, deterministic generated clients/OpenAPI, package manifest, and
  lockfile. Every sparse worktree includes this path for read/consumption only.
- Shared frontend contracts/build inputs: `frontend_stack/package.json`, the
  workspace lockfile, `frontend_stack/packages/shared/**`,
  `frontend_stack/packages/design-tokens/**`,
  `frontend_stack/packages/ui-kits/**`, and `frontend_stack/assets/**`.
- Cross-surface deployment and preview: `frontend_stack/deploy/**`,
  `frontend_stack/preview/**`, `emu/**`, and any root/shared test harness.
- Product/architecture/process: `PRODUCT.md`, `WORKFLOW.md`, root manifests,
  `.github/**`, the tracked `resources/sessions/1/**/*.md` planning set, and
  repository-wide configuration. Other ignored `resources/**` data does not
  become tracked merely because `main` owns its policy.
- Release: source-controlled release scripts, libraries, version metadata,
  Docker Compose and nginx/TLS examples, export/deploy/status/rollback behavior,
  and release docs. The current root ignore makes `release_manager/**` local;
  Phase 2 must first add a narrow source allowlist for those files. Local
  environments, images, database dumps, generated manifests, live state, and
  rollback artifacts remain ignored; broadly unignoring `release_manager/` is
  forbidden.

Rules for overlapping work:

1. A surface branch may consume a shared contract already on `main`; it may not
   create a private variant. Shared API/schema/package changes are committed on
   `main` first, then surface branches rebase/merge them.
2. `wt/client` owns the app shell because the shell selects/builds the native
   client. `wt/admin` may test through it but must request shell changes through
   `main`/client ownership.
3. UI-kit/design-token changes affecting one surface are still shared changes:
   land once on `main`, with all affected surface builds passing.
4. Root/workspace/backend `package.json` and lockfiles have one `main` owner.
   Surface dependency requests are integrated centrally to avoid divergent lockfiles.
5. Generated OpenAPI/typed clients are produced and committed (if committed at
   all) by `main`; surfaces never edit generated output manually.
6. Surface commits are merged into `main`, where full CI, Docker, Android, and
   release checks run. Only `main` is pushed/released as the tested truth.

## 7. Maker-Checker Policy

### 7.1 Covered actions

Maker-checker is required only for a closed six-category policy. The database
check permits only the eight action codes in `03`; neither services nor
`superadmin` may invent an exception. The exact covered set is:

1. Every first and later investable fund/term publication through
   `fund.publish_investable_version`. It binds the complete immutable fund
   version, linked disclosure, and initial/current NAV. There is no sensitivity
   flag or ordinary-publication bypass.
2. Resuming a paused fund, and archiving any fund that is or was published.
   Emergency pause needs one authorized finance actor and a reason; archiving a
   never-published draft/review fund uses ordinary permission.
3. Backdating, correcting, or superseding a published NAV or AUM snapshot. The
   approved action appends revision N+1; current-date first publication uses
   ordinary finance permission and deletion is always forbidden.
4. Reversing a booked investment order. Execution appends a new approved
   `reversal` execution linked by `reverses_execution_id` and applies inverse
   holding/lot movements atomically. The original execution and lot movement
   are immutable and can never be amended or deleted.
5. Approving a redemption whose captured amount is at or above the
   `finance_policy_versions.redemption_dual_approval_threshold_paise` stored by
   that request. The initial typed policy is `10000000` paise (INR 100,000.00);
   changing it requires publishing a new policy version, never JSON config or a
   service constant.
6. Every runtime role grant/revocation and role-permission mapping change
   through `rbac.permissions.change`. The approved payload binds the exact
   principal, role, permission, and delta; deterministic bootstrap grants are
   the only seed-time exception.

The eight permitted action codes are `fund.publish_investable_version`,
`fund.resume`, `fund.archive_published`, `fund_nav.correct`,
`fund_aum.correct`, `investment_order.reverse`,
`redemption.approve_above_threshold`, and `rbac.permissions.change`.

Ordinary application approval/rejection, invitation resend/revocation, KYC/risk
review, content/course publication, support work, account suspension,
provider-validated payment/refund/mandate/settlement transitions, normal client
orders/SIPs, below-threshold redemption approval, current-date first NAV/AUM
publication, position correction, and emergency fund pause are not
maker-checker actions. They still
require domain permission, a reason where defined, guarded transitions, and
audit. No additional dual-control action may be inferred without a new typed
policy/schema decision matching the lifecycle specification.

### 7.2 Separation-of-duty invariants

- A request stores immutable action/target type and ID, positive target version,
  RFC 8785 canonical JSON object payload, its 32-byte SHA-256 hash, maker ID,
  10-1,000-code-point reason, expiry, and version. These values cannot be edited
  after insertion.
- The maker and checker must be different active user IDs. Role aliases, shared
  accounts, API keys, and “superadmin” do not bypass this rule.
- The maker needs execute/request permission at creation; the checker needs the
  action-specific check permission at decision time. The system revalidates both
  actors and target state immediately before execution.
- Approval and domain mutation execute once in one transaction with audit and
  outbox records. Approval alone has no domain effect. Execution locks the
  action and target, re-hashes the payload, and uses a compare-and-swap update
  from `approved` to `executed`.
- The target version must equal the captured version. Any intervening change
  makes the request stale; a fresh request is required.
- A maker cannot check, edit the payload/target/expiry, change the checker, or
  split one economic change across requests to evade policy. A rejected,
  expired, executed, or stale request is terminal and cannot be reused.
- Only one live request may exist for the same action and target version.
  Concurrent decisions use a row lock/guarded update and produce one execution.
- Rejection requires a checker reason. All views redact secrets and sensitive
  PII while retaining before/after evidence and request ID.
- Target-version or payload-hash mismatch makes the action `stale`; database
  time beyond expiry makes it `expired`. Neither outcome may mutate the target.
- Workers and provider webhooks may execute validated automatic transitions but
  cannot approve a pending exception. A worker encountering an exception leaves
  it pending and emits an operational alert.
- No approval can amend or delete an execution, published NAV/AUM revision, or
  other append-only evidence. Every correction is a newly approved reversal or
  higher immutable revision linked to the original.
- Break-glass does not silently bypass dual control. If emergency policy is
  later added, it must be a separate disabled-by-default, time-bound procedure
  with two-person credential custody and post-event review.

## 8. Phase Dependency, Risk, Rollback, and Acceptance Matrix

| Phase | Depends on | Primary risk | Rollback/forward point | Acceptance gate |
|---|---|---|---|---|
| 1. Planning and architecture | Approved handoff/plan | Ambiguous vocabulary or product copy leaks into schemas and UI | Documentation-only; revise decisions before code starts | PRD, ADRs, diagrams, source map, state machines, ERD/schema, table disposition, API fixtures, security/deployment policy agree; every MVP endpoint/screen maps to one source |
| 2. Test and TypeScript foundation | Phase 1 contracts and tool choices; narrowly tracked release-tool source | Tooling churn, an incomplete runtime mistaken for release-ready, or false coverage over unmigrated JS | Revert the bounded runtime-reset commit; artifact remains isolated/non-release until canonical gates pass | Node `>=22.19.0 <23`; strict TS/`tsx`/`tsc` with `allowJs:false`; Fastify `server.ts`; Vitest; no legacy aliases/runtime imports; Zod, Kysely types, `jose`, Argon2id, logging/redaction, OpenAPI/client generation; source/emitted and backend/landing image build-start smoke uses database-independent `/health/live` and BFF-live proxy without PostgreSQL; per-batch deletion guard and no enabled known-failing test |
| 3. Additive canonical identity schema | Phase 2 test/runtime foundation; approved schema | Locks, incorrect uniqueness, deletion leaks, role overreach | Additive objects remain inert; disable feature flags and roll back app; fix migrations forward | Exact `testcontainers@12.0.4` plus `@testcontainers/postgresql@12.0.4` use documented `PostgreSqlContainer`; clean and existing dev DB migration pass; constraints/indexes/grants/concurrency/rollback are tested; repositories are transaction-scoped and no old behavior switched |
| 4. First backend vertical slice | Phase 3 repositories/schema | Duplicate identities, token/session compromise, orphan email, provider retry defects | Disable incomplete Fastify route groups while retaining additive data; forward-fix committed rows | Full application→verification→approval/rejection→SES/SNS→native-only activation→web/native auth flow passes, including bounded queues, masked/full projections, lost-response refresh/CSRF replay, immediate session/account/permission revocation, exact send point/cancellation codes, signed SNS erasure, duplicate/concurrent/expiry/reuse/failure cases on the canonical Fastify transport |
| 5. Surface and Android cutover | Phase 4 stable contracts and public domain setup | Surface drift, token leakage, broken deep links/process restore | Roll landing/admin route flag back; retain prior signed APK and backend `/v1`; do not revoke working old artifact | Landing uses application copy/BFF, admin queue and delivery tools work, APK uses secure sessions/App Links/restoration/HTTPS/backup exclusions, all consume generated contracts |
| 6. Fastify hardening/inventory | Phase 4 contract fixtures; Phase 5 supported clients | Envelope/auth/raw-body mismatch or undocumented handler drift | Disable affected canonical route group; schema unchanged; no legacy transport fallback | Descriptor-to-handler inventory plus envelope/errors/RBAC/CORS/cookies/CSRF/Helmet/rate limit/request IDs/raw webhooks/logging tests for every canonical route |
| 7. Catalog and content | Stable transport/repository conventions | Third catalog survives or publication mutates history | Disable catalog write routes; retain previous published version; additive rows remain | One authoritative fund source; typed terms/NAV/positions/disclosures/AUM; versioned content/courses/membership plans; app config contains presentation/flags only; maker-checker paths pass |
| 8. Financial vertical slices | Phases 3, 6, 7 plus eligibility/provider contracts | Money precision, provider/orphan events, oversold units, non-idempotent booking | Feature-flag each sub-slice; stop workers; keep evidence; forward-fix financial state, never destructive down-migrate | Pre-phase gate proves payment `(id,user_id)` ownership uniqueness; atomic payment+attempt-one+provider-outbox; sender consumes rather than creates attempt; refund money/provider evidence with null NAV/units; append-only lot movements/projections; redemption settlement books linked order; then all unit/integration/E2E/concurrency/reconciliation and dual-control tests pass; no fake ledger |
| 9. TypeScript completion/cleanup | All migrated domains and surface contracts | Hidden unmigrated source or dead consumer remains | Remove in small reviewed commits; restore prior app commit while additive schema stays | No runtime JS/JSX, `pgAdapter`, JSON parity, duplicate tables/routes/adapters; all builds/tests and 80% coverage pass |
| 10. Clean baseline and release | Phase 9 plus all squash gates | Irreversible baseline mismatch or backend/APK release ordering | Before cutover preserve bundle+dump; recreate non-production DBs; in production prefer forward fix, whole-release+DB restore only by rehearsed incident procedure | Baseline recreation/schema fingerprint/seed/full suite pass; independent review complete; local Docker and VPS ready; signed APK metadata/checksum/signature/App Links verified; rollback rehearsal succeeds |

Phases are sequential at their acceptance gates. Work inside a phase may run in
parallel only when file ownership and dependencies are disjoint. No later phase
may use an unaccepted earlier contract as production truth.

## 9. Deployment and Cutover ADR

### 9.1 Environments and artifact provenance

- **Development:** local Node/Vite/Next processes may use a local PostgreSQL 16
  instance or Docker. Migrations run explicitly before API/worker startup. SES
  and Razorpay use sandbox/mock adapters unless a test explicitly targets a live
  sandbox. Debug-only Android cleartext allowances never enter release config.
- **CI:** Node `>=22.19.0 <23` installs from lockfiles, type-checks, runs lint/security guards,
  unit tests, PostgreSQL integration tests, API tests, frontend tests/builds,
  coverage, migration-from-empty, schema checks, and Android release checks.
  E2E runs against the built API/landing and ephemeral PostgreSQL. CI does not
  send real email, call live payment endpoints, publish an APK, or mutate VPS.
- **Foundation safety boundary:** Phase 2 and Phase 3 images are non-production
  build artifacts only. Isolated rehearsal may create a local `docker save` or
  OCI-layout archive to validate integrity, but it remains local and is marked
  non-release. The images must not receive external traffic or be transferred,
  deployed to VPS, or published as a release while the legacy HS256,
  environment-admin, browser-token-storage, or equivalent authentication paths
  remain reachable. Production/external cutover is blocked until Phase 4
  implements the backend security contract and Phase 5 implements the secure
  clients, with the security suites for both phases passing.
- **Local release rehearsal:** only the full `main` checkout uses
  `release_manager/status.sh`, `export.sh`, and `deploy.sh`. The release bundle is
  tied to a clean commit/tag and tested with local Docker before shipping.
  Rehearsal records the local image ID/config digest, the SHA-256 of every
  archive/manifest, and the accepted commit. It records a repository digest
  only when a registry push/pull actually exists; an OCI-layout archive records
  its manifest digest instead. Release
  Dockerfiles pin base images by digest (with a human-readable tag comment),
  and CI verifies those pins before export.
- **VPS:** host nginx terminates TLS; Docker runs PostgreSQL, one-shot migration,
  backend API, worker, and landing. Admin and APK remain separately built
  clients of the public backend.
- **Direct APK:** produced from the same accepted release commit, signed with the
  protected release key, and published only after compatible backend and App
  Links are live.

### 9.2 Development and CI order

1. Apply additive migrations to a clean ephemeral database.
2. Run database constraint/repository/concurrency tests.
3. Type-check and run backend unit/API/security tests with workers disabled,
   then with test workers processing seeded queues.
4. Generate/check OpenAPI and typed clients; fail on uncommitted contract drift.
5. Test/build landing, admin, client, shared packages, and the Vite app.
6. Run cross-surface Playwright E2E against built services.
7. Build the Android release variant; verify HTTPS policy, backup exclusions,
   deep-link manifest, version metadata, and absence of secrets.
8. From Phase 2 onward, build backend and landing with repository-root contexts
   and explicit Dockerfile paths, then start both exact images and pass backend
   health plus landing/BFF smoke before export. Migration, worker, provider, and
   full route behavior checks become blocking in their owning later phases.

### 9.3 Docker/VPS deployment order

The existing order is PostgreSQL → migrate → seed → backend → landing. The
target order is:

1. Refuse deploy unless CI is green, the tree is clean, bundle commit equals
   `origin/main`, required secrets/config validate, and a pre-deploy database
   dump plus active release bundle are present.
2. Load images without switching traffic. Start PostgreSQL and wait for
   `pg_isready`.
3. Run the one-shot `boe_migrator` job. It must acquire a migration lock, fail
   closed on error, and never auto-run a destructive squash over an existing DB.
4. Run idempotent seed only for explicitly enabled bootstrap data. Production
   must not overwrite credentials or business records.
5. Start the backend with new write paths disabled where a staged cutover is
   required. Wait for backend readiness, then smoke the old and new contract
   fixtures over the internal network.
6. Start the worker from the same backend image with a separate command and DB
   role. Initially keep queue classes disabled; enable provider inbox first,
   then transactional outbox/email, then scheduled finance jobs only after the
   corresponding API version is ready.
7. Start landing against the ready backend. Verify its server-side BFF and
   public health page. Deploy/admin-publish the admin bundle only after backend
   permission and contract smoke tests pass.
8. Switch nginx/feature flags to new routes, one compatible group at a time.
   Observe errors, latency, DB locks, queue age, retry/dead-letter counts,
   duplicate conflicts, email bounce/complaint rates, and reconciliation.
9. Publish App Links/download metadata and the APK only after the VPS API is
   stable and publicly reachable over HTTPS.

### 9.4 Worker safety and rollout

- API and worker are distinct processes/services, even when built from one
  image. API readiness does not depend on provider availability.
- Outbox and later financial-provider workers claim bounded batches with `FOR
  UPDATE SKIP LOCKED`; their owning queue row carries its lease/attempt,
  exponential backoff, maximum attempts, and dead-letter state. Email delivery
  rows never own queue scheduling. First-slice signed-email inbox workers use
  `EmailProviderEventRepository.lockReceivedBatch` and the exact
  `received → processed | ignored | unmatched` states; they perform only short
  database work under the row lock and have no invented lease, processing, or
  dead-letter column. A rollback leaves the event `received`.
- External calls happen after commit. Provider message/event IDs are unique;
  handler transactions re-check current business state before applying effects.
- A deployment may scale workers to zero without blocking API reads/writes; queue
  age alerts make the degraded side-effect state visible.
- On first rollout, enable one worker replica and one event class. Increase
  replicas only after duplicate/idempotency and retry metrics remain clean.
- Stop scheduled finance producers before stopping their consumers during
  rollback. Do not delete queued/outbox/provider evidence.

### 9.5 Health, readiness, and observability

The target exposes separate probes while preserving `/health` compatibility:

- `GET /health/live`: process/event-loop alive; no external dependency check.
- `GET /health/ready`: configuration valid, PostgreSQL reachable, expected
  migration version present, and the API able to execute a trivial query. It
  returns non-2xx when traffic must not be sent.
- `GET /v1/health`: versioned compatibility envelope with release/build/schema
  version and redacted dependency status; no secret or PII.
- Worker liveness: process alive. Worker readiness: database/grants/migration
  compatible and queue lease loop initialized. SES/Razorpay outages degrade
  provider metrics but do not cause restart loops.
- Landing readiness: Next server responds and its configured internal backend
  target is valid. A separate smoke request verifies the BFF path.
- APK publication readiness: HTTPS APK and manifest return successfully,
  checksum/signature fingerprint match, `assetlinks.json` matches package and
  certificate, and minimum version is coherent with backend support.

Every log includes request/event ID, release version, domain action, and safe
actor/entity identifiers. Passwords, token values, authorization/cookie headers,
PAN/KYC data, provider secrets, raw documents, and unnecessary email/phone data
are redacted. Metrics and alerts cover request failures/latency, DB pool/locks,
migration failure, worker queue depth/age/retry/dead-letter, SES bounce/complaint,
provider signature failure, refresh reuse, and maker-checker backlog.

### 9.6 Direct APK publication order

1. Reserve a monotonically increasing Android `versionCode` and semantic
   `versionName`; build the release variant from the accepted clean tag.
2. Sign outside the repository. Verify the APK with Android tooling and record
   SHA-256, byte size, package ID, version, certificate SHA-256 fingerprint,
   build commit, release time, minimum supported version, and immutable URL.
3. Scan the bundle for credentials, cleartext/mixed-content release settings,
   backup leakage, and incorrect API origins. Install/smoke on a clean device.
4. Publish/verify `assetlinks.json` before the APK manifest. Test cold-start and
   warm activation links plus password/payment/mandate returns and restoration.
5. Upload the immutable versioned APK. Keep the previous supported APK and
   metadata available for rollback.
6. Atomically switch the public version manifest/download page to the new
   artifact only after public checksum, signature, HTTPS, and backend smoke pass.
7. Monitor activation/login/version errors. Do not raise the minimum supported
   version until the new APK is proven and the product explicitly chooses to
   retire the old version.

### 9.7 Rollback and forward-fix policy

- **Default:** forward-fix schema and financial/event data. Once a provider
  event, execution, holding movement, refund, or audit record is committed, do
  not erase or down-migrate it to make an old binary work.
- **Application rollback:** permitted when the previous image is compatible with
  the expanded schema. Disable new route/worker flags, stop new producers,
  drain or pause consumers safely, restore the previous images, and retain
  additive tables/evidence.
- **Migration failure before traffic:** abort deployment and keep the old stack.
  Apply a new corrective migration; never edit an applied migration.
- **Post-write incompatibility:** roll forward unless the rehearsed full restore
  procedure is explicitly authorized. The current release manager's app-only
  rollback is insufficient when the old app cannot read the new schema.
- **Full restore:** last resort for unrecoverable corruption before external
  effects diverge. Stop traffic/workers, preserve forensic dumps, restore the
  matching database dump and release bundle together, validate readiness and
  reconciliation, then reopen traffic. External provider/email effects still
  require reconciliation after restore.
- **Landing/admin:** switch to the last contract-compatible build. Do not expose
  a UI that calls routes unavailable in the selected backend.
- **APK:** an installed APK cannot be recalled atomically. Keep backend `/v1`
  compatible and previous downloads available; repoint public metadata to the
  prior APK only if its `versionCode`/backend compatibility is safe. Otherwise
  publish a higher-version forward fix.
- **Clean baseline:** rollback means recreate/restore the whole environment from
  the last additive release, never run the squashed baseline over the old chain.

Production traffic is restored only after readiness, contract smoke, queue
integrity, maker-checker, and provider reconciliation checks pass. Every rollback
or break-glass forward fix records owner, reason, timestamps, affected versions,
and follow-up corrective work.

## 10. Fixed Assumptions

- There is no production data or installed APK population to preserve at the
  start of this program, but every released APK is treated as non-atomic from
  that point onward.
- PostgreSQL 16, one backend, Kysely/`pg`, strict TypeScript, Zod, `jose` v6,
  Argon2id, SES/SNS, Fastify v5 from the backend runtime reset, and direct APK are the
  approved targets.
- AUM is presentation-only; accounting journals remain postponed.
- Support tickets and generated receipts/statements are postponed.
- The official HTTPS domain, SES sending identity/SPF/DKIM/DMARC, SNS delivery
  events, Android signing identity, and secure release-key handling must exist
  before first-release acceptance.
- The existing release manager remains the release entry point for backend,
  landing, and PostgreSQL. It must be extended for a worker and safer readiness;
  it does not become the APK signer or an admin-hosting system by implication.


## Related notes (Obsidian graph)

- Master plan: [[plans/01-postgresql-typescript-rearchitecture-plan|Rearchitecture plan]]
- Companion specs: [[specifications/03-schema-lifecycle-specification|03 · Schema & lifecycle]] · [[specifications/04-api-security-test-specification|04 · API/security/email/test]] · [[specifications/05-system-tooling-diagrams|05 · System/tooling/contracts]]
- Rules & decisions: [[WORKING_MODEL|Working model]] · [[decisions/RISKS_AND_DECISIONS|Risks & decisions]]
- Execution: [[TASKS|Task ledger]]
- Home: [[README|Session 1 home]]
