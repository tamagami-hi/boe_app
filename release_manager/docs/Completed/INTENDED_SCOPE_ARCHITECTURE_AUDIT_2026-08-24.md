# Intended-Scope Architecture Audit

**Audit date:** 2026-08-24
**Repository:** `/home/nethunter07/PROJECTS/boe_app`
**Audit basis:** current working tree, including local uncommitted Fund/AUM changes present on the audit date
**Requested target:** users, SIP and lumpsum investments, user investment records, AUM fund pools, user-to-pool allocation, admin-controlled growth/performance, email verification, and KYC verification

## 1. Executive conclusion

The active runtime is a TypeScript modular monolith with a Fastify/PostgreSQL backend, a shared API-contract package, one React/Vite shell built as either a client or admin application, three background workers, and Capacitor Android packaging. It is not a broad microservice platform.

The financial core already covers much of the requested product:

- admin-created and published fund pools;
- client-visible published funds and fund detail;
- SIP plans and lumpsum orders;
- PhonePe checkout, callback/inquiry processing, payment evidence and refunds;
- private admin review and full allocation to the selected fund;
- immutable client contribution/growth/reversal entries;
- portfolio, transaction, order, payment and statement projections;
- admin-controlled individual and pool-wide client growth;
- admin-controlled fund AUM snapshots, individual growth, collective growth, history and corrections;
- user administration, RBAC, audit, email delivery and KYC-related controls.

However, it does **not fully match** the requested end-to-end semantics:

1. Signup does not verify email before account creation. `POST /newuser` creates an application directly in `submitted`; an admin approves it into an active account. Email verification happens only later through the flow called KYC.
2. The implemented “KYC” is an emailed six-character OTP that automatically approves a KYC case. It proves access to an email address, not identity/KYC in the usual sense; the richer KYC document/review schema is not connected to that flow.
3. SIP is a schedule/reminder. It creates monthly installment orders, but every installment requires a fresh manual PhonePe checkout; there is no mandate or automatic debit.
4. Client investment value growth and fund AUM growth are deliberately independent admin commands. Fund performance does not derive user performance, user allocations do not change AUM, and there is no reconciliation between aggregate client positions and fund AUM.
5. Several live UI and content capabilities are outside the requested product boundary, most notably redemptions/withdrawals (frontend without backend), research/editorial content, FAQs/support tickets, notifications, app-builder/config publishing, investor-charter/grievance content, device PIN/biometrics, app self-update, stock disclosures, and a monitoring stack.
6. Several database capabilities are stale or only partially used: `marketing_leads`, `legal_holds`, `finance_policy_versions`, `risk_assessments`, `investor_profiles`, `kyc_documents`, and parts of `kyc_reviews` have no complete active product workflow. Historical migrations already drop other obsolete concepts (`courses`, `membership_plans`, `fund_positions`, and `approval_actions`).

The correct direction is consolidation, not a redesign: retain the modular monolith and financial integrity controls; make verification/KYC semantics explicit; decide whether SIP must be automated; make one authoritative performance policy; remove broken/out-of-scope surfaces and stale schema; and expose a smaller API/UI organized around Users, Investments, Funds/AUM, Verification, and Administration.

## 2. Sources and inspection boundary

The active architecture was established from:

- runtime composition: `backend_controller/src/runtime/composition.ts`;
- server entry points: `backend_controller/src/server.ts`, `emailWorker.ts`, `paymentReconciliationEntrypoint.ts`, `sipScheduleEntrypoint.ts`;
- active routes: `backend_controller/src/routes/*.ts`;
- domain commands: `backend_controller/src/domain/**`;
- repositories and Kysely schema: `backend_controller/src/repositories/**`, `backend_controller/src/db/types.ts`;
- raw PostgreSQL migrations: `backend_controller/db/migrations/009_*.sql` through `032_*.sql`;
- API descriptors: `packages/contracts/src/operations/**` and generated OpenAPI files;
- client routing/screens/services: `frontend_stack/packages/client/src/**`;
- admin routing/screens/data access: `frontend_stack/packages/admin/src/**`;
- build selection: `frontend_stack/app/src/BrowserRoot.jsx`, `ClientRoot.jsx`, and `frontend_stack/app/vite.config.js`;
- deployment topology: `release_manager/stacks/dev_release/docker-compose.dev_app.yml` and `release_manager/stacks/prod_release/docker-compose.prod_app.yml`.

`.resources.legacy.TLDR/` and `vault.md/` are repository-local archives/knowledge material, not imported runtime code. They are repository bloat but are not classified as live product functionality.

The existing `PRODUCT.md` describes an education-only public membership product. That document conflicts with the active investment code and with this audit’s requested target. The runtime code and migrations are treated as implementation truth; the documentation conflict is itself an architecture/governance issue.

## 3. Current architecture overview

```text
External public signup site (separate repository/infrastructure)
                         |
                         | POST /newuser + shared secret
                         v
Client web/Android SPA --+--> Fastify API --> PostgreSQL
Admin web/Android SPA ---+         |              |
                                  Redis          migrations/seeds
                                   |
               +-------------------+--------------------+
               |                   |                    |
          Email worker       Payment worker        SIP worker
          SMTP + AWS SNS     PhonePe inquiry/       monthly due-order
          delivery events    refund recovery        generation
```

### 3.1 Runtime shape

- **Backend:** Node 22, TypeScript, Fastify 5, Zod boundary validation, Kysely, PostgreSQL, Pino, JOSE and Argon2 (`backend_controller/package.json`).
- **Cache:** Redis via `ioredis`, with an uncached PostgreSQL fallback (`src/cache/cache.ts`, `src/runtime/composition.ts`).
- **Frontend:** React 18, React Router and Vite. The same `frontend_stack/app` is built with `VITE_BEO_APP_TARGET=client` or admin; client/admin are workspace libraries, not separately implemented shells.
- **Mobile:** Capacitor Android, secure storage, native biometrics and local notifications (`frontend_stack/app/package.json`).
- **Contracts:** a separate `packages/contracts` package contains wire scalars, envelopes, errors and operation descriptors, then generates OpenAPI.
- **Deployment:** PostgreSQL, Redis, migration job, seed job, backend, payment/email/SIP workers, and two static frontend images. The monitoring stack is separate.

### 3.2 Architectural pattern

The backend is a layered modular monolith:

```text
HTTP route + Zod validation/authentication
                |
                v
domain command / projection logic
                |
                v
repository interface + Kysely/SQL
                |
                v
PostgreSQL transaction
```

`runtime/composition.ts` manually wires repositories and services. Unsafe financial/admin commands generally use unit-of-work transactions, idempotency records, audit events, RBAC checks and explicit state transitions. This is suitable for the requested target and should be retained.

## 4. Current functional modules

| Module | Main implementation evidence | Current function | Scope status |
|---|---|---|---|
| Public onboarding | `routes/publicOnboardingRoutes.ts`, `domain/onboarding/submitApplication.ts` | Shared-secret server-to-server signup, password hashing, consent capture, application queue | Required, but verification ordering differs |
| Authentication/session | `routes/nativeAuthRoutes.ts`, `webAuthRoutes.ts`, `domain/auth/*`, `auth/*` | Native bearer and web cookie/CSRF sessions, refresh rotation, login history | Required support |
| User approval/management | `routes/adminIdentityRoutes.ts`, `adminOversightRoutes.ts`, `ApprovalsScreen.jsx`, `UserDetailsListScreen.jsx`, `UserDetailScreen.jsx` | Approve/reject signup, create active account, directory, detail, suspend/reinstate/close | Required and implemented |
| Email delivery | `domain/email/*`, `email/*`, `emailWorker.ts`, `providerEventRoutes.ts` | Approval/rejection email, KYC OTP email, outbox, retries, SES delivery/bounce/complaint evidence | Email verification support; mostly required |
| KYC | `routes/clientKycRoutes.ts`, `domain/client/kyc.ts`, `repositories/kycRepository.ts`, `KycVerify.jsx`, `KycDetail.jsx` | Email OTP opens and automatically approves a KYC case | Allowed, but functionally incomplete as KYC |
| Fund catalogue | `routes/adminCatalogRoutes.ts`, `clientCatalogRoutes.ts`, `adminCatalogRepository.ts`, `clientCatalogRepository.ts` | Create/version/publish/pause/archive funds; client reads published funds | Required and implemented |
| Fund stock disclosures | `fund_stock_disclosures`, `FundStockListPanel.jsx` | Admin manages stock names, quarter, weights and exit state; client reads holdings analysis | Optional/outside minimal target |
| Lumpsum orders | `domain/client/createOrder.ts`, `routes/clientOrderRoutes.ts`, `LumpsumSheet.jsx` | Validate eligibility/fund/minimum, create order and PhonePe checkout | Required and implemented |
| SIP plans | `routes/clientSipPlanRoutes.ts`, `sipScheduleWorker.ts`, `sip_plans`, `StartSipSheet.jsx`, `MandateDetail.jsx` | Create/pause/resume/cancel plan and generate monthly installment orders | Required core, but manual-payment SIP only |
| Payments | `providers/phonepe/*`, `phonePeProviderEventRoutes.ts`, `paymentReconciliationWorker.ts`, `payments*` repositories | Checkout, callback authentication/inbox, inquiry, reconciliation, refund | Necessary investment support and implemented |
| Investment review/allocation | `routes/adminInvestmentReviewRoutes.ts`, `investmentReviewRepository.ts`, `InvestmentReviewScreen.jsx` | Successful payments wait for admin bank attestation; accept allocates full amount to selected fund and posts contribution | Required and implemented |
| Client value ledger | `client_value_entries`, `portfolioLedger.ts`, `portfolioProjection.ts`, client portfolio routes | Contribution, admin growth/loss, reversal, per-user/per-fund projections | Required and implemented |
| Client growth | `routes/adminClientGrowthRoutes.ts`, `domain/admin/clientGrowth.ts`, `ClientValuesScreen.jsx` | Individual adjustment or fund-scoped collective percentage/explicit adjustments | Required if admin-controlled, but policy is disconnected from fund performance |
| Fund AUM | `fund_aum_snapshots`, `aum_growth_batches`, `routes/adminAumRoutes.ts`, `adminFundGrowthPreviewRoutes.ts`, `AumScreen.jsx` | Opening snapshot, amount/percentage growth, collective preview/commit, history/corrections | Required and implemented |
| Portfolio/activity/statements | `clientPortfolioRoutes.ts`, `clientAccountRoutes.ts`, `Portfolio.jsx`, `Transactions.jsx`, `Statements.jsx` | Derived holdings, ledger activity, orders/payments, monthly derived statements | Required records; statements are useful supporting functionality |
| Notifications | `notifications`, `notificationRepository.ts`, `Notifications.jsx` | SIP and growth notifications plus app inbox | Supporting but outside minimal scope |
| Support/content | `support_requests`, `content_items`, `adminContentRoutes.ts`, `Support.jsx`, `FaqsPage.jsx` | FAQs, tickets, legal/grievance/research content | Outside minimal scope except mandatory legal disclosures |
| App management | `app_config_versions`, `AppBuilderScreen.jsx`, `EnvironmentScreen.jsx`, `publicAppRoutes.ts` | Publish presentation/config, feature toggles, update settings | Outside financial domain |
| Audit/RBAC/controls | `roles`, `permissions`, `audit_events`, `idempotency_records`, admin audit UI | Authorization, traceability, replay protection | Required cross-cutting control |
| Release/update/monitoring | `release_manager/**`, `appUpdate.js`, monitoring compose | Deployment, APK publishing/self-update, infrastructure probes | Operational, not product scope |

## 5. Current end-to-end user investment flow

### 5.1 Registration and verification

1. The registration UI is **not in this repository**. A separate AWS-hosted public/marketing application calls `POST /newuser` with `x-signup-key` (`routes/publicOnboardingRoutes.ts`).
2. The backend validates name/email/phone/password/consent, checks the password against the configured breach service, hashes it with Argon2id, captures current consent-document versions, and inserts `applications` directly in `submitted` (`submitApplication.ts`).
3. No verification token or signup verification email is created. Migration `025_onboarding_rework.sql` drops `verification_tokens`, `activation_invites`, and `applications.email_verified_at`. The response even retains `verificationEmailQueued: false` for wire compatibility.
4. An admin sees the submission under `/admin/users/approvals`, and `POST /v1/admin/applications/:applicationId/decision` approves or rejects it (`adminIdentityRoutes.ts`, `ApprovalsScreen.jsx`).
5. Approval creates an already-`active` `users` row, copies the signup password into `user_credentials`, and queues an `account_approved` email (`decideApplication.ts`). Rejection creates no user.
6. The user logs in through `/v1/auth/native/login` from `Login.jsx`.
7. The client checks `/v1/client/eligibility`. Until a current approved KYC case exists, investment routes redirect to `/app/verify-email` (`ClientApp.jsx`).
8. `/v1/client/kyc/start` emails a six-character OTP; `/verify` marks `kyc_cases.state='approved'` and adds an expiry (`domain/client/kyc.ts`). This single step is both the only email-address verification and the implemented KYC gate.

**Assessment:** registration, admin approval, authentication and an email OTP are implemented. A distinct registration-email verification is missing, and the KYC name overstates what the OTP proves.

### 5.2 Viewing and selecting AUM pools

1. `Explore.jsx` calls `GET /v1/client/funds`; `clientCatalogRepository.ts` returns only published funds.
2. `FundDetail.jsx` calls `GET /v1/client/funds/:fundId` and renders current published terms, risk level/return tier, stock disclosures and latest AUM.
3. The user selects SIP or one-time investment from the fund detail route.

**Assessment:** required pool publication, discovery and selection are implemented. The UI also adds research-context/editorial blocks and holdings analysis beyond the minimal target.

### 5.3 Lumpsum investment

1. `LumpsumSheet.jsx` validates a client-side amount and risk consent.
2. `POST /v1/client/orders` executes `createOrder.ts`, which re-derives eligibility under a user lock, validates the fund is published, validates the minimum, pins `fund_version_id`, and creates a `lump_sum` order.
3. `POST /v1/client/orders/:orderId/pay` creates/reuses a payment and PhonePe attempt, receives a redirect checkout URL, and the client leaves for PhonePe (`clientOrderRoutes.ts`, `phonePeCheckoutGateway.ts`).
4. PhonePe callback or the payment reconciliation worker verifies provider state. A succeeded payment transitions the order to `review_pending` and creates a pending `investment_review`; it does **not** create a holding.
5. Admin accepts the review after bank attestation. The transaction creates exactly one `investment_allocations` row for the full payment and same selected `fund_id`, creates one `client_value_entries` contribution, marks review/order accepted, and appends audit evidence (`adminInvestmentReviewRoutes.ts`, `investmentReviewRepository.ts`).
6. Portfolio, transactions and statements are derived from the client value ledger (`portfolioLedger.ts`, `portfolioProjection.ts`, `statements.ts`).

**Assessment:** this is the strongest aligned flow in the repository. It is explicit, auditable and correctly separates payment success from investment acceptance.

### 5.4 SIP investment

1. `StartSipSheet.jsx` collects pool, amount, duration and debit day.
2. `POST /v1/client/sips` validates eligibility, published fund, minimum SIP and duration, then creates an active plan and its first `sip_installment` order (`clientSipPlanRoutes.ts`, `sipPlanRepository.ts`).
3. `MandateDetail.jsx` shows that due order. The user manually starts a new PhonePe checkout for the installment.
4. After an installment is accepted, `sipScheduleWorker.ts` advances the plan and creates at most one later installment order per due period, protected by `investment_orders.due_period` and uniqueness logic from migration `027_sip_installment_periods.sql`.
5. Payment reconciliation and admin review/allocation then follow the same path as lumpsum.
6. Users may pause, resume or cancel the schedule.

**Assessment:** scheduled recurring investment records are implemented, but it is not an automatic SIP mandate. Labels and the historical `/mandates/:mandateId` path overlap with a capability that no longer exists.

### 5.5 Allocation and performance

- `investment_allocations` links accepted order, user, fund, amount, allocating admin and timestamp.
- `client_value_entries` is the authoritative user/fund value ledger. Contribution entries carry order/payment/allocation provenance; growth entries carry `client_growth_batches`; reversals point to the reversed entry.
- Admin individual or collective client-growth commands append value-only adjustments. They do not update fund AUM.
- `fund_aum_snapshots` is a separate append-only absolute-AUM history. Admin AUM commands create new revisions from the latest snapshot. They do not update client values.
- Client fund detail reads the latest AUM; client portfolio reads the user ledger.

**Assessment:** records and controls exist, but “pool performance → user performance” is not an implemented relationship. The architecture implements two manually administered performance systems.

## 6. Current admin flow and responsibilities

### 6.1 Implemented admin navigation

`frontend_stack/packages/admin/src/navigation/nav.js` and `pages/Admin.jsx` expose:

- Overview;
- Users: approvals, directory and user detail;
- Funds: catalogue, create and fund workspace;
- Investment reviews: awaiting, accepted, refunds/exceptions;
- Client values: detail, individual growth, collective growth by fund;
- AUM: current, one-fund adjustment, collective adjustment, history/corrections;
- Payments: PhonePe evidence;
- Audit log;
- FAQs;
- App builder;
- Email log;
- Environment/configuration.

### 6.2 Intended-flow mapping

| Intended admin step | Current implementation | Status |
|---|---|---|
| User management | Approve/reject application; directory/detail; backend suspend/reinstate/close and login-event APIs | Partly implemented in UI |
| AUM pool creation/configuration | Create fund plus first version/disclosure/opening AUM; manage versions, lifecycle and stocks | Implemented; creation is coupled to `aum.write` |
| Publish pools | Fund lifecycle supports draft/published/paused/archived | Implemented |
| Manage investments | Review successful payments; accept/reject; retry/reconcile refunds | Implemented |
| Manage allocation | Acceptance creates full allocation to the already selected fund | Implemented; no split/reallocation |
| Manage user performance | Client-value individual and collective growth commands | Implemented |
| Manage fund performance/AUM | Opening AUM, individual and collective growth, history and corrections | Implemented |
| Monitor all records | User detail, payments, reviews, AUM history, audit, email deliveries | Partial: user detail omits most financial records |

### 6.3 Admin architectural issues

- Pool creation requires both `funds.write` and `aum.write` because the route creates the opening AUM in the same transaction (`adminCatalogRoutes.ts`). This makes the catalogue and AUM boundaries less independent than the rest of the design.
- Fund publishing/configuration and AUM/performance management are split across `/admin/funds/*` and `/admin/aum/*`, while client performance is under a third “Client values” domain. The split is technically clean but operationally fragmented.
- User KYC status can be viewed, but there is no complete admin KYC document/review workflow despite tables for it.
- The backend user-detail projection is much narrower than the active UI assumes. `adminOversightRepository.userDetail()` returns the user, roles, latest KYC case and only the ten most recent orders. `UserDetailScreen.jsx` also expects SIPs, payments, positions and a portfolio summary, so those sections resolve to empty/default values rather than a complete record. The repository has a general `listOrders()` method that no admin route exposes.
- User suspend/reinstate/close APIs exist in `adminOversightRoutes.ts`, but `UserDetailScreen.jsx` is effectively read-only and provides no corresponding lifecycle controls.
- “Environment” and “App builder” duplicate the same `app_config_versions` publishing domain through two admin concepts.
- Legacy redirect routes in `Admin.jsx` (`ops/redemptions`, `ops/transactions`, `ops/ledger`, `ops/sip-control`, `ops/holdings`, old KYC/risk routes) preserve obsolete information architecture and should be removed after external links are migrated.

## 7. Database and data-model analysis

### 7.1 Core required relationships

```text
applications --approval--> users --1:1--> user_credentials
                                |
                                +--> kyc_cases --> kyc_verification_codes
                                |
                                +--> sip_plans --> investment_orders
                                |                    |
funds --> fund_versions <-------+--------------------+
  |                                                  |
  +--> fund_aum_snapshots                            +--> payments --> payment_attempts
  |                                                  |                  + provider details/events
  +--> aum_growth_batches                            +--> investment_reviews
  |                                                  +--> investment_allocations
  +--> fund_stock_disclosures                        +--> client_value_entries
                                                             |
                                                      client_growth_batches
```

### 7.2 Complete current table inventory

The Kysely `Database` interface in `backend_controller/src/db/types.ts` declares the following active schema surface:

- **Onboarding/identity:** `applications`, `consent_documents`, `application_consents`, `users`, `user_credentials`, `application_reviews`.
- **Authentication/RBAC:** `auth_sessions`, `auth_refresh_tokens`, `auth_login_events`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- **Controls/retention:** `audit_events`, `idempotency_records`, `rate_limit_windows`, `legal_holds`.
- **Email/outbox:** `outbox_events`, `email_deliveries`, `email_provider_events`, `email_suppressions`.
- **KYC/compliance:** `investor_profiles`, `kyc_cases`, `kyc_documents`, `kyc_reviews`, `kyc_verification_codes`, `risk_assessments`.
- **Funds/AUM:** `funds`, `fund_versions`, `fund_disclosure_versions`, `fund_aum_snapshots`, `aum_growth_batches`, `fund_stock_disclosures`.
- **Investing/client value:** `sip_plans`, `investment_orders`, `investment_reviews`, `investment_allocations`, `client_growth_batches`, `client_value_entries`.
- **Payments:** `payments`, `payment_attempts`, `provider_payment_details`, `refund_operations`, `provider_events`.
- **Platform/content:** `finance_policy_versions`, `marketing_leads`, `app_config_versions`, `content_items`, `notifications`, `support_requests`.

### 7.3 Required and well-modeled tables

- `users`, `user_credentials`, `auth_sessions`, `auth_refresh_tokens`: identity and secure sessions.
- `funds`, `fund_versions`, `fund_disclosure_versions`: lifecycle plus immutable published terms.
- `sip_plans`, `investment_orders`: scheduled and one-time intent; orders pin the selected fund version.
- `payments`, `payment_attempts`, `provider_payment_details`, `provider_events`, `refund_operations`: provider evidence and recovery.
- `investment_reviews`, `investment_allocations`: private acceptance checkpoint and user-to-fund allocation.
- `client_value_entries`, `client_growth_batches`: append-only user investment/value history.
- `fund_aum_snapshots`, `aum_growth_batches`: append-only pool AUM history.
- `audit_events`, `idempotency_records`: high-value financial controls.

Important integrity properties in migrations `015`, `017` and `018` include integer paise, positive amounts, composite ownership foreign keys, one allocation per order, one review per order, contribution provenance, signed growth adjustments, state/timestamp checks and deterministic batch provenance.

### 7.4 Missing or weak relationships

1. There is no explicit `user_fund_positions` aggregate table. This is acceptable if every position is derived from `client_value_entries`, but APIs and documentation must state that `(user_id, fund_id)` is the position identity.
2. Fund AUM and client positions intentionally have no accounting relationship. The schema cannot answer whether published AUM is consistent with accepted investments or performance applied to users.
3. There is no performance-factor/version model separate from posted money adjustments. A percentage command is recorded indirectly in `client_growth_batches`/`aum_growth_batches`, but there is no reusable policy such as valuation date, pool return factor, fee factor, benchmark or published performance period.
4. Email verification is not represented on `applications` or `users` after migration `025`; `kyc_cases` is being used as the email verification fact.
5. KYC approval does not reference identity evidence, provider result or reviewer. `kyc_documents` and `kyc_reviews` exist but the active OTP path bypasses them.
6. Accepted allocation has no AUM cash-flow event. If AUM is intended to mean managed pool size, the database cannot explain an AUM change caused by accepted capital separately from investment performance.
7. `fund_stock_disclosures` is not an authoritative allocation model: weight is optional, active weights need not total 100%, rows are mutable, and there is no effective-dated immutable allocation version.

### 7.5 Stale or removable schema

| Table/type | Evidence and recommendation |
|---|---|
| `marketing_leads` | Defined in migration `016`, Kysely type only; no active repository/route. Remove. |
| `legal_holds` | Defined in migration `012`, used by integration constraint tests only. Remove unless a documented retention requirement exists. |
| `finance_policy_versions` | Redemption threshold was removed by migration `032`; seed still creates an effectively empty active row. Remove with seed logic. |
| `risk_assessments` | Repositories still query its latest state, but `investingEligibility.ts` explicitly ignores it. Remove queries/table/types unless risk profiling is reinstated. |
| `investor_profiles` | Schema exists without an active onboarding/profile workflow. Either connect it to real KYC or remove it. |
| `kyc_documents`, `kyc_reviews` | Rich KYC schema is mostly disconnected from email-OTP approval. Keep only if real KYC is being implemented next; otherwise simplify. |
| old approval/fund-position concepts | Migrations `030` and `031` correctly remove `fund_positions`, `approval_actions`, and `review_pending` fund state. Remove remaining comments/types/redirects that imply them. |
| `support_requests`, `content_items`, `app_config_versions`, `notifications` | Live but outside the strict financial product. Retain only deliberately as shared support/compliance/platform capability. |

## 8. API/backend architecture analysis

### 8.1 Active API groups

**Public/auth**

- `POST /newuser`
- `POST /v1/auth/native/{login,refresh,logout}`
- `POST /v1/auth/web/{login,refresh,logout}` and `GET /v1/auth/web/csrf`
- public app config/update and content/disclosure endpoints

**Client**

- eligibility and KYC start/resend/verify/status;
- funds list/detail;
- SIP create/list/pause/resume/cancel;
- order create/pay/list/detail;
- portfolio, transactions and payment detail;
- notifications, statements, FAQs, support tickets and research context;
- app version reporting.

**Admin**

- session, applications and email deliveries;
- users, user details/login events, lifecycle and audit logs;
- fund create/read/version/stock/lifecycle;
- investment reviews, refunds and payments;
- client growth individual/collective preview/commit;
- AUM initialize/grow/correct/history/collective preview/commit;
- FAQ and app-config management.

**Provider**

- PhonePe callback routes;
- AWS SNS event route for email delivery evidence.

### 8.2 Strengths

- Zod validation at HTTP boundaries;
- separate native and admin session transports;
- RBAC on admin routes;
- idempotency on financial/admin writes;
- transaction-scoped acceptance/allocation/ledger writes;
- append-only audit and provider inbox patterns;
- payment state is provider-derived, not browser asserted;
- pagination/cursor handling on large lists;
- Redis is optional and never the system of record.

### 8.3 Gaps and inconsistencies

- `packages/contracts` does not cover every live route uniformly. Several frontend services hand-code URLs and payload mapping. Make generated contracts authoritative for all retained APIs.
- Client `fundsApi.js` calls `/v1/client/redemptions`, but no backend route is registered. This is a live broken feature, not merely dead code.
- `ordersApi.js` retains fixture-only SIP-control request functions without matching production APIs.
- Payment/review routes are conditionally registered only when PhonePe configuration is present. Admin navigation does not necessarily reflect that absence.
- Email OTP send happens after the KYC database transaction commits. If SMTP fails, the case/code remains active even though the API returns dependency failure; resend cooldown can then delay recovery.
- Public signup is tied to an external site through a shared secret and an unversioned endpoint, but that integration is not represented in the frontend or shared contracts.
- There is no single orchestration/read model for the exact requested user lifecycle. The client and admin compose it from several endpoints.
- Fund creation always writes an opening AUM snapshot, making the separate AUM initialize endpoint redundant for normally created funds.
- A historical AUM correction appends a revision for an older date without rebasing later snapshots. Those later snapshots therefore retain the old basis. Restrict corrections to the current head or implement an explicit supersession/rebase rule.
- Pausing/archiving a fund does not resolve its active SIPs or open orders. A later SIP worker pass can encounter a non-published fund and leave the schedule unable to advance.
- Catalogue cache invalidation is incomplete around fund version/lifecycle/stock/AUM writes, so clients can read stale fund detail until the configured catalogue TTL expires.

## 9. Frontend/application flow

### 9.1 Client application

`ClientApp.jsx` defines splash, login, dashboard, explore, fund detail, SIP, lumpsum, payment status, SIP detail, portfolio, withdrawals, transactions, statements, notifications, profile, KYC, security, support, legal, investor charter and grievance routes.

Required screens already exist:

- pool discovery: `Explore.jsx`;
- pool detail/performance/AUM: `FundDetail.jsx` and `pages/fundDetail/*`;
- SIP/lumpsum entry: `StartSipSheet.jsx`, `LumpsumSheet.jsx`;
- payment state: `PaymentStatus.jsx`;
- investment record: `Portfolio.jsx`, `Transactions.jsx`, `Statements.jsx`;
- verification/KYC: `KycVerify.jsx`, `KycDetail.jsx`;
- authentication/profile: `Login.jsx`, `Profile.jsx`.

Problems:

- there is no registration screen because signup is delegated to an external public site;
- `/app/verify-email` renders `KycVerify`, conflating email verification and KYC;
- `/app/mandates/:mandateId` renders a manual SIP schedule, not a mandate;
- withdrawals/redemptions are exposed in `Portfolio.jsx` and `WithdrawalRequests.jsx`, but HTTP mode calls nonexistent backend endpoints;
- dashboard/explore research content is outside the focused investment-management flow;
- `VITE_BEO_API_MODE` defaults to fixture mode, and many services maintain parallel fixture behavior. This duplicates product behavior and can hide missing production APIs unless deployment configuration is correct.
- Production fund DTOs do not contain the performance series, periods, NAV/ratio fields and allocation detail that `PerformanceSection.jsx`, `HoldingsAnalysis.jsx`, `FundDetail.jsx` and fixture products know how to render. In HTTP mode those performance sections disappear or remain empty.
- Portfolio/transaction mappers retain `fundId` but not consistently the fund name/slug. A held pool can be displayed as an identifier or “Unmapped fund pool,” and a single-pool holding is not always rendered as an explicit pool relationship.
- Client and admin lifecycle labels drift from backend states: paused funds are commonly presented as “Coming Soon”; client risk mappings omit `very_high`; and the Dashboard still uses “UPI AutoPay”/“next debit” language while SIP setup explicitly says no automatic debit.
- Admin navigation is gated mostly by read permissions, while Approvals, Investment Review and FAQ screens still render mutation controls without checking the corresponding decide/write/publish permission. The backend remains authoritative, but the UI advertises actions that some roles cannot perform.

### 9.2 Admin application

The admin UI has all required operational screens but is more expansive than the target. The recommended consolidation is:

```text
Users
  Applications / verification / KYC / account state / user record

Funds & AUM
  Catalogue / create-publish / terms / AUM / performance / history

Investments
  Pending payments / review-allocation / SIPs / accepted records / client performance

System (restricted support)
  Audit / email delivery / configuration
```

This reduces the current separate domains for Reviews, Client values, AUM and Payments while preserving permission boundaries internally.

## 10. Features outside the intended scope

Email verification and KYC are **not** included in this list.

### 10.1 Live product functionality outside scope

- Redemptions/withdrawals UI and service calls (`Portfolio.jsx`, `WithdrawalRequests.jsx`, `fundsApi.js`). This is also incomplete because the backend endpoint is absent.
- Research/editorial context on Dashboard and Explore (`researchApi.js`, `research-context` content, App Builder configuration).
- FAQ publishing and support ticket management (`support_requests`, `Support.jsx`, `FaqsPage.jsx`).
- General notification inbox (`notifications`, `Notifications.jsx`). SIP/payment notifications could instead be part of investment records.
- App Builder and general presentation/feature configuration (`app_config_versions`, `AppBuilderScreen.jsx`, `EnvironmentScreen.jsx`).
- Investor charter, grievance redressal and broad legal-content screens. Keep only documents legally necessary to operate the focused product.
- Device PIN/biometric app lock and local update notifications (`Security.jsx`, `securitySettings.js`, app-update services). These are platform/security conveniences, not domain scope.
- Fund stock/quarter disclosure management and holdings analysis (`fund_stock_disclosures`, `FundStockListPanel.jsx`, `HoldingsAnalysis.jsx`) unless “allocation records” explicitly means underlying pool holdings.
- Monitoring stack, release/rollback machinery and Android update distribution. These are operational capabilities, not product modules.

### 10.2 Non-runtime repository material

- `.resources.legacy.TLDR/` and `vault.md/` contain extensive legacy/reference/knowledge content.
- `frontend_stack/packages/ui-kits` is a preview/reference package and is guarded from the production bundle.
- HTML previews under `frontend_stack/preview` and design assets are not live application features.

These should be moved out of the production repository or clearly marked as tooling/reference to reduce audit and search noise.

## 11. Required functionality status

### 11.1 Required and already implemented

- Users and credentials;
- admin user approval and lifecycle management;
- email sending/delivery evidence;
- published fund-pool catalogue;
- user selection of a published fund;
- lumpsum orders and PhonePe payment;
- SIP plan records and installment generation;
- payment reconciliation and refund handling;
- admin investment review and one-to-one allocation;
- complete immutable contribution/growth/reversal history;
- per-user/per-fund portfolio and transaction projections;
- AUM opening snapshots, history, corrections and growth;
- admin individual and fund-scoped collective client growth;
- admin individual and collective AUM growth;
- RBAC, audit and idempotency.

### 11.2 Required but missing or incomplete

- distinct signup email verification before (or as part of) activation;
- real KYC identity verification, or honest renaming of the current email OTP;
- automatic SIP mandate/debit if “SIP” means conventional automated recurring investment;
- an explicit, approved rule connecting AUM pool performance factors to user investment performance, if the intended phrase “manage all growth/performance-related factors” requires a single pool performance source;
- explicit performance-period/factor records rather than only manual money deltas;
- end-to-end registration UI within the owned architecture, or a versioned contract/test boundary for the external signup application;
- production backend for redemptions if withdrawals are retained; otherwise remove the UI;
- admin KYC review tooling if richer KYC tables are retained;
- consolidated user investment record view spanning SIP plans, orders, payments, reviews, allocations, ledger and performance history;
- correct pool names and identities in every portfolio/transaction record;
- a complete admin user-detail projection and lifecycle/SIP/KYC controls;
- complete contract coverage for all retained routes.

## 12. Redundant, duplicated and overlapping components

1. **Email verification vs KYC:** `/app/verify-email`, KYC OTP and eligibility all describe the same email-OTP action under different names.
2. **Performance commands:** client-growth and AUM-growth implement parallel individual/collective amount/percentage/batch-hash machinery. The separation of ledgers is valid, but validation, rounding, preview/commit and reason metadata can share generic immutable utilities without sharing transactions.
3. **App Builder vs Environment:** both operate around published app configuration and are separate navigation concepts.
4. **Fixture vs HTTP behavior:** funds, orders, portfolio, statements, transactions, notifications, research, KYC and support services each maintain fixture branches. This doubles state models and can mask backend gaps.
5. **Legacy routes:** client “mandates” and admin legacy redirects preserve retired concepts.
6. **KYC schema:** email-OTP approval uses `kyc_cases`/codes while unused document/review/profile tables describe a second, unimplemented KYC architecture.
7. **Risk model:** `risk_assessments` is queried for compatibility but deliberately ignored; risk is also modeled on funds and displayed during investment.
8. **Content configuration:** `content_items`, `app_config_versions`, shared default config, seed content and fixtures provide overlapping sources of presentation/editorial truth.
9. **API mapping:** hand-written frontend mappers overlap with the generated contracts package.
10. **AUM initialization:** fund creation requires and writes opening AUM, yet an independent initialize route and UI branch remain.
11. **Admin user lookup:** User Directory and Client Values “client detail” both query the admin user list and lead into overlapping user/value workflows.
12. **Catalogue/AUM listing:** the fund catalogue already exposes state and latest AUM, while `/admin/aum/current` repeats essentially the same list.

## 13. Gap analysis: current versus required target

| Capability | Current | Target decision/change |
|---|---|---|
| User registration | External site submits admin-reviewed application | Retain external boundary only if contract/version/ownership is explicit; otherwise bring registration into client/public app |
| Email verification | Only post-approval KYC OTP | Add explicit email-verification state or officially define OTP as email verification |
| KYC | Email OTP auto-approval | Integrate actual KYC evidence/provider/review, or stop calling email verification KYC |
| Pool discovery | Published funds visible to clients | Retain |
| Lumpsum | Complete through PhonePe and admin allocation | Retain |
| SIP | Schedule + manually paid installments | Add mandate/autopay or explicitly define “scheduled manual SIP” as product rule |
| User-to-pool link | Order/allocation/ledger all use canonical `fund_id` | Retain and document `(user_id,fund_id)` position identity |
| User records | Ledger and projections are complete but distributed | Add one consolidated investment-record endpoint/admin view |
| AUM management | Complete independent snapshot ledger | Retain |
| User growth | Manual independent ledger adjustments | Decide whether performance should derive from a pool factor; avoid two sources of truth |
| Pool performance factors | Only signed AUM adjustments/batches | Add explicit period/factor model if required |
| Admin control | Strong RBAC/audit/idempotency | Retain; simplify navigation |
| Extra product areas | Content/support/research/withdrawal/config/device/update | Remove or isolate based on explicit product decisions |

## 14. Recommended target architecture

Keep one modular backend and two role-specific frontends. Define five bounded modules:

### 14.1 Identity and Verification

Own:

- registration/application;
- email verification;
- credentials/sessions;
- user lifecycle;
- KYC case/evidence/status.

Do not use a KYC state as the only email-verification fact. A minimal model is `users.email_verified_at` plus an explicit KYC status/evidence model.

### 14.2 Fund Pool Catalogue and AUM

Own:

- `funds`, immutable published versions and necessary disclosures;
- lifecycle and user visibility;
- AUM snapshots;
- performance periods/factors and corrections.

If underlying stock allocations are not required, remove `fund_stock_disclosures`. If they are required, rename the admin section “Pool holdings” and make it part of AUM-pool management rather than a generic research feature.

### 14.3 Investments

Own:

- SIP plans;
- lumpsum/SIP-installment orders;
- payment orchestration;
- review and allocation;
- immutable user investment ledger;
- user/admin investment projections.

The accepted allocation must remain full amount to the selected pool for the MVP.

### 14.4 Performance

Choose one explicit policy:

**Recommended for the requested scope:** an admin publishes a dated pool performance factor. The system atomically records the pool performance event and derives deterministic user-value adjustments for all eligible positions in that pool. A separate AUM snapshot may be included only if the business explicitly requires the same event to publish both; audit metadata must show the common source.

If the business truly requires independent AUM and user-value controls, keep the current split but name them clearly as “Published pool AUM adjustment” and “Client value adjustment,” and state that neither represents automatic market performance. Do not imply that one tracks the other.

### 14.5 Administration and Controls

Own:

- RBAC;
- audit;
- idempotency;
- operational payment/email evidence;
- focused configuration required by the four product modules.

Keep infrastructure monitoring and releases outside product navigation.

## 15. Required codebase changes

### 15.1 Add

- explicit email-verification model, token/OTP lifecycle and endpoint if verification must precede activation;
- real KYC provider/evidence/review integration or a renamed email-verification module;
- `fund_performance_periods` (or equivalently named) model if one pool factor should drive performance;
- one consolidated client/admin investment-record projection keyed by user and fund;
- SIP mandate/provider records and webhook/reconciliation flow if automatic debit is required;
- complete operation descriptors/OpenAPI definitions for every retained route.

### 15.2 Modify

- `publicOnboardingRoutes.ts`, `submitApplication.ts`, `decideApplication.ts`, migrations `009/010/019/025`: separate signup verification from KYC and choose the activation gate.
- `clientKycRoutes.ts`, `domain/client/kyc.ts`, `kycRepository.ts`, `KycVerify.jsx`, `KycDetail.jsx`: implement actual KYC semantics or rename to email verification.
- `ClientApp.jsx`, `navigation/routes.js`: rename `verify-email`/`mandates` consistently and remove out-of-scope routes.
- `clientSipPlanRoutes.ts`, `sipScheduleWorker.ts`, `StartSipSheet.jsx`, `MandateDetail.jsx`: implement automated SIP or make manual installment behavior explicit everywhere.
- `adminClientGrowthRoutes.ts`, `adminAumRoutes.ts`, growth domain modules and admin screens: implement the chosen performance authority and remove ambiguous duplicate controls.
- `adminCatalogRoutes.ts`: consider decoupling fund creation from opening-AUM permission while preserving a clear publish prerequisite.
- `UserDetailScreen.jsx` and admin routes: provide one complete investment record timeline rather than separate partial tables.
- `packages/contracts`: make retained endpoints the source of frontend request/response types.
- `PRODUCT.md`, `README.md`, deployment docs: align all product descriptions with the investment/AUM target.

### 15.3 Consolidate

- client-growth/AUM growth parsing, signed rounding, batch hashing and reason metadata into shared pure utilities while keeping domain repositories and transactions separate unless a common performance event is explicitly adopted;
- App Builder and Environment into one restricted Configuration screen, or remove both from product navigation;
- review, payment and allocation monitoring into one Investments admin domain;
- default config, seed content and live published content into one declared source per concern.

### 15.4 Remove or isolate

- client redemption/withdrawal routes/screens/services unless added to scope;
- research-context surfaces and seed data;
- FAQ/ticket product surfaces unless explicitly retained as support;
- generic notification inbox if investment status can be shown in records;
- stale `marketing_leads`, `legal_holds`, `finance_policy_versions`, ignored risk-assessment code/schema;
- unused KYC profile/document/review tables if real KYC is not being built;
- legacy route redirects after a controlled migration period;
- production fixture mode and fixture-only operations; keep fixtures in story/demo/test tooling only;
- `frontend_stack/packages/ui-kits`, preview HTML and repository archives from production dependency/workspace scope.

## 16. Dependency recommendations

### Retain

- Fastify, Zod, Kysely, PostgreSQL, JOSE, Argon2, Pino: core backend/security.
- PhonePe SDK: required for investment payment.
- Nodemailer and SNS verification code: required for email verification/delivery evidence.
- React/Router/Vite and core Capacitor packages: active client/admin delivery.
- Redis: optional read-cache; retain only if production measurements justify it.

### Review/remove after feature removal

- Capacitor local notifications if the general inbox/update notification feature is removed;
- native biometric plugin if device app lock is outside the retained product;
- `libphonenumber-js` only if phone normalization is consolidated onto it; current signup uses a local E.164 regex while the dependency supports other auth logic;
- `@beonedge/ui-kits` workspace and preview-only design assets;
- root Playwright/ngrok/agent-browser dependencies if the external onboarding and browser E2E harnesses are moved elsewhere.

Do not remove payment, email, cryptography, validation or audit dependencies merely to make the product smaller; those support the financial core.

## 17. Recommended implementation roadmap

### Phase 0 — Freeze semantics and update the source of truth

1. Approve three decisions: email-verification timing, real-KYC definition, and automated versus manually paid SIP.
2. Approve one performance authority: shared pool factor or intentionally independent AUM/client adjustments.
3. Replace the contradictory education-only `PRODUCT.md` with the focused investment/AUM scope and glossary.
4. Record the external signup site as a formal bounded system with owner, versioned contract and end-to-end test.

### Phase 1 — Repair correctness gaps

1. Remove the exposed redemption UI or implement its backend only if scope is expanded.
2. Separate/rename email verification and KYC so route names, screens, database facts and eligibility agree.
3. Remove ignored risk-assessment reads and stale finance-policy seed behavior.
4. Ensure payment/review availability is visible when PhonePe is unconfigured.
5. Make API contracts cover every retained financial endpoint.

### Phase 2 — Normalize the core domain model

1. Establish `(user_id, fund_id)` as the documented user-position identity.
2. Add a consolidated investment record/timeline projection.
3. Implement the approved performance-period/factor model or clarify the names and boundaries of the two independent ledgers.
4. Simplify KYC tables to the actual workflow or connect the richer evidence/review model.
5. Decouple pool catalogue creation from AUM publication if permission separation is desired.

### Phase 3 — Complete the intended user/admin flows

1. Finish the decided email verification and KYC journeys.
2. Add SIP mandate/autopay if required; otherwise harden the manual installment schedule and remove mandate terminology.
3. Reorganize admin navigation into Users, Funds & AUM, Investments, and restricted System controls.
4. Present fund selection, investment state, allocation completion and performance history as one continuous client journey.

### Phase 4 — Remove scope and repository debt

1. Remove research, withdrawal, support/content, app-builder, notifications and device/update features not explicitly retained.
2. Drop stale tables/types/repos/tests through forward migrations; never edit already-applied production migrations.
3. Remove legacy redirects and fixture-only production paths.
4. Move archives, knowledge vault and preview packages outside the production codebase.

### Phase 5 — Verification and release

1. Add/retain targeted financial-integrity tests for payment idempotency, provider callback authenticity, SIP period uniqueness, review/allocation atomicity, growth calculations and performance posting.
2. Run backend unit/integration coverage, contract generation, frontend tests and the complete registration-to-investment E2E flow.
3. Verify migrations on a production-like PostgreSQL copy and rehearse rollback.
4. Release in small phases, with audit and ledger reconciliation reports for every data-model change.

## 18. Final concise assessment

### What the project currently does

It runs a client/admin investment application with externally submitted user applications, admin account approval, authentication, email-OTP eligibility, published funds, SIP schedules, lumpsum and installment orders, PhonePe payments, admin review/allocation, user value ledgers, portfolio/activity/statements, admin client-growth adjustments, and independent admin AUM snapshots/growth. It also includes content/support, notifications, app configuration, mobile security/update and deployment/monitoring capabilities.

### What it should do

It should focus on verified users, SIP and lumpsum investments, complete user-to-fund records, admin-created/published AUM pools, deterministic allocation, clear pool/user performance handling, and focused admin control—plus email and KYC verification.

### Extra functionality

The main extras are withdrawals/redemptions, research/editorial content, FAQs/tickets, general notifications, app builder/environment publishing, broad legal content, device PIN/biometrics, self-update notifications, stock-disclosure tooling, monitoring, preview packages and repository archives. Email and KYC are deliberately not classified as extras.

### What is missing

Distinct signup email verification, genuine KYC evidence/review, conventional automated SIP (if required), a single explicit pool-performance-to-user-performance policy, performance-period/factor records, a consolidated investment record view, complete contract coverage, and alignment between product documentation and runtime behavior.

### Recommended change order

1. Decide verification, KYC, SIP and performance semantics.
2. Fix broken/out-of-scope live flows and documentation.
3. Normalize verification, KYC, risk and performance data models.
4. Complete and consolidate user/admin journeys and API contracts.
5. Remove stale schema, fixtures, legacy routes and extra modules.
6. Run financial-integrity, integration and E2E verification before phased release.
