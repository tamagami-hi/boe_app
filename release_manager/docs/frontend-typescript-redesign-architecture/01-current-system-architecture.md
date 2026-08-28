# 01 — Current System Architecture

Reconstructed from source. Every claim cites a file. Runtime facts about the VPS are marked
`NEEDS RUNTIME VERIFICATION` — the local-machine policy forbids resolving them here.

## System overview

```
   Browser (admin console)          Android APK (client)         Android APK (admin)
   admin.<tailscale>                com.beonedge.app             com.beonedge.app.admin
   cookies + CSRF                   bearer + Secure Storage      bearer + Secure Storage
   Origin: https://admin…           Origin: https://localhost    Origin: https://localhost
          │                                  │                            │
          └──────────────┬───────────────────┴────────────────────────────┘
                         │
                 host nginx on the VPS (not a container, sole public entry, terminates TLS)
                 prod:  /api → 127.0.0.1:47413    SPA → 127.0.0.1:47411
                 dev:   /api → 127.0.0.1:47423    SPA → 127.0.0.1:47421
                 also serves /downloads/{client,admin}/*.apk directly
                         │
                 Fastify backend  (backend_controller, TypeScript, dist/server.js)
                 ├─ registerHttpBoundary  → envelope, request id, security headers, 404
                 ├─ registerCors          → strict allowlist, never '*'
                 ├─ GET /health/live      → registered inline, DB-independent
                 └─ registerRoutes(...)   → 30 route modules, fixed order, 3 conditional
                         │
        ┌────────────────┼─────────────────────────┬──────────────────────┐
        │                │                         │                      │
   PostgreSQL         Redis                   PhonePe                   SMTP
   49 typed tables    read-through cache      Standard Checkout         nodemailer
   34 migrations      5 keys only             + Subscriptions           (SES is a port
   source of truth    NOT auth/queue/lock     external provider          name only)
        │
   5 workers (separate processes, PostgreSQL-coordinated)
   emailWorker · paymentReconciliationWorker · sipScheduleWorker
   mandateCollectionWorker · mandateReconciliationWorker
```

## Frontend, as built today

One Vite application at `frontend_stack/app`, four library packages, **two build-time
targets**. This is not runtime role routing.

- `frontend_stack/app/vite.config.js:9` reads `process.env.VITE_BEO_APP_TARGET`, default
  `'admin'`, and injects it via `define` — a literal substitution, so the unused branch is
  statically eliminated.
- `frontend_stack/app/src/main.jsx:29-36` performs a **single dynamic import** on a ternary:
  `'client'` → `./ClientRoot.jsx`, otherwise `./BrowserRoot.jsx`. The comment at lines 11–28
  is load-bearing: each root module *also* exports `backPolicy` and `probeReachability`
  precisely so that `main.jsx` imports one module per target. Splitting the policy into its
  own import previously defeated dead-branch elimination and shipped the admin chunk plus its
  82 kB stylesheet into the client APK.
- Aliases in `vite.config.js:16-23` map `@beonedge/{design-tokens,shared,client,admin}`
  directly at `../packages/*/src` — source, not built output.
- Manual chunks: `node_modules` → `vendor`; `/packages/admin/` → `admin` plus
  `admin-funds`, `admin-aum`, `admin-appbuilder`, `admin-client-values`,
  `admin-fund-receipts`, `admin-users`, with admin CSS deliberately unchunked;
  `/packages/client/` → `client`. `cssMinify: 'lightningcss'`.

Three env vars, all baked in at build time:
`VITE_BEO_APP_TARGET`, `VITE_BEO_API_MODE`, `VITE_BEO_API_BASE_URL`
(`packages/client/src/services/_util.js`, default base `http://127.0.0.1:47502`).

Three build gates that must be preserved or consciously replaced:

| Script | Enforces |
|--------|----------|
| `app/scripts/check-android-dist.mjs` | No `admin`/`website`/`landing`/`browserroot` asset in a client build; largest JS ≤ 320 kB, largest CSS ≤ 160 kB, total ≤ 1400 kB; no `.woff`; no cyrillic/greek/vietnamese font subsets; **chunk import graph must be acyclic** |
| `app/scripts/check-bundle-boots.mjs` | Every referenced asset exists; every JS chunk evaluates in JSDOM without throwing — the only pre-device smoke test |
| `app/scripts/check-phonepe-native-target.mjs` | Exact PhonePe plugin entries present for `client`, **absent** for `admin`, in `capacitor.settings.gradle`, `capacitor.build.gradle`, `capacitor.plugins.json` |

## Backend

Fastify. `src/server.ts::startServer()` → `composeBackend(env)` → `createApplication(...)` →
`listen`. There is **no route autoloading**: `src/runtime/composition.ts` calls each
`registerXRoutes(application, deps)` in a fixed order.

**Three conditional registration gates.** This is the single most important operational fact
for a frontend author, because a missing endpoint is a configuration symptom, not a bug:

| Condition | Routes that exist only when true |
|-----------|----------------------------------|
| `providerEvents.awsRegion !== null && topicArn !== null` | `POST /v1/provider-events/aws-sns` |
| `paymentGateway !== null` (i.e. `payments.phonepe !== null`) | `/v1/provider-events/phonepe/payment`, `/refund` |
| `paymentGateway !== null && recurringPaymentGateway !== null` | `/v1/provider-events/phonepe/subscription` **and all of `/v1/admin/mandates*` and `/v1/admin/mandate-collections/*`** |

So `GET /v1/admin/mandates` returns `404 RESOURCE_NOT_FOUND` on any deployment without
PhonePe credentials.

Directory shape:

```
src/
├── server.ts, runtime/{application,composition,environment,health,logger,metrics,shutdown}.ts
├── routes/        30 modules
├── domain/        admin/ auth/ client/ email/ onboarding/ payments/ shared/
├── repositories/  38 modules
├── auth/          accessToken, sessionTokens*, refreshDerivation, passwordGate,
│                  passwordHasher, breachCheck, phone
├── http/          boundary, envelope, errorCatalog, validation, cursor,
│                  idempotencyProtocol, rateLimit, cors, requestProvenance
├── cache/         redisClient, cache
├── crypto/        context, primitives
├── email/         emailSender, transactionalEmailSender, emailTemplates, snsProvenance,
│                  certificateFetcher, retrySchedule, ports
├── providers/     phonepe/{paymentGateway, phonePeApiClient, phonePeCheckoutGateway,
│                  phonePeRecurringGateway, gatewayFailure}, recurringPaymentGateway
├── release/       releaseFeed.ts
└── 5 worker entrypoints + 5 guard tests
```

`*` `src/auth/sessionTokens.ts` is **dead code** — referenced only by its own test. Its keyed
HMAC design is not in force; the live path uses `refreshDerivation.hashToken`, an unkeyed
SHA-256.

### HTTP envelope

Success (`src/http/boundary.ts::sendData`):

```json
{ "ok": true, "data": {}, "error": null,
  "meta": { "requestId": "<uuid>", "timestamp": "<ISO>",
            "idempotencyReplay": true,
            "page": { "nextCursor": "…|null", "limit": 25, "hasMore": true } } }
```

Error:

```json
{ "ok": false, "data": null,
  "error": { "code": "VALIDATION_FAILED", "message": "…",
             "fields": { "email": ["Enter a valid email address."] },
             "retryable": false },
  "meta": { "requestId": "…", "timestamp": "…" } }
```

Every response carries `cache-control: no-store`, `x-content-type-options: nosniff`, and
`x-request-id`. `meta.requestId` echoes an incoming `X-Request-Id` only if it matches the
UUID regex in `resolveRequestId`.

**Provider webhooks and the ops endpoints are deliberately not enveloped.**
`/health/live`, `/health/ready`, `/metrics`, and every `/v1/provider-events/*` return raw
bodies.

`src/http/validation.ts::zodFieldErrors` rewrites every machine-generated Zod message into
user-facing prose and never echoes regex sources or rejected key names. Consequence: any
`.refine` message in the backend is **public copy**.

### Authentication and authorization

Two credential classes, split deliberately.

- **Access token is a real JWT.** `src/auth/accessToken.ts`, ES256 only via `jose`,
  600-second TTL, versioned `kid`, claims `iss aud sub sid jti iat nbf exp typ=access`,
  30-second skew. `sub` = `users.id`, `sid` = `auth_sessions.id`.
- **Refresh and CSRF tokens are opaque** and backed by real session rows. Every
  authenticated request re-reads `auth_sessions` (must be `state='active'` and the matching
  `channel`) plus `users.account_state='active'`. A revocation bites immediately inside an
  unexpired JWT.

Two transports over one session machine, distinguished by `auth_sessions.channel`
(`session_channel` enum `('native','web')`, migration `011`). The channels cannot be crossed.

| | `/v1/auth/native/*` | `/v1/auth/web/*` |
|---|---|---|
| Carriage | `Authorization: Bearer <JWT>` | HttpOnly `__Host-boe_access` / `__Host-boe_refresh` (prefix only when `Secure`) |
| CSRF | not needed | `x-csrf-token` vs `auth_sessions.csrf_token_hash` |
| Origin | none | `validateWebOrigin()` — rejects `Sec-Fetch-Site: cross-site`, then `Origin` allowlist, then `Referer` prefix |
| Device | `installationId` UUID → SHA-256 → `device_id_hash`; `platform` must be `"android"`; per-device replacement + cap eviction | none |
| Extra | — | `GET /v1/auth/web/csrf` for reload recovery |

TTLs in both: access 10 min, refresh idle 30 days, session absolute 90 days
(`auth_sessions.expires_at`), refresh grace 30 s.

**Refresh rotation.** Successors are deterministic:
`rawRefresh = base64url(HMAC-SHA256(refreshKey, "boe-refresh-v1|sid|generation|rotationId"))`,
persisted as unkeyed SHA-256. Presenting the current token rotates. Presenting the
*previous* token within 30 s **with the same `rotationId`** re-derives the identical
successor with no write — an idempotent client retry. Anything else calls
`revokeSessionFamily(reason: "refresh_reuse")`, returned rather than thrown so it commits.
Web rotates the CSRF token in lockstep.

**Login hardening** is three-phase specifically to avoid holding a pooled connection across
Argon2id: non-locking read, verification with no DB connection held (with
`verifyDummyPassword` on every pre-failure so unknown-address timing matches), then a short
transaction that locks `users`, re-reads `account_state`, and re-compares the hash to catch a
rotation race. `src/auth/passwordGate.ts` is a process-wide gate (`maxConcurrent 4`,
`maxQueued 64`) rejecting overflow with `RATE_LIMITED`. Every attempt lands in
`auth_login_events`.

**Admin authorization.** `src/domain/admin/adminAccess.ts::resolveAdminPrincipal` picks the
transport (cookie wins when both are present), then reads
`userRepository.findActiveRolesAndPermissions` **live from the database on every request**,
then `requireAnyPermission(principal, required)` failing closed with `AUTHORIZATION_DENIED`.
`src/routes/adminRouteKit.ts` is plumbing, not authorization: limits, idempotency-key
requirement, `If-Match` parsing, signed cursors, `runAdminMutation`.

Frontend role logic (`packages/shared/src/auth/roles.js::hasRole`) is advisory only.

### Email OTP Verification

Canonical state is on `users` (migration `040_email_verification_schema.sql`):

```
email_verification_state       text NOT NULL DEFAULT 'not_started'
                               CHECK IN ('not_started','pending','verified','rejected')
email_verification_started_at  timestamptz NULL
email_verified_at              timestamptz NULL
email_verification_expires_at  timestamptz NULL
```

`'rejected'` is permitted by the CHECK but **no code path writes it**.

Codes live in `email_verification_codes` with `code_hash bytea` (32-byte CHECK),
`code_key_version`, `attempt_count`, `expires_at`, `consumed_at`, and a partial unique index
`WHERE consumed_at IS NULL` — **at most one live code per user**.

`src/domain/client/emailVerification.ts`: 6 characters from a 62-char case-sensitive
alphabet via `randomInt`; hashed by `crypto.hashToken`; TTL 10 min
(`EMAIL_VERIFICATION_CODE_TTL_MS`); resend cooldown 60 s, **DB-backed**; attempt cap 5,
enforced under `lockActiveCode` with constant-time `bytesEqual`; verified validity 365 days.
Requesting a new code consumes the previous one. Audit rows
`email_verification.code_requested` / `.completed` with `metadata { method: "email_otp" }`.

**Two distinct mail paths, and the OTP does not use the outbox.**

1. **OTP: direct synchronous SMTP.** `issueCode` calls `deps.emailSender.send(...)` *after*
   the transaction commits, wrapped so failure becomes `DEPENDENCY_UNAVAILABLE`.
   `createUnconfiguredEmailSender` **rejects** — the header of `src/email/emailSender.ts`
   records the real defect this fixed: the log sender used to resolve successfully, so
   `email_deliveries.state` reached `sent` for mail that never left the process. Note the
   consequence: a transport failure leaves a live unsent code with the cooldown already
   started.
2. **Onboarding decision mail: transactional outbox + worker.** `src/emailWorker.ts` runs
   one pass and exits. `src/domain/email/dispatchDueDeliveries.ts`: recover leases → claim →
   *commit* a `sending` transition (point of no return) → call the transport **outside any
   transaction** → settle in a fresh transaction. Retry ladder
   `[1m, 5m, 15m, 1h, 4h, 12h, 24h]`, `MAX_ATTEMPTS 8`, deterministic jitter from
   `HMAC-SHA256("boe-outbox-jitter-v1", "<eventId>:<attempt>")` so a reschedule is
   idempotent. Roughly 42 h to dead-letter. "SES" is a **port name only** — there is no AWS
   SES in this path; `transactionalEmailSender.ts` renders locally and hands to the same SMTP
   sender.

### Payments

**One PhonePe one-time implementation**, config-selected. `src/providers/phonepe/`
now holds `paymentGateway.ts` (interface + error taxonomy), `phonePeApiClient.ts`,
`phonePeCheckoutGateway.ts` (`StandardCheckoutClient` from `@phonepe-pg/pg-sdk-node`),
`phonePeRecurringGateway.ts`, `gatewayFailure.ts`. `PHONEPE_ENV` is
`z.enum(["sandbox","production"])` mapped to the SDK's `Env`. **Sandbox and production
differ by configuration only; there is no dev-only or prod-only source branch.**
`parsePhonePeConfig` fails closed on any missing credential.

**AutoPay is a second, separate rail** — `providers/recurringPaymentGateway.ts`
(`createMandateSdkOrder`, `getSetupOrderStatus`, `getMandateStatus`, `notifyCollection`,
`getCollectionStatus`), the subscriptions API, not a fork of the same flow.

One-time flow:

```
POST /v1/client/orders          {fundId, amountPaise:"<int>"} + Idempotency-Key  → 201
POST /v1/client/orders/:id/pay  {checkoutChannel:"hosted_redirect"} + Idem       → 200
   Tx A (executeIdempotent): lockOrderForPayment → markOrderPaymentPending →
          lockPaymentByOrder|createPayment → reuse open attempt | createAttempt
          with newMerchantOrderId() and checkout_expires_at
   Dispatch claim (own tx): markAttemptDispatchStarted, only if
          checkout_channel='hosted_redirect' AND state='created'
          AND provider_dispatch_started_at IS NULL
          → if the claim returns null, respond checkout:null and let the client poll
   Provider call OUTSIDE any transaction: paymentGateway.createCheckout(...)
   Tx B: markAttemptDispatched (created → provider_pending, provider_state='PENDING',
          checkout_expires_at = min(provider, local)) + markPaymentProviderPending
→ {orderId, paymentId, provider:"phonepe", status:"payment_in_progress",
   checkout:{type:"redirect", url}, expiresAt}
```

`createCheckout` validates the returned `redirectUrl` against
`config.checkoutAllowedOrigins` (https only, no userinfo, exact origin match) and raises
`GatewayMalformedResponseError` otherwise. `redirectUrl` sent to PhonePe is **`null`** — the
post-payment return target is configured in the PhonePe merchant dashboard, not in this
codebase. `NEEDS RUNTIME VERIFICATION`.

**Webhook ingestion never trusts the payload.** `verifyCallbackAuthorization` computes
`sha256("<callbackUsername>:<callbackPassword>")`, requires a 64-hex `Authorization` header,
and compares with `timingSafeEqual`. The body must parse to an object with top-level `event`
and nested `payload.state`; the legacy `type` field is ignored. The event name must be in
the configured allowlist. Any failure collapses to `PROVIDER_CALLBACK_UNVERIFIED`.
The payload is then AES-256-GCM encrypted into `provider_events` with a semantic
`dedup_key = "<event>:<merchantRef>:<providerState>"` and
`ON CONFLICT (provider, dedup_key) DO NOTHING`. **Then the route re-reads the truth from
the gateway** (`getOrderStatus` / `getRefundStatus`) and applies that.

`src/domain/payments/applyCanonicalPaymentOutcome.ts` is the single convergence point,
shared by the webhook route, the reconciliation worker and the mandate collection worker.
`isCompletedEvidenceValid` demands `providerState === "COMPLETED"`, an echoed merchant order
id equal to ours, `currency === "INR"` on both sides, an exact `amountPaise` match, a
non-null consistent `providerOrderId`, and at least one `COMPLETED` detail whose `BigInt`
sum equals the amount exactly. Any shortfall goes to `reconciliation_required`, never to
success. On valid success, in one transaction: payment details →
`markAttemptSucceeded` → `markPaymentSucceeded` → `markOrderAcceptedOnSettlement` →
**the investment is created**: `insertSystemAllocation`, `insertSystemContribution`,
`createPendingFundReceiptAcknowledgement`, `recordSystemInvestmentSettlement`
(migration `039_immediate_investment_settlement.sql`), with
`requestId = "settlement:<paymentId>"` for idempotence. On failure, if the payment already
succeeded it goes to `reconciliation_required` — money is never un-succeeded.

**Dormant machinery worth knowing about:** `providerEventInboxRepository.claimReceived`,
`reschedule` and `deadLetter` exist but nothing calls them. `provider_events` only ever goes
`received → processed` inline. A webhook whose synchronous processing fails is retried only
by PhonePe redelivery or by the reconciliation worker's polling.

### State machines

| Enum | Values |
|------|--------|
| `order_state` (017) | `submitted, payment_pending, accepted, payment_failed, refund_pending, refunded, refund_failed, cancelled` |
| `payment_state` (018+037) | `created, provider_pending, succeeded, failed, expired, refund_pending, refunded, refund_failed, reconciliation_required` |
| `payment_attempts.state` (038 CHECK) | `created, provider_pending, succeeded, failed, expired, reconciliation_required` (+ `reconciliation_required_at` required iff that state) |
| `sip_state` (017+035) | `draft, pending_mandate, active, paused, cancel_pending, cancelled, completed, setup_failed, mandate_failed, expired, revoked` |
| `sip_collection_mode` (035) | `manual_checkout, phonepe_autopay` |
| `payment_mandate_state` (035) | `setup_pending, active, pause_pending, paused, cancel_pending, cancelled, revoke_pending, revoked, expired, failed` |
| `mandate_setup_state` (035) | `created, dispatching, provider_pending, authorized, failed, expired` |
| `mandate_cancel_command_state` (035) | `queued, dispatching, accepted, rejected, reconciliation_required` |
| `refund_state` | `pending, provider_pending, refunded, failed` |
| `outbox_state` (013) | `pending, processing, sending, delivered, retryable_failed, dead_lettered, cancelled` |
| `user_account_state` (010) | `invited, active, suspended, closed` |
| `auth_login_outcome` (026) | `success, invalid_credentials, unknown_identity, account_not_active, password_changed, not_authorized` |

**Raw internal enums never cross the wire.** `src/domain/client/clientStatus.ts::projectOrderStatus`
projects them; `/pay` and order creation both return the string `payment_in_progress`.

### Database

49 tables in the Kysely `Database` interface (`src/db/types.ts`). 34 migrations in
`backend_controller/db/migrations/`: `009`–`020`, `022`–`043` (no `021`; `001`–`008` archived
out of tree). `043` is untracked.

Declared sources of truth, each verified against code:

| Concept | Source of truth | Verification |
|---------|-----------------|--------------|
| User identity | `users` + `user_credentials` (010) | Created only by `decideApplication` |
| Pre-user application | `applications` (009, reworked 025) | Separate entity; `users.application_id` nullable |
| Fund | `funds` + `fund_versions` + `fund_disclosure_versions` + `fund_stock_disclosures` | Publish pointer makes the catalogue visible |
| Allocation | `investment_allocations` | **Sole writer** is `investmentSettlementRepository.ts:52` |
| Order → payment → allocation → ledger | `investment_orders` → `payments`/`payment_attempts` → `investment_allocations` → `client_value_entries` | Typed chain |
| Payment convergence | `applyCanonicalPaymentOutcome.ts` | The transaction, not the file, owns the writes |
| Client value / balance | append-only `client_value_entries`; balance **derived** by `portfolioLedger.ts::derivePortfolio` | **No stored balance column exists** |
| SIP | `sip_plans` | `sipScheduleWorker` creates due installments |
| Mandate | `payment_mandates` + setup/collection/cancel tables | PhonePe owns the debit |
| Fund AUM | `fund_aum_snapshots` (absolute, operational) | `fundAumRepository` touches only AUM tables |
| Client growth | `client_growth_batches` headers over `client_value_entries` rows of kind `growth_adjustment` | `clientGrowthRepository` writes both |

**Fund AUM and the client ledger are never reconciled against each other.**
`fundAumRepository.ts` touches only `fund_aum_snapshots`/`aum_growth_batches`;
`clientGrowthRepository.ts` writes `client_growth_batches` + `client_value_entries`. No
cross-write exists. Whether that separation is intentional is still an open product
question.

**Referential integrity is restrictive, not cascading.** Every reference into `applications`
is `ON DELETE RESTRICT` (`users.application_id`, `application_consents.application_id`,
`application_reviews.application_id`), and `auth_sessions.user_id → users` is RESTRICT too.
So financial records **cannot** be orphaned by removing an application — the delete simply
fails. The intended disposal mechanism is the PII tombstone (`pii_tombstoned_at`), not
deletion. Two deliberate non-FK exceptions exist in the append-only log:
`auth_login_events.user_id` and `.session_id`, documented at `026_login_events.sql:80-90`
because a log must outlive the rows it describes.

Legacy schema cleanup: `040` added the email-verification columns, `041` backfilled from
`kyc_cases`/`kyc_verification_codes`, and `042` drops seven legacy tables behind a
fail-closed guard (`RAISE EXCEPTION` if any of `investor_profiles`, `kyc_documents`,
`kyc_reviews`, `risk_assessments`, `marketing_leads`, `legacy_investment_reviews` holds a
single row, or if any verified user has a NULL `email_verified_at`, or if any code row is
orphaned).

**Verified on the dev stack, 2026-08-27** (read-only inspection, correcting the prior
doc-derived claim that 042 was unapplied anywhere):

- 33 migrations applied, latest `042_remove_legacy_compliance_tables`.
- `kyc_cases`, `risk_assessments` and `legacy_investment_reviews` all absent — the cleanup
  has landed on dev.
- **`043` is not applied.** `payment_attempts` still carries
  `payment_attempts_sdk_dispatch_channel_check`, the 035 constraint that excludes
  `hosted_redirect`.
- Deployed version `0.11.9`, images `boe-dev-{backend,app,admin}:0.11.9`.

Migration ordering is structural, not procedural: the compose `migrate` service runs
`npm run migrate` from the backend image with `depends_on: postgres service_healthy`, and the
backend depends on its completion. A single `up -d` therefore always migrates before serving.
`NEEDS RUNTIME VERIFICATION` on prod.

### Redis — cache only

Enters at exactly one place, `composition.ts:130-149`: `createRedisCache` when
`cache.configured && redisUrl !== null`, otherwise `createUncachedCache()`, a pass-through
that counts misses. `cache/redisClient.ts` is a single `ioredis` connection with
`enableOfflineQueue: false`, `lazyConnect: true`.

Complete call-site list:

- `publicAppRoutes.ts:109` — `CACHE_KEYS.appConfig` (serves both `/v1/app-config` and `/v1/app/update`)
- `clientCatalogRoutes.ts:118` — `CACHE_KEYS.fundDetail(fundId)`
- `publicContentRoutes.ts:60` — `CACHE_KEYS.publicContent(key)`
- `adminContentRoutes.ts:489` — `invalidate([CACHE_KEYS.supportFaqs])` after FAQ delete
- `adminContentRoutes.ts:496` — `invalidate([CACHE_KEYS.appConfig])` after app-config PATCH
- `composition.ts` `dispose()` → `cache.close()`

Redis is **not** used for sessions (PostgreSQL `auth_sessions`), refresh rotation, rate
limiting (in-process `Map`), locks (PostgreSQL advisory locks via
`idempotencyRepository.tryAcquireTransactionLock`), idempotency records (PostgreSQL),
worker coordination or leases (PostgreSQL outbox + `worker_heartbeats`), or queues. Losing
Redis degrades to serving every read from PostgreSQL, logged once by `reportCacheDegraded`.
Cache errors are counted, never thrown.

**Two dead cache constants:** `CACHE_KEYS.fundList` and both `CACHE_PREFIXES` entries have
no consumer, and `invalidatePrefix` is never called from any route. So **publishing a new
fund version does not invalidate `funds:detail:*`; it expires on TTL only.** That is a real
staleness window the new frontend will observe.

**Rate limiting is in-process only.** `src/http/rateLimit.ts::createFixedWindowRateLimiter`
is a `Map` with a 10 000-entry sweep, wired to exactly one place: `adminAumDeps.rateLimiter`,
hit by the AUM mutation handlers. It does **not** cover login, `/newuser`, OTP, payments,
webhooks or support. Multi-instance deployments get N× the nominal limit. The complexity
audit calls this "a security gap to fix deliberately, not an abstraction to delete."

### Workers

| Worker | Responsibility | Trigger | Coordination | Heartbeat |
|--------|----------------|---------|--------------|-----------|
| `emailWorker.ts` | drain the transactional email outbox | one pass per invocation; compose loops with `EMAIL_WORKER_INTERVAL_SECONDS:-15` | `outboxRepository` claim/lease + `email_deliveries` | `email_dispatch` (health 60 s) |
| `paymentReconciliationWorker.ts` | converge payment attempts and refunds against PhonePe; create investments on confirmed success | long-running loop, `PAYMENT_RECONCILIATION_INTERVAL_SECONDS` | `payment_attempts.next_status_check_at` + `reconciliation_lease_expires_at` + `reconciliation_failure_count`, `FOR UPDATE SKIP LOCKED` | `payment_reconciliation` (health 120 s) |
| `sipScheduleWorker.ts` | materialise due SIP installment orders, advance `next_due_date` | one pass; `SIP_WORKER_INTERVAL_SECONDS:-300` | `listDue` + `lockById` + `findInstallmentByPeriod` (period uniqueness is the idempotence key) | `sip_schedule` (health 900 s) |
| `mandateCollectionWorker.ts` | AutoPay pre-debit notification, collection creation and outcome | one pass; `COLLECTION_WORKER_INTERVAL_SECONDS:-60` | plan/mandate locks + `duePeriod` + merchant-order uniqueness | `mandate_collection` (health 180 s) |
| `mandateReconciliationWorker.ts` | converge mandate and setup-attempt state with PhonePe | **no dedicated entrypoint, no compose service**; invoked from `composition.ts:696` | mandate row locks/leases | **no health check** — flagged. **Confirmed on dev 2026-08-27: only four worker containers run** — `boe-dev-{sips,payments,email,collections}-worker`. There is no mandate-reconciliation worker process |

Reconciliation backoff: `min(maxBackoff, base * 2^failureCount)`, base doubled on
`GatewayThrottledError`. Expiry handling: `providerState === "EXPIRED"` or
`GatewayNotFoundError` past `checkout_expires_at + grace` → `expireAttempt`, unless the
payment already succeeded, in which case `reconciliation_required`.

SIP due-date arithmetic: `advanceOnePlan` requires `state='active'` and
`next_due_date <= today`; if the existing installment order for that period is still open it
stops without advancing; if `accepted`, `elapsedMonths = monthsBetween(startPeriod, duePeriod)+1`,
and either `markCompleted` or `advanceNextDueDate(addMonthClamped(duePeriod, debit_day))`,
clamping to the last day of the next month. AutoPay debits at
`scheduledDebitAt(dueDate)` = 10:00 IST, with a 24 h notification lead and a 48 h collection
expiry.

### Money

Integer minor units everywhere that matters. `amount_paise bigint NOT NULL CHECK (> 0)` on
`payments`, `payment_attempts`, `investment_orders`, `sip_plans`,
`investment_allocations`, refunds. On the wire: **decimal paise strings** —
`createOrderBodySchema.amountPaise: z.string().regex(/^[1-9][0-9]*$/u)`. The file header of
`018_canonical_payments.sql` states it plainly: "Money is integer paise in bigint."
At the provider boundary `paiseToNumber` / `paiseFromNumber` guard
`Number.MAX_SAFE_INTEGER`. Comparisons in the settlement path are `BigInt`.

Frontend conversion is centralised to exactly two functions:
`packages/shared/src/money.js::paiseToRupees` and
`packages/client/src/services/ordersApi.js::rupeesToPaiseString`.

### Deployment

Host nginx on the VPS terminates TLS and is the sole public entry; it is not a container.
Both app containers bind `127.0.0.1` only. Real vhosts live in `release_manager/nginx/`:
`app.beonedge.in` (`/api` → 47413, SPA → 47411), `dev-app.beonedge.in`, and an admin
Tailscale vhost. **Verified dev port map, 2026-08-27:** backend `127.0.0.1:47423`,
client SPA `127.0.0.1:47421`, admin SPA `127.0.0.1:47422`. Every `/api` `proxy_pass`
deliberately has **no trailing slash**, and `Origin $http_origin` is forwarded — which is how
the APK's `Origin: https://localhost` survives to the backend allowlist. Both vhosts also
serve APKs directly from `/downloads/{client,admin}/*.apk` with a catch-all deny.

Unrelated services share the host and must not be disturbed: `boe-landing`,
`market-data-dwndr-{frontend,backend}`, `portview`.

`frontend_stack/app/Dockerfile`, three stages, **build context is `frontend_stack/`**:
`deps` (`node:22.23.2-alpine3.24` by digest, `npm ci`) → `builder`
(`ARG`/`ENV` for the three Vite vars, `npm --workspace app run build`) → `runtime`
(`nginxinc/nginx-unprivileged:1.31.1-alpine3.23-slim` by digest, `USER 101:101`,
`EXPOSE 8080`, healthcheck on `/health`). `app/nginx.conf` is minimal: `listen 8080`,
SPA fallback `try_files $uri $uri/ /index.html`, `location = /health { return 200 "ok\n"; }`.
No cache or compression headers — the host nginx owns those.

`release_manager/export.sh::build_images()` builds three images per stack: backend, client
app, admin app. Two facts matter for the new frontend:

- **The admin image gets a relative API base** (`ADMIN_API_BASE:-/api`), on purpose. The
  admin console is served from a different host whose vhost proxies `/api/` itself. Baking
  the user SPA's absolute origin made every admin call cross-origin and failed three ways
  at once — CORS, `validateWebOrigin()` rejecting `Sec-Fetch-Site: cross-site`, and
  `Secure`/`__Host-` cookies not being sent cross-site. The visible symptom was the admin
  splash never releasing.
- **There is a literal pre-build grep guard:**
  `grep -q 'ARG[[:space:]]\+VITE_BEO_APP_TARGET' frontend_stack/app/Dockerfile`, because
  Docker silently ignores an undeclared `--build-arg` and both images would then be
  identical — the user-facing app would serve the admin UI.

APKs are **not** built by `export.sh`. `emu/boe_update.sh` owns them, keeps an absolute
`https://` origin (a Capacitor WebView has no server to be same-origin with), injects
`applicationId`/`versionCode`/`versionName` via `-PboeApplicationId` etc., and builds the
admin variant with `applicationId = com.beonedge.app.admin`.

Environment isolation: `/srv/dev_stack/BOE_APP/dev_release` and `prod_release`, each with its
own Postgres service and volume, Redis service and volume (namespaced `boe-dev` / `boe-prod`),
networks, container prefix, Compose project, ports and stack-local `.env`. **Neither
publishes a Postgres host port.** Enforced by `release_manager/tests/runtime_contract.test.sh`
plus `stacks/{dev,prod}_release/paths.json`. `NEEDS RUNTIME VERIFICATION` that the deployed
directories match the tracked contracts.

**A documented promotion limitation that the new frontend should fix:**
`DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md` §"Artifact promotion limitation" records that
because the API base is baked into each Vite build, dev and prod archives are **not
byte-identical promotable artifacts**, and that "a future artifact-promotion change should
first make the frontend API base runtime-relative or provide a single runtime configuration
mechanism." A greenfield frontend is the natural place to do that.

## Architecture guards that constrain any change

Five backend test suites enforce invariants. New code must satisfy them.

- **`src/legacy-deletion.guard.test.ts`** — roughly 120 paths must not exist on disk,
  covering the whole legacy Express/JSON-store stack, and specifically including
  `domain/payments/paymentReturnToken.ts` and `routes/paymentReturnRoutes.ts`. A payment
  *return* HTTP route cannot be reintroduced.
- **`src/zero-legacy-js.guard.test.ts`** — zero authored `.js/.jsx/.cjs/.mjs` under `src`
  and `scripts`; no `#`-subpath alias imports.
- **`src/investment-architecture.guard.test.ts`** — 25 deleted modules stay deleted; no
  module may reference nine dropped table names; **client serializers must never leak
  `allocationId`, `bankVerified`, `reviewer`, `privateNote`**; payment / AUM / client-growth
  modules stay mutually separate, with a classifier `/sip|mandate|autopay|recurring/i` that
  auto-enrols new files; both batch-growth orchestrations must recompute a basis hash under
  lock, compare it to the caller's, require an idempotency key, and commit in one
  transaction; and `portfolioProjection`'s source must not contain `nav` or `units`.
- **`src/runtime-boundary.test.ts`** — the superseded JS runtime stays gone, and the
  Dockerfile is constrained: must `RUN npm run build`, must copy `dist`, must reference
  `/health/live`, must be `CMD ["node", "dist/server.js"]`, must not copy `src`, and must pin
  exactly two `FROM …@sha256:` digests.
- **`src/runtime-dependency.guard.test.ts`** — every package imported from `src/` must be a
  production dependency, and the lockfile's `devOnly` set must be empty.

Frontend-side equivalents in `frontend_stack` are scan-based rather than render-based:
`design-tokens/src/cssContract.test.js` (token ownership, z-index literals, hit areas),
`classContract.test.js` (every `adm-`/`ash-`/`be-`/`apk-` class used in a `className` must
exist in a stylesheet), `componentContract.test.js` (a dependency-free `no-undef` for JSX),
`safeArea.test.js`, `interactionContract.test.js`,
`shared/src/motion/motionContract.test.jsx` (no gsap anywhere, `PageTransition` inert),
`app/src/bundleContract.test.js` (dead deps, font subsets, no gateway script tag, artifact
budgets), and the two route-manifest-versus-router drift tests
`client/src/ClientApp.test.jsx` and `admin/src/pages/Admin.test.jsx`.

## CI

`.github/workflows/ci.yml`, on push to `main` and PRs to `main`, three jobs, all pinning
`npm@11.16.0`:

| Job | Directory | Commands |
|-----|-----------|----------|
| `backend` | `backend_controller` | `npm ci` → `npm run check` → `npm run test:integration -- --coverage.enabled=false` |
| `frontend` | `frontend_stack` | `npm ci` → `npm test` → `npm run build` |
| `contracts` | `packages/contracts` | `npm ci` → `npm run check` |

The `contracts` gate is the one that constrains new frontend code:

```
check = typecheck && lint && test:coverage && build && test:exports
        && generate:check && lint:openapi && check:frontend-contract-drift
```

`generate:check` regenerates the OpenAPI artefacts then `git diff --exit-code -- generated`,
so the generated contract must be committed and in sync. `check:frontend-contract-drift`
fails in **both** directions: a new uncontracted path fails, and a *resolved* gap also fails
until the baseline is regenerated with `--write-baseline`. The accepted baseline is
**60 uncontracted paths plus 1 uncontracted method**. `release_manager/tests/runtime_contract.test.sh`
asserts these CI jobs and commands still exist, so they cannot be quietly removed.
