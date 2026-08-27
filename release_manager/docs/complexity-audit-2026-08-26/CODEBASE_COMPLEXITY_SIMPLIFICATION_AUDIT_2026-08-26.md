# Codebase Complexity & Simplification Audit

**Audit date:** 2026-08-26
**Scope:** tracked repository plus runtime-relevant ignored configuration where it affects deployment risk
**Method:** static tracing of imports, route registration, migrations, schema types, UI navigation, tests, and git history. No source code was modified.

## 0. Accepted architectural constraints (2026-08-27)

The following decisions supersede the earlier “optional” or unresolved labels in
this audit:

- SIP and AutoPay are retained product capabilities. The current PhonePe
  adapter sends `autoDebit: true` and `redemptionRetryStrategy: "STANDARD"`.
  The backend schedules due SIPs, verifies the active mandate, creates the
  merchant order, sends Notify Redemption, and reconciles status/webhooks. No
  merchant-side Execute Redemption implementation was found. The workers must
  remain orchestration/reconciliation code and must not implement a second
  debit or retry engine.
- The durable identity is `users` from
  `backend_controller/db/migrations/010_canonical_identity.sql`. Financial
  records reference `users` directly. Email OTP is an account/contact
  verification checkpoint, not regulatory KYC. The committed baseline stores
  that state in the incorrectly named `kyc_cases` and
  `kyc_verification_codes` tables and exposed `/v1/client/kyc/*`; migrations
  040/041 now backfill it into `users.email_verification_*` and
  `email_verification_codes`, and active source uses Email Verification names.
  Migration 042 remains gated on deployed preservation, retention, and
  legal-hold checks before legacy source tables are dropped.
- `legacy_investment_reviews`, `investor_profiles`, `kyc_documents`,
  `kyc_reviews`, `risk_assessments`, and `marketing_leads` are removal
  candidates only through reviewed forward migrations. Before any drop, verify
  foreign keys, row ownership, financial-history relationships, retention or
  legal-hold obligations, and row/relationship counts before and after data
  preservation. Migration 042 now provides the forward, fail-closed cleanup; it
  has not been applied to a deployed database in this audit.
- Dev and production are separate application stacks at
  `/srv/dev_stack/BOE_APP/dev_release` and
  `/srv/dev_stack/BOE_APP/prod_release`. Their compose definitions use separate
  Postgres and Redis services, volumes, networks, projects, and environment
  files. PhonePe application code remains the same; environment configuration
  selects the provider environment. The current compose/release configuration
  should be checked against the VPS before a deployment claim is made.
- Redis is retained. Static tracing shows it is a shared read cache for catalog,
  public content/app data, and app configuration, with PostgreSQL fallback; it
  is not used for sessions, queues, locks, rate limiting, or worker
  coordination. The historical reason it resolved the prior multi-user issue
  cannot be proven from this repository and remains **Needs runtime/history
  verification**; concurrency correctness must not be attributed to Redis
  without that evidence.
- A monitoring deployment already exists inside this repository as
  `release_manager/stacks/monitor_service` with eight compose services. That
  contradicts the requested future boundary of a separate monitoring
  repository. The target is therefore extraction/independent ownership, not
  adding more monitoring logic to BOE_APP. Existing app health/metrics
  endpoints can remain telemetry emission points.

## 1. Executive summary

The product is a single Fastify/PostgreSQL application with two browser experiences (client and admin), native authentication, PhonePe payments, SIP/AutoPay workers, email dispatch, and deployment tooling. The core business is not implemented as microservices: `backend_controller/src/runtime/composition.ts` wires one process and several worker entrypoints over the same database.

The difficulty is cumulative drift, not one sophisticated subsystem. The repository contains:

- Three overlapping contracts: route code, a mostly unused OpenAPI package (`packages/contracts`), and frontend service assumptions.
- A current canonical payment/ledger path alongside a stale investment-review model and stale documentation.
- A production app shell that builds both client and admin libraries, plus fixture-mode implementations and compatibility routes.
- 55 Kysely tables (56 application tables in a fresh post-migration schema, plus `schema_migrations`) for a domain whose core can be expressed with users, funds, allocations, an append-only value ledger, payments, and audit/security tables.
- 94 direct backend route registrations (about 98 broad grep call sites and approximately 100 expanded operations), 36 repository modules, 26 route modules, and giant route-local orchestration files.
- A definite frontend/backend contract break: client redemption/withdrawal screens call `/v1/client/redemptions`, but no backend route or table implements it.
- A disconnected generated contract package and a second raw app-config transport in `frontend_stack/packages/shared/src/appConfig.js`.

The rational recommendation is **Option A: incremental simplification**, beginning with contract and payment/ledger consolidation while preserving SIP/AutoPay. Do not rewrite authentication, authorization, PhonePe verification, or the append-only ledger. Remove only proven dead/fixture/compatibility paths after reference, data-preservation, and runtime confirmation.

Static inspection cannot prove deployed reachability, worker scheduling, or production environment values. SIP/AutoPay retention is now an accepted product decision; only its deployed scheduling and provider behavior remain **Needs runtime verification** below.

## 2. What the application actually does

The active product path is:

```text
External signup site / native client
        -> POST /newuser or native auth
        -> applications + consent + audit
        -> admin approval decision
        -> users + credentials + session
        -> funds/catalog and investment orders
        -> PhonePe payment + callback/reconciliation
        -> payment/order settlement
        -> investment_allocations + client_value_entries
        -> client portfolio and admin oversight
```

The backend currently supports application onboarding, admin approval, cookie and token sessions, RBAC, fund catalog/version/disclosure management, investment orders, PhonePe checkout/callback/reconciliation, client value ledger entries, SIP/AutoPay scheduling, notifications, support requests, content/app configuration, and operational AUM/growth commands. It does **not** provide a generic client withdrawal/redemption API, generic manual deposit endpoint, or generic manual allocation-adjustment endpoint. The withdrawal/redemption UI and service surface was removed in the implementation slice; restoring it remains a separate product decision.

SIP/AutoPay is not an optional product decision. `sipScheduleWorker.ts` creates due
installment orders; `mandateCollectionWorker.ts` checks the mandate and provider
status, creates a payment/collection attempt, sends Notify Redemption, and
reconciles collection facts. `phonePeRecurringGateway.ts` hard-codes and validates
`autoDebit: true` and `redemptionRetryStrategy: "STANDARD"`. No Execute Redemption
call exists in the current source scan. This is the desired PhonePe-managed debit
and retry model; worker simplification should remove only duplicate processing,
not the scheduling or reconciliation responsibilities.

Migration `backend_controller/db/migrations/039_immediate_investment_settlement.sql` is the current financial behavior: successful payment immediately settles the order, creates allocation and client value contribution, and creates a fund-receipt acknowledgement. Older audit documentation in `release_manager/docs/Completed/INTENDED_SCOPE_ARCHITECTURE_AUDIT_2026-08-24.md` describes the pre-039 investment-review flow and is stale relative to current code.

## 3. Current architecture

```text
frontend_stack/app/src/main.jsx
  -> VITE_BEO_APP_TARGET (ClientRoot.jsx OR BrowserRoot.jsx)
  -> @beonedge/client or @beonedge/admin package
  -> services/* API transport
  -> backend_controller/src/server.ts
  -> runtime/composition.ts
  -> route modules
  -> domain functions and repositories
  -> Kysely/pg -> PostgreSQL

workers:
  emailWorker.ts | paymentReconciliationEntrypoint.ts |
  mandateCollectionEntrypoint.ts | sipScheduleEntrypoint.ts
  -> same backend domain/repository code and database
```

`runtime/composition.ts` is an 830-line manual composition root. This is valuable as one wiring location, but route-specific orchestration has grown into 400–723 line modules (`adminCatalogRoutes.ts`, `adminAumRoutes.ts`, `clientAutoPaySipRoutes.ts`, `adminMandateRoutes.ts`, `adminClientGrowthRoutes.ts`). The layering is generally route → domain function → repository → Kysely, not a prohibited seven-layer stack; the main issue is oversized modules and duplicated contracts rather than the existence of every layer.

## 4. Repository map

| Area | Evidence | Status |
|---|---|---|
| Backend API | `backend_controller/src/server.ts`, `src/runtime/{application,composition}.ts` | Active |
| Backend domain | `backend_controller/src/domain/**` | Active, mixed core and retained/legacy features |
| Backend DB | `backend_controller/db/migrations/*.sql`, `src/db/{types,repositories}.ts` | Active; 30 migrations, 55 typed tables |
| Client UI | `frontend_stack/packages/client`, mounted by `ClientRoot.jsx` | Active |
| Admin UI | `frontend_stack/packages/admin`, mounted by `BrowserRoot.jsx`/`Admin.jsx` | Active |
| Shared UI/config | `frontend_stack/packages/shared`, `ui`, `vite` | Active, with fixture/config baggage |
| Contracts | `frontend_stack/packages/contracts` | Tests/generated artifact exist; no runtime imports found |
| UI kits/preview | `frontend_stack/packages/ui-kits`, `frontend_stack/preview` | Removed; no workspace or production imports were found, and bundle tests remain green |
| Deployment | `release_manager/stacks`, `_shared`, `DEPLOY.md` | Active operational tooling |
| Historical reference | `release_manager/BOE_APP/`, `.resources.legacy.TLDR/`, `vault.md` | Archives/ignored; not tracked runtime product |
| Monitoring | `release_manager/stacks/monitor_service` | Eight-service monitoring deployment is tracked here; this is separate at deploy time but **not yet a separate repository** as requested |

The production compose file `release_manager/stacks/prod_release/docker-compose.prod_app.yml` defines 11 service entries: Redis, Postgres, migration/seed jobs, backend, four workers, client SPA, and admin SPA. `release_manager/README.md` states the older `BOE_APP/` pipeline is reference-only. Deployed reachability of each service is **Needs runtime verification**.

## 5. Domain model

```text
application --reviews/consents--> approved application --creates--> user
user --credentials/sessions/roles--> authenticated actor
user --email verification/SIP/orders/payments/notifications/support--> client operations
fund --versions/disclosures/stocks/AUM--> published investment catalogue
investment_order --payment_attempts/provider_details--> payment outcome
investment_order --accepted--> investment_allocation --contributes--> client_value_entry
fund --AUM snapshots--> operational fund reporting (separate from client ledger)
payment_mandate --setup/collection/cancel--> SIP/AutoPay workers
all sensitive mutations --> audit_events; external work --> outbox_events
```

The current canonical investment relationship is `investment_orders` → `payments`/`payment_attempts` → `investment_allocations` → `client_value_entries`. `legacy_investment_reviews` remains physically after migration 039 but is not represented in the Kysely `Database` interface and has no current settlement role. `users` is the durable identity: financial tables use direct `users` foreign keys with restrictive deletion in migrations 017–022 and 039. Migrations 040/041 move Email OTP state to user-linked Email Verification storage, and migration 042 proposes dropping the migration-only source tables. Preservation and deployed verification are still required before cleanup is complete.

## 6. Database model

The committed `backend_controller/src/db/types.ts` baseline defines 55 tables. A fresh
039 migration sequence reaches 56 application tables because `investment_reviews`
is renamed to `legacy_investment_reviews`; `schema_migrations` makes 57 physical
tables. Migrations 040–042 add durable Email Verification state and a guarded
legacy cleanup path; the final physical count after applying 042 depends on the
deployed schema and remains runtime verification. All
counts are static and should be checked against a real production schema
(**Needs runtime verification**).

Core groups are:

- Identity/onboarding: `applications`, `application_consents`, `consent_documents`, `application_reviews`, `users`, `user_credentials`.
- Authentication/RBAC/audit: `auth_sessions`, `auth_refresh_tokens`, `auth_login_events`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_events`, `idempotency_records`, `rate_limit_windows`, `legal_holds`.
- Reliability/email: `outbox_events`, `email_deliveries`, `email_provider_events`, `email_suppressions`.
- Email verification: `users.email_verification_*`, `email_verification_codes`; legacy `kyc_cases`/codes are migration-only source tables for 041/042.
- Designated legacy compliance/profile: `investor_profiles`, `kyc_documents`, `kyc_reviews`, `risk_assessments`.
- Catalogue/reporting: `funds`, `fund_versions`, `fund_disclosure_versions`, `fund_stock_disclosures`, `fund_aum_snapshots`, `aum_growth_batches`, `finance_policy_versions`, `content_items`, `app_config_versions`.
- Investing/payments: `investment_orders`, `payments`, `payment_attempts`, `provider_payment_details`, `provider_events`, `refund_operations`, `investment_allocations`, `fund_receipt_acknowledgements`.
- Ledger/operations: `client_value_entries`, `client_growth_batches`, `notifications`, `support_requests`.
- Retained SIP/mandates: `sip_plans`, `payment_mandates`, `mandate_setup_attempts`, `mandate_collection_attempts`, `mandate_cancel_commands`, `worker_heartbeats`.
- Designated legacy marketing: `marketing_leads`.

Money is stored as integer paise (`bigint` columns). Client balance is derived by summing append-only `client_value_entries` in `backend_controller/src/domain/client/portfolioLedger.ts`; there is no authoritative stored client balance. The same accepted amount is repeated across order, payment, allocation, and ledger rows, protected by foreign keys/checks/settlement logic but costly to reason about.

`fund_aum_snapshots` is an independent absolute-AUM record. Settlement does not update AUM, and AUM commands do not update client value entries. Whether that separation is a deliberate accounting boundary or a missing reconciliation invariant is **Needs runtime verification**.

## 7. Actual execution paths

Detailed traces are in `WORKFLOW_AND_EXECUTION_TRACES.md`. The short form is:

```text
UI -> service function -> registered Fastify route -> domain function
   -> repository/Kysely transaction -> tables -> response envelope
   -> query/cache invalidation -> rendered state
```

The generated OpenAPI artifact (`frontend_stack/packages/contracts/generated/openapi-v1.json`) contains only 15 paths/18 operations and is not imported by backend or frontend runtime code. Therefore it cannot currently be treated as the authoritative execution contract.

## 8. User lifecycle

`publicOnboardingRoutes.ts` receives `POST /newuser` with `x-signup-key`; `submitApplication.ts` writes `applications` in `submitted` state, consent rows, and audit. Admin `POST /v1/admin/applications/:id/decision` invokes `decideApplication.ts`; approval creates an active `users` row and credential, queues outbox/email, and rejection leaves no active account. Native login is `/v1/auth/native/login`; web admin login is `/v1/auth/web/login` with HttpOnly cookie and CSRF. Email OTP now uses `clientEmailVerificationRoutes.ts`, `emailVerification.ts`, `users.email_verification_*`, and `email_verification_codes`; email ownership is not regulatory KYC. Actual deployed row counts and legal-retention obligations remain **Needs runtime verification**.

## 9. Fund lifecycle

Admin fund creation/configuration is registered by `adminCatalogRoutes.ts`; fund versions/disclosures/stocks are persisted and a publish pointer makes catalog data visible. Client catalog reads `/v1/client/funds`. AUM uses `adminAumRoutes.ts` and `fund_aum_snapshots`; this is reporting state, not client ledger state.

### Email OTP terminology boundary

Static tracing found the following KYC-named implementation of what the current
business flow describes as email ownership verification:

| Concern | Current artifact | Required direction |
|---|---|---|
| Persistent status | `users.email_verification_state` and timestamps, queried by `investingEligibility.ts`, `orderRepository.ts`, and `clientPortfolioRepository.ts` | KEEP as the durable user-linked Email Verification state |
| One-time code | `email_verification_codes` and `emailVerificationRepository.ts` | KEEP as short-lived, user-linked OTP material |
| Domain | `domain/client/emailVerification.ts` | Active canonical implementation |
| Routes | `clientEmailVerificationRoutes.ts`: `POST /v1/client/email-verification/start`, `/resend`, `/verify`, and `GET /v1/client/email-verification-status` | Active canonical route/type names |
| Runtime configuration | `EMAIL_VERIFICATION_FROM`, `EMAIL_VERIFICATION_CODE_TTL_MS`, `EMAIL_VERIFICATION_CODE_MAX_ATTEMPTS`, `EMAIL_VERIFICATION_RESEND_COOLDOWN_MS`, `EMAIL_VERIFICATION_VALIDITY_MS` in `runtime/environment.ts` and composition | Canonical Email OTP Verification configuration; deployment examples and validation use the same names |
| Admin/UI wording | `adminOversightRoutes.ts`, `adminOversightRepository.ts`, `UserDetailScreen.jsx`, `helpers/formatters.js` | Use Email Verification status/labels where no regulatory identity review is performed |
| Email/onboarding wording | `emailTemplates.ts`, `emailSender.ts`, `transactionalEmailSender.ts`, `emailWorker.ts`, `submitApplication.ts`, and `publicOnboardingRoutes.ts` | Rename only OTP/account-verification semantics; preserve genuine regulatory, legal, or historical compliance wording |
| Schema/migrations | `014_canonical_compliance.sql`, `019_kyc_email_verification.sql`, `db/types.ts` | Preserve source rows, backfill durable users, then drop/rename obsolete structures through forward migrations |

This list is a semantic rename plan, not evidence that every KYC-named artifact
is safe to rename. `kyc_documents`, `kyc_reviews`, `risk_assessments`, and any
legal/compliance records may represent genuine regulatory retention and require
separate review. **Needs runtime verification:** existing row counts, legal
holds, and whether any production operator/report depends on these tables.

## 10. Allocation lifecycle

Client order checkout starts in `frontend_stack/packages/client/src/screens/LumpsumSheet.jsx`, calls order/payment services, and after canonical success `backend_controller/src/domain/payments/applyCanonicalPaymentOutcome.ts` writes accepted order state, `investment_allocations`, `client_value_entries`, receipt acknowledgement, notification, and audit in a transaction. Admin growth commands (`adminClientGrowthRoutes.ts`) write `client_growth_batches` plus value entries. There is no generic manual allocation endpoint; this is a business capability gap, not merely a hidden implementation.

## 11. Payment lifecycle

The payment path is PhonePe-specific after the Razorpay rewrite. Client order/payment services call backend order/payment routes; provider callback and reconciliation enter `applyCanonicalPaymentOutcome.ts`. The function synchronizes order, payment, and attempt state, records provider evidence, allocates accepted value, creates receipt acknowledgement, and audits. Provider signature/re-query, idempotency, correlation, and encrypted callback retention are security-critical and must remain. Refund operations exist (`refund_operations`, refund repository list/retry/reconcile) but no production `refundRepository.create()` caller was found, so the feature is incomplete/stale.

## 12. Frontend architecture

`frontend_stack/app/src/main.jsx` build-time selects exactly one target. Client provider stack includes `SessionProvider`, `CheckoutProvider`, `ResourceCacheProvider`, eviction/recovery, error boundary, then `ClientApp`; admin adds admin session, cache eviction, toast, approvals queue, heading providers. The earlier admin compatibility aliases and `legacyTabMap.js` were removed in the implementation slice; `pages/legacy/legacyRoutes.jsx` remains imported by `Admin.jsx`, so “legacy” wrapper code is still active.

The client transport `packages/client/src/services/_util.js::apiRequest` is the strongest canonical transport. `packages/shared/src/appConfig.js::appConfigRequest` separately implements base URL, auth, and CSRF handling, duplicating transport behavior. Fixture mode is spread across approximately 15 production service modules and can render local/stale data when remote config fails (`useAppConfig.js`). This is disproportionate for CRUD screens.

## 13. Backend architecture

There are 26 production route modules, 36 repository modules, and 28 non-test domain modules (counts exclude tests; static counts). The route-to-repository layering is defensible for security and transactions, but several route modules combine parsing, authorization, orchestration, and response mapping in giant files. `runtime/composition.ts` manually injects every dependency and optional provider route. The simplification target is not “remove all layers”; it is to keep a small domain/service boundary and collapse pass-through wrappers while extracting cohesive financial operations.

## 14. Duplicate implementations and contract drift

| Responsibility | Implementation A | Implementation B | Active usage | Recommendation |
|---|---|---|---|---|
| HTTP transport | `client/src/services/_util.js::apiRequest` | `shared/src/appConfig.js::appConfigRequest` | Both | Consolidate on one transport; runtime auth behavior needs verification |
| Client balance/value | `domain/client/portfolioLedger.ts` | frontend paise/rupee/signed-value helpers (`ClientValuesScreen.jsx`, `FundAumPanel.jsx`, `signedAmounts.js`) | Backend canonical plus repeated UI calculations | Backend remains authority; one shared display conversion |
| Role parsing | `authApi.hasRole` | `BrowserRoot.jsx`, `ClientLayout.jsx` checks | Active | One session/authorization selector |
| Forms | admin `FormField` | shared form field components | Active in separate packages | Consolidate primitives after visual regression checks |
| Fixture business data | `fixture*.js` files and service fallbacks | inline fixtures in `ordersApi.js` and related services | Build/test/fallback paths | Remove after explicit fixture-mode decision |
| Payment state mapping | order/payment/attempt maps in multiple service/screen files | backend canonical mapper | Active | Generate/use one contract mapping |
| API contract | runtime Fastify routes | `packages/contracts` OpenAPI (15 paths) | Runtime ignores generated contract | Make route schema or generated contract authoritative |
| Withdrawal/redemption | Removed client redemption route/page/service surface | no backend route/table | No executable implementation; product scope still needs explicit confirmation | Keep removed unless a secure end-to-end withdrawal contract is approved |

## 15. Dead and stale code

### Definitely dead or non-production

- `frontend_stack/packages/client/src/data/fixtureMandates.js`, `fixtureOrders.js`, `fixtureSipControlRequests.js`: no production imports found; verify test-only consumers before removal.
- `frontend_stack/packages/ui-kits` and `frontend_stack/preview`: removed after
  no-import/workspace checks; the bundle contract still forbids reintroduction.
- Root scripts `kimi:chunk`, `kimi:run`, `kimi:apply` reference absent `scripts/kimi/*`; root dependencies `agent-browser` and `ngrok` have no runtime references (Playwright is used by `test_e2e/signup-users.mjs`).
- `legacy_investment_reviews`: physically retained after 039, absent from current typed schema and settlement path; designated for removal through a preserving forward migration.

### Probably stale or incomplete

- `refund_operations` and refund repository operations without a create caller.
- `risk_assessments`, `investor_profiles`, `kyc_documents`, `kyc_reviews`, and `marketing_leads`: schema/read/seed presence exceeds current write workflows and are designated removal candidates, subject to FK, preservation, statutory-retention, and legal-hold checks.
- `kyc_cases` and `kyc_verification_codes`: migration-only source tables; removable only when migration 042 passes deployed preservation/retention/legal-hold gates.
- Persistent `rate_limit_windows` table versus in-process `http/rateLimit.ts` map.
- Admin compatibility routes and legacy tab map.
- Withdrawal/redemption client UI and `adminReason` display not populated by `mapRedemptionRequest`.
- Stale audit docs describing investment review after migration 039.

No file is classified dead solely because its name says “legacy”; `pages/legacy/legacyRoutes.jsx` is actively imported. Reachability of ignored archives and deployed routes is **Needs runtime verification**.

## 16. Multiple sources of truth

| Fact | Current writable representations | Authority | Risk |
|---|---|---|---|
| Client invested/current value | `client_value_entries`; derived sum in `portfolioLedger.ts`; allocation amount; payment/order amount | Append-only value entries for client display | Repeated amounts can diverge if transaction boundaries fail |
| Payment outcome | order state, payment state, attempt state, provider events/details, receipt acknowledgement | `applyCanonicalPaymentOutcome.ts` core transaction plus provider evidence | Multiple state projections require invariant tests |
| Fund AUM | `fund_aum_snapshots`, AUM growth batches | AUM snapshots, independent of client ledger | No automatic reconciliation invariant (**Needs runtime verification**) |
| Auth/session | access token, DB session/refresh rows, cookie session, frontend session cache | DB sessions + signed token validation | Two channels are security-driven; avoid extra UI caches |
| App configuration | `app_config_versions`, remote config, local fixture/stale cache | Remote published config when available | `useAppConfig.js` can hide remote failures |
| API contract | Fastify route schemas, frontend service assumptions, OpenAPI artifact | No single enforced source | High drift risk |

The simplified design should make one authority explicit per fact and make all projections read-only or transactionally derived.

## 17. Unnecessary abstraction

The largest low-value complexity is not PostgreSQL or Fastify; it is parallel representations. Examples are the disconnected contract artifact, raw app-config transport, fixture-mode services, compatibility redirects, legacy wrappers, and giant route files that mix concerns. Repository modules are justified where they enforce ownership, transactions, and query boundaries; pass-through repositories that only rename a Kysely call should be consolidated cautiously. Redis is retained for the measured shared read-cache role (`createRedisCache` with PostgreSQL fallback), not as financial truth or a general concurrency mechanism.

## 18. Historical architectural drift

Git history shows several transitions:

1. `a7355e3` initial snapshot (2026-05-20), then `eee6a8e` modularization and `522d3a0` JSON DB removal.
2. July TypeScript/canonical runtime (`9e884ad`) plus migrations 009–018 for onboarding, identity, sessions, RBAC, outbox, compliance, catalog, investing, and payments; old JS paths later deleted (`365ca1c`, `0c7de87`, `7ccac7f`, `f0745a1`, `c2468b8`), while migrations 001–008 were archived (`622250b`).
3. Onboarding rewrite (`7c8aec5`, migration 025) removed verification-token/invite paths.
4. PhonePe greenfield payment reset (`9c7030e`, `932f400`) removed Razorpay and changed settlement semantics.
5. AutoPay/SIP expansion (`e4e85a6` and related commits) added mandates, providers, workers, and UI.
6. Immediate settlement/receipt acknowledgement (`9c78e5e`, `eb3ae06`, `9b0ed63`, migration 039) retired the old review flow but left `legacy_investment_reviews` and stale docs.

This sequence explains why names, tables, routes, and UI generations disagree: each rewrite solved a local problem without a final consolidation pass.

## 19. Infrastructure and dependency complexity

Production compose has 11 app-related services; the tracked `monitor_service`
stack adds Prometheus, Grafana, Alertmanager, node exporter, cAdvisor, blackbox
exporter, and two PostgreSQL exporters. This is a separately deployed
operational stack but it remains repository-coupled, contrary to the requested
separate monitoring repository. Its deployed usage is **Needs runtime
verification**. Release scripts are active and should not be collapsed casually.
`release_manager/README.md` identifies `BOE_APP/` as reference-only.

Potential simplifications after proof:

- Remove unused root Kimi scripts/dependencies and unreferenced UI kit workspace.
- Keep one frontend build shell, but avoid shipping both package trees if deployment can build target-specific bundles.
- Keep workers only for retained email/payment/SIP responsibilities; the SIP workers must not duplicate PhonePe debit or retry behavior.
- Keep Redis isolated per environment for shared read caching; do not expand its role without evidence.
- Keep health/metrics/log/audit emission in BOE_APP, but move collection, dashboards, alerts, and backup operations to the separately owned monitoring repository; the currently tracked `monitor_service` is an extraction boundary.

## 20. Security-critical complexity that should remain

Do not simplify away ES256 access tokens (`auth/accessToken.ts`), Argon2id hashing (`passwordHasher.ts`), password gate (`passwordGate.ts`), refresh rotation/reuse-family revocation (`nativeAuth.ts`, `webAuth.ts`, `authSessionRepository.ts`), HttpOnly/Secure/SameSite cookies, synchronizer CSRF and Origin/Sec-Fetch checks, channel-bound native/web sessions, live account-state checks, RBAC reload (`domain/admin/adminAccess.ts`), owner-scoped SQL reads, Zod validation/body bounds, DB transactions/locks/idempotency, PhonePe signature plus provider re-query, encrypted callback retention/dedup, payment correlation, append-only ledger, audit events, CORS, internal Postgres networking, non-root/cap-drop containers, and migration health gates/backups.

The current rate limiter is an in-process map in `http/rateLimit.ts` and is used for only four AUM writes; login, onboarding, Email OTP, payments, webhooks, and support are not covered. `rate_limit_windows` exists but is not used by the runtime limiter. This is a security gap to fix deliberately, not an abstraction to delete.

## 21. Complexity metrics

| Metric | Static count/evidence | Proportionality assessment |
|---|---:|---|
| Tracked files | 939 | Includes docs/tests/deploy; broad surface |
| Source files | 708 tracked TS/TSX/JS/JSX/CSS/SQL/SH | High for core CRUD/ledger product |
| Backend production TS | 156 files / ~29,905 LOC | Moderate-large; giant route modules |
| Frontend production app/client/admin/shared | ~229 files / ~27,008 LOC | High; fixtures/config/compatibility contribute |
| Backend route modules | 26 | Consolidate by domain boundary, not blindly flatten |
| Direct route registrations | 94 (about 98 broad call sites; ~100 expanded) | High but partly expected for admin/client surface |
| Repository modules | 36 | Some valuable, some pass-through |
| Typed DB tables | 55 | High; many optional/incomplete domains |
| SQL migrations | 30 / ~3,339 LOC | Historical drift visible |
| Client route destinations | 22 manifest / 26 route elements | Reasonable with aliases |
| Admin route elements | 44, including 15 redirects | Compatibility burden |
| OpenAPI paths | 15 / 18 operations | Incomplete and disconnected |
| Backend tests | 73 files / 663 passing tests | Strong safety net |
| Contract tests | 6 files / 95 passing tests | Tests artifact, not runtime contract |
| Frontend tests | 67 files / 912 total; 909 pass, 3 fail | Current red baseline in fund stock panel |
| App-config implementation | ~1,346 LOC across shared/admin/model | Disproportionate to presentation config |

Counts are static and should be re-run after any cleanup. Test failure details are recorded in `FILE_DISPOSITION_AND_ROADMAP.md`; no tests were changed.

## 22. Root cause analysis

Evidence supports these causes:

- Repeated architecture rewrites left historical migrations, wrappers, docs, and tables (`git` sequence in §18).
- AI/parallel development likely amplified duplication, but repository evidence can prove duplication, not agent causality; treat the causal attribution as **Needs process verification**.
- No canonical contract: runtime routes, frontend assumptions, and disconnected OpenAPI package diverge.
- Feature work preceded schema consolidation: AutoPay/SIP and immediate settlement were layered onto prior payment/investment concepts.
- Stale code was retained for compatibility despite pre-production forward-only rules (`Admin.jsx` redirects, legacy routes, fixture fallbacks).
- Multiple writable/derived financial representations increase cognitive load even when transactionally protected.
- Large composition and route files make local changes difficult to validate end to end.

## 23. Minimal Correct Architecture

```text
                 Client SPA / Admin SPA / native client
                                  |
                         Fastify API (one process)
                                  |
             small domain services (auth, onboarding, funds,
                 orders/payments, ledger, SIP/AutoPay, admin ops)
                                  |
               PostgreSQL (one canonical schema + append-only ledger)
                       |                          |
                 PhonePe callbacks       email/outbox worker
                       |                          |
             payment/SIP reconciliation workers

        DEV stack: one app deployment + PostgreSQL DEV + Redis DEV
        PROD stack: one app deployment + PostgreSQL PROD + Redis PROD
        Monitoring/operations: separate repository and deployment
```

Keep SIP/AutoPay as a bounded required subsystem. Use one order/payment outcome
service, one allocation/ledger writer, one frontend transport, and one enforced
API schema. PhonePe receives Notify Redemption with `autoDebit=true` and
`redemptionRetryStrategy="STANDARD"`; the backend schedules due plans and
reconciles outcomes, but does not perform merchant-side Execute Redemption or a
second retry engine. Keep audit/idempotency/security tables. Remove compatibility
and fixture paths once verified unused. Keep BOE_APP observability endpoints,
while the monitoring repository owns collection and visualization.

## 24. Current vs proposed architecture

| Area | Current | Minimal target | Reduction |
|---|---|---|---|
| Authentication | Native token + web cookie channels, duplicated UI role parsing | Keep two security channels; one session selector | Remove UI duplication, retain security boundary |
| Users | Applications, reviews, users, credential records, and KYC-named Email OTP state | Keep onboarding, durable `users`, credentials, and user-linked Email Verification; remove legacy compliance workflows only after preservation | Fewer active write paths without losing verified users |
| Funds | Funds, versions, disclosures, stocks, AUM, growth batches | Keep catalogue/version/disclosure; isolate optional AUM | Smaller core, explicit reporting boundary |
| Allocations | Orders, payments, allocation, value entries, receipts, growth | One settlement service writes allocation + ledger transactionally | One canonical write path |
| Payments | Order/payment/attempt/provider/mandate/refund/event projections | Keep provider evidence, idempotent outcome, and SIP/AutoPay mandate paths; remove only unused refund paths | Fewer projections while retaining recurring payments |
| Frontend state | Multiple providers, fixture fallback, caches, repeated transport | One auth/cache/query policy per target, one transport | Less synchronization code |
| Database | 55 typed tables plus KYC-named Email OTP and legacy tables | Durable users + Email Verification, canonical financial core, retained SIP/AutoPay, and only legally/operationally required tables | Lower cognitive and migration burden with preservation guarantees |
| Contracts | Runtime routes + disconnected OpenAPI + service assumptions | Route schemas generate/validate client contract | Prevent drift |

## 25. KEEP / CONSOLIDATE / SIMPLIFY / REWRITE / REMOVE matrix

See the exact file matrix in `FILE_DISPOSITION_AND_ROADMAP.md`. In summary: **KEEP** security, transaction/ledger, provider verification, deployment safety, onboarding, SIP/AutoPay, Redis cache infrastructure, and financial history; **CONSOLIDATE** transport, payment outcome mapping, role parsing, API contract, and financial display conversions; **SIMPLIFY** app config, route-local orchestration, compatibility aliases, fixture mode, worker responsibilities, and monitoring ownership; **REWRITE** only the broken redemption workflow if the business confirms it; **REMOVE** proven dead UI kits, fixture files, Kimi scripts, stale docs, and designated legacy tables only after forward migration and data-preservation checks.

## 26. Migration strategy

| Option | Risk | Effort | Assessment |
|---|---|---|---|
| A. Incremental simplification | Low–medium; each slice testable | Medium | **Recommended**; preserves secure financial foundation |
| B. Controlled subsystem rewrite | Medium–high; contract/data migration risk | Medium–high | Use only for confirmed broken redemption or a bounded SIP/AutoPay defect; retain the provider-managed debit contract |
| C. Clean rebuild | Highest; auth/payment/data-loss/regression risk | High despite small domain | Not justified by static evidence |

Recommended order: establish contract truth; freeze/verify financial invariants; consolidate frontend transport; verify the Notify-only SIP/AutoPay worker boundary; remove fixture/compatibility paths; migrate Email OTP naming/state to durable `users`; then archive/drop designated unused schema with forward migrations and preservation checks. Never dual-write or preserve compatibility branches unless production migration requirements change the pre-production rule.

## 27. Prioritized simplification roadmap

1. **Baseline and contract inventory:** record route/schema/DB snapshots; run backend, contract, and frontend tests; fix/triage the three existing fund-stock test failures without changing behavior.
2. **Financial invariants:** document and test `applyCanonicalPaymentOutcome.ts`, allocation/value-entry amounts, idempotency, and AUM boundary.
3. **API authority:** make Fastify schemas or generated OpenAPI authoritative; either wire `packages/contracts` or remove it.
4. **Close the withdrawal gap:** product decision: implement a secure redemption workflow end to end, or remove/disable the client withdrawal UI and services.
5. **Transport/state consolidation:** route app-config through canonical `apiRequest`; centralize role parsing, signed amount conversion, and payment-state mapping.
6. **Remove proven fixture/compatibility code:** fixture files, old tab redirects, legacy wrappers, and unreferenced UI kit after runtime navigation/build checks.
7. **SIP/AutoPay boundary:** retain the required subsystem; verify deployed worker scheduling and ensure the source remains Notify-only with PhonePe-managed debit/retry (`autoDebit=true`, `STANDARD`).
8. **Email Verification and schema cleanup:** migrate KYC-named Email OTP state to durable `users`, rename only email-verification semantics, then archive/drop the six designated legacy tables through forward migrations after data, backup, FK, retention, and legal-hold review.
9. **Operational hardening:** extend rate limiting to critical ingress, verify webhook exposure, confirm VPS dev/prod isolation, and extract the tracked monitoring deployment to its separate repository while retaining Redis cache and BOE_APP telemetry endpoints.

## 28. Exact files/directories affected by a future simplification

Primary targets are listed in `FILE_DISPOSITION_AND_ROADMAP.md`; notable directories are `backend_controller/src/runtime`, `src/routes`, `src/domain/payments`, `src/domain/client`, `src/db`, `frontend_stack/packages/client/src/services`, `frontend_stack/packages/shared/src/appConfig.js`, `frontend_stack/packages/admin/src`, `frontend_stack/packages/contracts`, and `release_manager/docs`. The UI-kit/preview reference surfaces were removed after verification.

## 29. Risks and regression-sensitive areas

- Payment callback/reconciliation idempotency and provider correlation.
- Order/payment/attempt state synchronization and ledger append-only semantics.
- Client owner scoping and admin RBAC.
- CSRF/cookie/token channel separation and refresh rotation.
- Onboarding approval transaction and outbox email delivery.
- Fund publish/version/disclosure pointers.
- Worker schedules and retry/dead-letter behavior.
- Migration 039 data state and `legacy_investment_reviews` production contents.
- Frontend route aliases used by deployed bookmarks or native deep links (**Needs runtime verification**).
- Existing frontend red tests in `fundStockListPanel.test.jsx`.

## 30. Final verdict

The repository is not inexplicably complex because the business requires a large distributed system. It is difficult because several valid implementations accumulated without a final authority pass: payment models were reset, recurring payments were added, settlement semantics changed, UI generations remained reachable, and contracts diverged. The secure core is salvageable and tested. The smallest reliable path is an incremental consolidation around one API contract, one payment outcome/ledger writer, one frontend transport, a bounded required SIP/AutoPay subsystem using PhonePe-managed debit/retry, durable Email Verification on `users`, and removal of proven historical paths. A clean rebuild is not supported by the evidence.
