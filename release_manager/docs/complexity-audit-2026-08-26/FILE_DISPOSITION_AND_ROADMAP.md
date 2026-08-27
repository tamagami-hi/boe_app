# File Disposition, Verification, and Simplification Roadmap

This is the forward simplification plan, updated with the product and deployment
decisions accepted on 2026-08-27. It does not authorize source or schema changes
without the preservation and verification gates below.

## KEEP

| Area | Files/directories | Reason |
|---|---|---|
| Server composition | `backend_controller/src/server.ts`, `src/runtime/application.ts`, `src/runtime/composition.ts` | One executable boundary and dependency wiring; extract only when reducing oversized composition |
| Auth/security | `src/domain/auth/**`, `src/http/csrf.ts`, `src/http/rateLimit.ts`, `src/domain/admin/adminAccess.ts` | Token/cookie channels, refresh rotation, CSRF, RBAC, validation |
| Financial outcome | `src/domain/payments/applyCanonicalPaymentOutcome.ts`, payment/order repositories | Transactional state synchronization and ledger integrity |
| Ledger | `src/domain/client/portfolioLedger.ts`, `client_value_entries` schema | Append-only client value authority |
| Provider evidence | PhonePe adapters, `provider_events`, `provider_payment_details` | Signature/re-query/dedup/audit requirements |
| Onboarding | `publicOnboardingRoutes.ts`, `submitApplication.ts`, `decideApplication.ts` | Core signup/approval behavior |
| Deployment safety | `release_manager/stacks/**`, `_shared/**`, migration/backup gates | Production operational boundary; simplify only with deployment evidence |
| Tested contracts | backend tests, contract tests, client/admin critical tests | Regression safety net |
| Product boundary | `sip_plans`, mandate repositories/workers, PhonePe recurring adapter | KEEP SIP/AutoPay; PhonePe performs authorized debit and STANDARD retries; BOE_APP schedules, notifies, reconciles, and settles |

## CONSOLIDATE

| Responsibility | Current files | Target |
|---|---|---|
| HTTP transport | `frontend_stack/packages/client/src/services/_util.js`; `frontend_stack/packages/shared/src/appConfig.js` | One transport with explicit auth/CSRF/error policy |
| API contract | Fastify route schemas; `frontend_stack/packages/contracts` OpenAPI; service assumptions | One enforced source generated/validated in CI |
| Role/session selectors | `client/src/services/authApi.js`, `BrowserRoot.jsx`, `ClientLayout.jsx` | One session/role selector per security channel |
| Amount conversion | `admin/helpers/signedAmounts.js`, `ClientValuesScreen.jsx`, `FundAumPanel.jsx`, client service mappers | Shared `@beonedge/shared/money.js` read conversion plus feature-specific signed/write parsers |
| Payment state mapping | Multiple client/admin service/screen maps | One typed mapping derived from backend contract |
| Form primitives | admin `FormField` and shared form fields | One tested primitive package where styling permits |
| Payment writes | Callback/reconciliation paths | One `applyCanonicalPaymentOutcome.ts` invariant boundary |

## SIMPLIFY

| Area | Evidence | Action |
|---|---|---|
| App config | `shared/src/appConfig.js` (~744 LOC), `admin/src/screens/appBuilder/AppBuilderScreen.jsx` (~494), `appBuilderModel.js` (~108) | Separate presentation config from fixture/conversion; make stale fallback explicit |
| Route modules | `adminCatalogRoutes.ts` 723 LOC; `adminAumRoutes.ts` 639; `clientAutoPaySipRoutes.ts` 642; others 400–700 | Extract cohesive command/query functions; remove pass-through orchestration |
| Admin aliases | `admin/src/Admin.jsx` 15 redirects; `legacyTabMap.js` 13 mappings | Retain only verified links; remove pre-production compatibility paths |
| Client/admin provider stacks | `ClientRoot.jsx`, `BrowserRoot.jsx`, `AdminShell` | Keep security/cache/error boundaries; remove redundant providers after profiling |
| Fixture mode | ~15 production service modules with fixtures/fallbacks | One explicit development fixture adapter or remove |
| Redis | `createRedisCache`, `createRedisClient`, and uncached fallback | KEEP as the isolated shared read cache; do not treat it as the concurrency mechanism or expand it into sessions/queues/locks without evidence |
| Worker surface | email/payment/mandate/SIP entrypoints | KEEP required email/payment/SIP scheduling and reconciliation; remove only duplicate provider execution/retry behavior |
| Monitoring boundary | `release_manager/stacks/monitor_service` | Current eight-service stack is deploy-time separate but repository-coupled; extract to an independently owned monitoring repository, leaving BOE_APP telemetry endpoints only |

## REWRITE (bounded, only after decision)

| Subsystem | Why bounded rewrite may be safer |
|---|---|
| Redemption/withdrawal | UI/service contract exists without backend route/table; either remove the feature or implement one secure end-to-end workflow using existing authorization, transaction, audit, and ledger patterns |
| Mandate subsystem | SIP/AutoPay is required; rewrite only a bounded setup/collection defect around canonical payment outcomes if runtime evidence identifies one |

Do not rewrite authentication, provider verification, or the ledger based on this audit.

## REMOVE (only after reference/build/runtime confirmation)

- `frontend_stack/packages/client/src/data/fixtureMandates.js`, `fixtureOrders.js`, `fixtureSipControlRequests.js`.
- `frontend_stack/packages/ui-kits` and `frontend_stack/preview` (removed after
  confirming no workspace or production imports; retained history is in Git).
- Root `kimi:chunk`, `kimi:run`, `kimi:apply` scripts and unused `agent-browser`/`ngrok` dependencies after CI/tooling owner confirmation.
- Proven-unreachable admin aliases and legacy wrappers.
- Stale audit/docs that describe pre-039 investment review, replacing them with a current decision record.
- `legacy_investment_reviews`, `investor_profiles`, `kyc_documents`, `kyc_reviews`, `risk_assessments`, and `marketing_leads` only through reviewed forward migrations after FK inventory, durable-user/financial-history preservation, row-count checks, statutory-retention/legal-hold review, and deployment backup approval.

## INVESTIGATE FURTHER

- Production reachability of every compose worker and monitoring exporter.
- Whether the deployed SIP/AutoPay workers are scheduled and reachable, and whether their observed provider/webhook behavior matches the source-level Notify-only model.
- Whether AUM intentionally excludes client ledger value.
- Statutory/compliance retention requirement for the designated legacy tables and legal holds. Email OTP must not be treated as regulatory KYC.
- Runtime use of `refund_operations`, `marketing_leads`, and persistent `rate_limit_windows`.
- Whether old admin routes are used by bookmarks/native deep links.
- Why Redis was needed for the historical multi-user/concurrency incident; source inspection alone cannot establish the cause.
- Whether the VPS directories `/srv/dev_stack/BOE_APP/dev_release` and `/srv/dev_stack/BOE_APP/prod_release` match the tracked isolated compose contracts.
- Which ownership model will move `release_manager/stacks/monitor_service` to the planned separate monitoring repository.
- Secret-looking ignored files (`.resources.legacy.TLDR/credentials/*.pem`, `.env*`, `kimi-api-key.txt`, Razorpay CSVs): contents were not printed; rotate/move any live credentials through the secret-management process.

## Verification baseline

Static/test evidence before changes:

- Backend: 73 test files, 663 tests passed (`npm test -- --run`).
- Contracts: 6 files, 95 tests passed.
- Frontend: 67 files, 912 tests; 909 passed and 3 failed in `packages/admin/src/screens/fundStockListPanel.test.jsx` (duplicate accessible text assertions and native max-value validation expectation).

Do not “fix” these failures by weakening assertions during simplification. Re-run the baseline after each slice.

## Staged migration plan

### Stage 0 — Freeze and measure

Capture route registrations, table inventory, frontend route manifests, and test baselines. Add no compatibility code. Mark migration 039 and current settlement behavior as authoritative.

### Stage 1 — Financial invariants

Write focused characterization tests around `applyCanonicalPaymentOutcome.ts`, idempotency, amount equality, allocation/value-entry writes, receipt acknowledgement, and AUM separation. This is the highest regression-risk area.

### Stage 2 — Contract authority

Choose Fastify schemas or generated OpenAPI as authority. Update/remove `packages/contracts` based on actual use. Add CI drift detection between frontend service calls and registered backend paths.

### Stage 3 — Close or remove redemption

Obtain product decision. If removed, delete route/UI/service references together. If retained, design one backend transaction and owner-scoped read model; do not add another parallel balance model.

### Stage 4 — Consolidate frontend transport/state

Route app-config through the canonical transport, centralize role and amount mapping, then remove redundant fixture fallbacks/providers with UI regression checks.

### Stage 5 — Remove compatibility and non-product baggage

After navigation/build/runtime checks, remove admin aliases, legacy wrappers, fixture files, unused UI kit, and unused dependencies. SIP/AutoPay is retained; simplify its workers to scheduling, active-mandate/provider precheck, Notify Redemption, reconciliation, idempotency, and audit/heartbeat duties. Do not add Execute Redemption or a second retry engine while `autoDebit=true` and `STANDARD` remain the canonical PhonePe configuration.

### Stage 6 — Email-verification migration and schema cleanup

Email OTP state has been migrated in source and forward migrations 040/041 from
`kyc_cases`/`kyc_verification_codes` to durable user-linked Email Verification
columns and `email_verification_codes`; active routes/types/labels use the new
terminology. The remaining gate is deployment: verify every existing verified
user and financial record, FK/row counts, statutory retention/legal holds, and a
backup before applying migration 042 to drop the six designated legacy tables.
Keep dev/prod Postgres and Redis isolated and verify actual VPS resources.
Monitoring ownership remains intentionally outside this slice.

## Risks and rollback

Financial, auth, and data migrations require database snapshots and rollback procedures in `release_manager/DEPLOY.md`. UI route removals risk bookmarks/deep links. Contract consolidation risks undocumented consumers. Worker removal risks missed collections/emails. Every stage should ship independently with backend/frontend/contract tests and a production smoke path.
