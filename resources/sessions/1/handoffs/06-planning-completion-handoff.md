# Handoff: Complete PostgreSQL and TypeScript Rearchitecture Planning

## Purpose And Stop Condition

This handoff is for the next planning agent. Complete the remaining architecture
and contract corrections, run the final Phase 0 verification gates, and then
stop. Do **not** install packages, add TypeScript configuration, write migrations
or tests, or change runtime code until the user explicitly authorizes the
TypeScript foundation.

The current planning set is indexed in [`README.md`](../README.md). Treat
`02` through `05` as normative companion specifications to the master plan.

## Work Completed

- Confirmed one PostgreSQL database and one backend organized by domain.
- Reconciled `PRODUCT.md`: public copy uses “Join BeOnEdge” as education
  membership/signup; persistence is a non-credentialed application; no public
  eligibility or investing workflow is exposed.
- Locked application-first onboarding, verification before review, password at
  activation, KYC after activation, direct APK distribution, Amazon SES/SNS,
  domain RBAC, derived eligibility, and published-snapshot AUM.
- Defined canonical first-slice schema, constraints, retention, rate-limit and
  legal-hold tables, email encryption fields, outbox ownership, state machines,
  repository/unit-of-work boundaries, and additive migration strategy.
- Defined 18 first-slice routes, privacy-safe generic application submission,
  admin review/decision flow, web/native auth separation, synchronizer CSRF,
  rotating refresh sessions, idempotency, rate limiting, SES/SNS, test cases,
  coverage, and mandatory review gates.
- Sanitized tracked environment templates so they contain only obvious local
  placeholders or intentionally empty production values. The historical
  database credential is treated as compromised: any environment that ever
  used it must rotate it outside the repository before its next connection or
  release; no document or runtime may rely on that historical value.
- Added system, container, component, and ERD diagrams plus package/tooling
  research and exact dependency candidates.
- Resolved prior conflicts around names, consent documents, duplicate probing,
  review transitions, reason codes, maker-checker actions, immutable financial
  evidence, rounding, outbox/event envelopes, email suppression, and retention.

## Phase 0 Work Ledger

Items 1 through 12 have their planning resolutions recorded below in the order
completed. The final independent contract/schema, security, and architecture
gates passed with no CRITICAL or HIGH findings; Phase 0 is approved.

### 1. Make Planning Artifacts Durable And Visible

**Planning resolution recorded:** the canonical Markdown set remains at
`resources/sessions/1` and is narrowly unignored/staged for tracking in the
primary checkout. After that change is committed and merged/rebased, the
existing `resources` sparse patterns materialize it read-only in each surface
worktree. It is never duplicated.

Prior condition:

- The broad `resources/` ignore previously left `00` through `06` local and
  untracked.
- The sparse admin/client/landing patterns could not materialize untracked files.

Applied decision:

- Prefer adding a narrow `.gitignore` exception for
  `resources/sessions/1/**/*.md` and add the existing planning set normally.
- Keep implementation ownership in `main`; surface worktrees consume approved
  shared contracts after those contracts are merged from `main`.
- Do not duplicate planning files across worktrees.
- Update `02` and `05` to describe the actual tracked location after the change.

Verification:

```bash
git check-ignore -v resources/sessions/1/README.md
git status --short resources/sessions/1 PRODUCT.md .gitignore
git ls-files resources/sessions/1
```

### 2. Finish The Mixed JavaScript/TypeScript Runtime Bridge

**Superseded by the direct-replacement directive recorded after commit
`45fc7f7`.** Do not implement the mixed bridge below. The authoritative backend
uses `allowJs: false`, a TypeScript/Fastify entrypoint, emitted-only production,
and per-batch deletion of superseded JavaScript. This section remains only as
historical planning context.

**Planning resolution recorded:** `01`, `02`, and `05` now lock complete `src`
emission, conditional source/default aliases, source and emitted smoke tests,
unchanged legacy tests, and the no-switch-before-smoke rule.

Problem:

- Current `backend_controller/package.json` import aliases point to `src`.
- The plan simultaneously retains legacy JavaScript and proposes a `dist`-only
  production image, which is not runnable as written.

Recommended resolution:

- Compile the complete backend source tree with `allowJs: true`, `checkJs: false`,
  `rootDir: src`, and `outDir: dist`. This copies legacy JS and compiles new TS
  into one runnable emitted tree.
- Use conditional package imports:
  - `development` targets `./src/...`;
  - default production targets `./dist/...`.
- New TypeScript imports use NodeNext-compatible `.js` specifiers. Existing JS
  aliases remain valid during migration.
- Development command: run the source tree with `tsx` and the `development`
  condition. Production command: `node dist/server.js` with default imports.
- Phase 2 must add both source-mode and emitted-mode smoke tests. Docker may copy
  only `dist` after the emitted smoke test proves every alias resolves.
- Do not switch the live entrypoint during the tooling-only RED-test step unless
  both smoke tests pass.

Copy/reference points:

- Current aliases: `backend_controller/package.json` `imports`.
- Current entrypoint: `backend_controller/src/server.js`.
- Current Docker build: `backend_controller/Dockerfile`.

### 3. Correct Tooling Phase Scope And Dependencies

**Superseded in part by the direct-replacement directive and the completed
TypeScript runtime reset.** The current authority is `01`, `02`, `05`, and the
implementation progress record. The backend uses Vitest-only migrated tests,
Fastify from the reset, `allowJs:false`, and no legacy-runtime gate.

Locked decisions in `01`, `02`, and `05`:

- The common Node floor is `>=22.19.0 <23`.
- PostgreSQL/Testcontainers belongs to Phase 3, not Phase 2.
- In Phase 3 pin both `testcontainers@12.0.4` and
  `@testcontainers/postgresql@12.0.4`; use the documented
  `PostgreSqlContainer` API.
- Each migrated dependency closure replaces its JavaScript tests with Vitest
  and enforces at least 80% statements, branches, functions, and lines.
- Add `@testing-library/dom@10.4.1` only in the owning frontend-surface phase,
  alongside React Testing Library and `user-event`; do not install those three
  in the backend foundation.
- Separate selected dependencies from deferred frontend/provider candidates.
  Fastify is selected for the authoritative backend runtime; remaining deferred
  packages are revalidated when their phase begins.
- Phase 2 acceptance is limited to tooling, contract generation, source/emitted
  build smoke, migrated regression tests, and later-slice test plans/fixtures.
  Enabled known-failing tests are never committed; RED is observed and resolved
  inside the owning slice.

### 4. Make Shared Contracts Buildable In Docker And Release Workflows

**Planning resolution recorded:** the plans now require repository-root build
contexts, explicit Dockerfile paths, root-context ignore rules, shared-contract
build ordering, landing trace-root correction, basic image smoke, and a narrow
tracked-source prerequisite for currently ignored release tooling. Runtime
state and secrets remain ignored.

Problem:

- A root `packages/contracts` package referenced through `file:` dependencies is
  outside the current package-local Docker build contexts.

Required resolution:

- Keep one root-owned `packages/contracts` source package.
- Change backend and landing Docker contexts to repository root when the package
  is introduced; use explicit Dockerfile paths and narrow `.dockerignore` rules.
- Update `release_manager/export.sh` and compose metadata in the same phase.
- Add backend and landing image build/start/health smoke tests to that phase.
- A phase does not pass its internal build gate until those image checks pass;
  production release eligibility remains blocked until the Phase 4/5 security
  cutover gate.

### 5. Complete First-Slice Repository Interfaces

**Planning resolution recorded:** `03` now defines immutable, bounded cursor
query/result contracts for every required application, delivery, identity,
session, and legal-hold-aware cleanup path; services/unit-of-work retain
transaction ownership.

Add immutable input/output types and bounded repository methods in `03` for:

- paginated application queue and application detail queries;
- paginated/filtered email-delivery queries and bounded deliveries per application;
- duplicate active normalized email/phone lookup;
- user plus credential lookup/row lock by normalized email;
- activation invitation lookup/lock by token hash;
- active native session lookup by user and device hash;
- auth session lookup/lock by `sid`;
- web/native session replacement and revocation;
- legal-hold-aware cleanup queries.

Every list method must use cursor pagination and an explicit maximum limit. Keep
transaction ownership in application services/unit-of-work, not repositories.

### 6. Repair Web Refresh And CSRF Ambiguous-Retry Semantics

**Planning resolution recorded:** `01`, `03`, `04`, and the `05` ERD now store
current/previous refresh and CSRF evidence with key versions, persist only the
client rotation ID, constrain current-cookie CSRF recovery, coordinate tabs,
and specify all lost-response/reload/grace/reuse tests.

Current problem:

- Refresh rotates the sole CSRF hash. A committed response lost in transit leaves
  the browser holding the previous refresh cookie and CSRF token, which fails
  CSRF validation before deterministic refresh replay.

Required resolution:

- The browser generates and sends `rotationId` for every refresh attempt.
- Store current and previous refresh hashes plus current and previous CSRF hashes,
  their key versions, `last_rotation_id`, and a 30-second previous-value grace.
- A retry using previous refresh + previous CSRF + the same `rotationId` may
  reproduce the deterministic successor pair.
- Any different `rotationId` with a previous refresh token revokes the family.
- Persist the client-provided `rotationId`; never generate it server-side.
- Coordinate browser tabs with `BroadcastChannel`; only one tab refreshes.
- `GET /v1/auth/web/csrf` may recover through a valid current refresh cookie, but
  must not turn an already-consumed previous token into a general refresh bypass.
- Add lost-response, reload, concurrent-tab, grace-expiry, and reuse tests.

### 7. Make Activation Native-Only

**Planning resolution recorded:** verification and activation fallbacks are
separated throughout `01`-`05`; activation fallback offers APK/App Link only,
and installed Capacitor alone exchanges the fragment bearer and creates native
credentials.

Current problem:

- The fallback web page is described as posting to an Android-only activation
  endpoint that returns native credentials.

Required resolution:

- Keep the activation token in the URL fragment so it is absent from HTTP logs
  and referrers.
- The HTTPS fallback page may offer APK download and an “Open BeOnEdge” App Link,
  preserving the fragment, but it must not call `/v1/activations/complete`.
- Only the installed Capacitor client exchanges the token, supplies device data,
  creates the password, and stores the refresh token in native secure storage.
- Use `Referrer-Policy: no-referrer`; redact activation/verification paths from
  analytics; never place the token in query strings.

### 8. Complete Auth And Cryptographic Contracts

**Planning resolution recorded:** the normative set now fixes ES256 plus
PKCS#8/SPKI `kid` rotation, per-request session/account checks, a true 15-minute
credential-failure window, nullable AES-GCM SNS evidence, and exact AWS
rendering-failure raw parsing.

JWT:

- Select `ES256`.
- Store signing keys as PKCS#8 private PEM and SPKI public PEM, indexed by a
  versioned `kid`.
- Sign only with the current key; verify current and retired public keys selected
  by protected-header `kid`.
- Retain retired verification keys for maximum access-token TTL plus clock skew.
- Pin issuer, audience, algorithm, and accepted clock skew in `jose` calls.
- Check active session and user account state on every native and admin request,
  so logout/suspension revokes access immediately.

Credential lockout:

- Five failed attempts inside 15 minutes locks login for 15 minutes.
- Successful login resets the counter and lock.
- Return the same invalid-credentials envelope for unknown, locked, or wrong
  credentials; log the internal reason with PII redaction.

SNS evidence:

- Use nullable ciphertext after erasure plus nonce, key version, digest, and
  `erased_at`.
- AES-256-GCM envelope and AAD must follow the same exact convention as email PII.
- Parse AWS rendering failures using raw `eventType: "Rendering Failure"` and
  object key `failure`; only then normalize to the internal enum.

### 9. Finish Retention And Legal-Hold Propagation

**Planning resolution recorded:** closed-user and linked approved-application
PII tombstoning, identifier reuse, the typed hold allowlist, parent propagation,
bounded anti-join cleanup, and race tests are consistent in `01`-`05`.

- When a linked user is closed, erase the credential immediately.
- After 180 days, tombstone PII in both `users` and the linked approved
  `applications` row unless a legal hold is active.
- Remove/tombstone the application’s normalized email/phone so identifier reuse
  becomes possible after retention expires.
- Define the legal-hold entity allowlist as `application`, `user`,
  `email_delivery`, `email_provider_event`, `audit_event`, `investor_profile`,
  `kyc_case`, `risk_assessment`, `marketing_lead`, `investment_order`,
  `payment`, and `mandate`.
- Define parent propagation explicitly:
  - application hold covers details, consents, reviews, verification tokens,
    and pre-user email deliveries;
  - user hold covers credentials, sessions, invites, user email deliveries,
    notifications, linked approved application, compliance/KYC/risk records,
    orders, payments, mandates, and their retention children;
  - KYC/order/payment/mandate holds cover their exact documents, attempts,
    executions, holdings/lot movements, refunds, provider events, audit, and
    generated evidence as applicable.
  - unconverted marketing leads are direct hold targets; converted leads resolve
    through the linked application; provider-event holds cover source-linked
    suppression evidence.
- Cleanup queries must resolve the retention parent and anti-join active holds.

### 10. Define Email Send Point Of No Return

**Planning resolution recorded:** outbox/delivery `sending` commits before SES,
token/invite revocation uses distinct codes before that boundary, post-boundary
mail remains harmless, SES acceptance ends retries, and Delivery Delay is
evidence only.

- The outbox worker owns claim, lease, due time, attempts, and retry.
- Under a short transaction, lock the outbox row and token/invite, validate it,
  and transition the outbox/delivery to `sending`; commit before calling SES.
- That committed `sending` transition is the point of no return.
- Revocation before `sending` cancels the event. Revocation after `sending` may
  still produce an email, but the embedded token is invalid and harmless.
- Never hold a database transaction across SES.
- Use distinct cancellation codes such as `VERIFICATION_TOKEN_REVOKED` and
  `ACTIVATION_INVITE_REVOKED`.
- SES acceptance ends send retries. Delivery Delay is evidence only and never
  re-enqueues the message.

### 11. Resolve Remaining Authorization And Projection Details

**Planning resolution recorded:** full versus strict-masked delivery permissions,
per-request admin/native revocation checks, internal-only withdrawal, and the
limited `appRestoredResult` role are explicit and tested.

- The email-delivery route accepts either `email_deliveries.read` for full
  onboarding/administrative projections or `email_deliveries.read_masked` for a
  strictly masked support projection. Support never receives ciphertext,
  provider payloads, or raw failure details.
- Admin cookie routes must re-check `sid`, account state, and permissions for
  every request, matching the native immediate-revocation rule.
- `withdrawn` remains an admin-assisted internal transition in the first release;
  no public withdrawal endpoint is implemented.
- Reserve Capacitor `appRestoredResult` for restorable plugin-call results only.
  Ordinary workflow recovery uses normal launch/resume, a non-sensitive local
  workflow ID, and authoritative server refetch.

### 12. Record Deferred Financial Corrections Before Their Phase

**Planning resolution recorded:** the payment ownership key, atomic first
attempt/outbox, consuming sender, append-only movements, redemption booking, and
refund evidence rules are normative pre-Phase-8 blockers, not Phase-2 scope.

These do not block the TypeScript foundation, but must be corrected before the
payment phase is approved:

- `beginPayment` atomically creates the payment, first payment attempt, and
  provider-call outbox event. `sendPaymentToProvider` consumes that attempt and
  never creates another implicitly.
- Add `UNIQUE (id, user_id)` to `payments` before defining the composite
  `(payment_id, user_id)` foreign key from `payment_attempts`.
- Keep lot movements append-only and holdings/lots as projections.
- Redemption settlement must transition the linked order to `booked`.
- Refund executions carry money/provider evidence with null NAV/units under
  type-specific checks.

## Required Final Verification

After editing the planning set, run three independent read-only gates:

1. Contract/schema/ERD verification against `00` and `PRODUCT.md`.
2. Security and anti-pattern audit covering auth, CSRF, refresh, PII, SES/SNS,
   idempotency, rate limiting, retention, and money.
3. Architecture review against the repository engineering rules.

The gate passes only when there are no CRITICAL or HIGH findings blocking Phase
2. MEDIUM findings must either be fixed or explicitly assigned to a later phase
with a pre-phase blocking gate.

Useful commands:

```bash
rg -n "TODO|TBD|either|or may|optional|learner account|RenderingFailure|renderingFailure" \
  PRODUCT.md resources/sessions/1/*.md resources/sessions/1/**/*.md
rg -n "rotationId|previous_csrf|ES256|PKCS#8|SPKI|PostgreSqlContainer|node:test" \
  resources/sessions/1/*.md resources/sessions/1/**/*.md
git diff --check
```

## Handoff Completion Criteria

Planning is complete only when:

- all items above are reflected consistently in `01` through `05`;
- the planning artifacts are durable/tracked and their ownership is documented;
- the final three review gates approve the planning contract for a future
  Phase 2;
- no implementation package or runtime source has been changed as part of this
  planning-completion handoff (security-sanitized environment examples are the
  only non-planning exception); and
- starting the TypeScript foundation remains blocked until a separate explicit
  user authorization after this planning handoff completes.
