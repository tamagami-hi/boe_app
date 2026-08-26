# Workflow and Execution Traces

This companion document records the statically traced UI-to-database paths. “Needs runtime verification” means the code path is present but deployed reachability, environment configuration, or provider behavior was not exercised during this audit.

## User lifecycle

```text
External marketing/native signup
  -> POST /newuser
  -> backend_controller/src/routes/publicOnboardingRoutes.ts
  -> submitApplication.ts
  -> applicationRepository + consent/audit repositories
  -> applications(state=submitted), application_consents, audit_events
  -> admin UI application decision
  -> POST /v1/admin/applications/:id/decision
  -> adminApplicationRoutes.ts -> decideApplication.ts
  -> transaction: application_reviews + terminal applications state
  -> approval: users + user_credentials + outbox_events/email
  -> native login: POST /v1/auth/native/login
  -> nativeAuth.ts -> auth_sessions/auth_refresh_tokens
  -> client session provider -> protected client routes
```

Admin web login uses `POST /v1/auth/web/login`, cookie session state, and CSRF checks. Approval creates the user; rejection does not. Migration 025 removed verification-token/invite activation paths. KYC OTP is implemented in `clientKycRoutes.ts` and `domain/client/kyc.ts` using `kyc_cases` and `kyc_verification_codes`; document/review tables are not a complete current workflow (**Needs runtime verification/product confirmation**).

## Fund lifecycle

```text
Admin catalog screen
  -> admin catalog service/hooks
  -> adminCatalogRoutes.ts
  -> fund/version/disclosure repository operations
  -> funds, fund_versions, fund_disclosure_versions, fund_stock_disclosures
  -> publish pointer/update
  -> GET /v1/client/funds
  -> client fundsApi/catalog screen
```

Operational AUM is separate:

```text
Admin AUM screen
  -> adminAumRoutes.ts
  -> fund_aum_snapshots / aum_growth_batches
  -> admin reporting UI
```

Settlement does not update AUM snapshots; this is either an intentional accounting boundary or a missing reconciliation requirement (**Needs runtime verification**).

## Allocation/order lifecycle

```text
Client LumpsumSheet.jsx
  -> client order/payment service
  -> order/payment Fastify route registered in runtime/composition.ts
  -> order domain + payment initiation
  -> investment_orders + payments + payment_attempts
  -> PhonePe checkout/callback/reconciliation
  -> applyCanonicalPaymentOutcome.ts
  -> transaction: payment + attempt + order succeeded/accepted
                investment_allocations
                client_value_entries
                fund_receipt_acknowledgements
                notifications + audit_events
  -> portfolioLedger.ts sums client_value_entries
  -> client portfolio/fund detail renders value
```

The same canonical outcome function is used by callback/reconciliation paths. It is the best consolidation point for financial writes. Do not add a second “manual settlement” implementation without reusing this transaction/invariant boundary.

## Payment lifecycle

```text
Client checkout
  -> payment initiation route
  -> PhonePe provider adapter
  -> provider reference stored in provider_payment_details
  -> callback route verifies signature and correlates order/payment
  -> provider re-query where required
  -> provider_events retained/deduplicated
  -> applyCanonicalPaymentOutcome.ts
  -> core payment/order/attempt state + allocation/ledger
  -> acknowledgement/notification/audit
```

The reconciliation worker is `paymentReconciliationEntrypoint.ts`. Provider callbacks and workers share repository/domain logic. Signature verification, idempotency, encrypted callback retention, and provider re-query are security-critical.

## SIP and AutoPay lifecycle

```text
StartSipSheet.jsx
  -> client SIP routes
  -> sip_plans + installment investment_orders
  -> optional payment_mandates setup/cancel/collection tables
  -> sipScheduleEntrypoint.ts creates due installments
  -> mandateCollectionEntrypoint.ts / PhonePe collection
  -> payment outcome path above
```

This is a substantial optional subsystem. Confirm product usage before retaining its workers/tables; static code cannot establish whether recurring payments are live in production.

## Manual admin operations

| UI/action | Route/domain | Tables changed | Limitation |
|---|---|---|---|
| Client growth individual/collective | `adminClientGrowthRoutes.ts` / client-growth domain | `client_growth_batches`, `client_value_entries`, audit | Operational adjustment, not generic deposit/withdrawal |
| AUM individual/collective | `adminAumRoutes.ts` | `fund_aum_snapshots`, audit | Does not change client ledger |
| Fund receipt acknowledgement | admin fund receipt route | `fund_receipt_acknowledgements`, notification, audit | Acknowledges receipt only; no allocation |
| Generic manual deposit | No current backend route found | None | Missing capability |
| Generic manual withdrawal/redemption | Client services call `/v1/client/redemptions`; no backend route/table | None | Definite contract break |
| Generic manual allocation/adjustment | No route found; growth is closest | Growth/value-entry tables only | Missing capability |

## Definite frontend/backend break

`frontend_stack/packages/client/src/ClientApp.jsx` exposes `/app/withdrawals`. `Portfolio.jsx` calls `fundsApi.submitRedemption`; `WithdrawalRequests.jsx` calls `fundsApi.listRedemptionRequests`; `services/fundsApi.js` uses `POST/GET /v1/client/redemptions`. No backend route registration, repository, or migration table for redemption requests was found. Migration `017_canonical_investing.sql` explicitly states no redemption requests. This must become an explicit product decision.

## Frontend state update path

Client requests normally use `packages/client/src/services/_util.js::apiRequest`, which handles timeout, GET retry, bearer/cookie/CSRF, single-flight 401 refresh, response envelopes, and connectivity errors. Results flow through screen-local state plus `ResourceCacheProvider` invalidation. Admin uses similar package services but also has `shared/src/appConfig.js::appConfigRequest`, creating a second auth/transport path. Exact cache invalidation timing and production error behavior require runtime verification.

## Admin compatibility path

`frontend_stack/packages/admin/src/Admin.jsx` defines 44 route elements; 15 are redirects for old users/KYC/risk/subscription/payment/operations/system URLs. `legacyTabMap.js` maps 13 old query tabs. `pages/legacy/legacyRoutes.jsx` is imported by Admin and therefore active despite its name. Remove only after checking navigation, bookmarks, native deep links, and support runbooks.

## Route registration evidence

Routes are registered in `backend_controller/src/runtime/composition.ts`; the route modules below are the executable boundary (not merely filename conventions):

| Capability | Route module / representative endpoints |
|---|---|
| Onboarding | `publicOnboardingRoutes.ts`: `POST /newuser` |
| Native auth | `nativeAuthRoutes.ts`: `/v1/auth/native/login`, refresh/logout paths |
| Web auth | `webAuthRoutes.ts`: `/v1/auth/web/login` and cookie-session paths |
| Client catalogue/portfolio | `clientFundRoutes.ts`, `clientPortfolioRoutes.ts`: `/v1/client/funds`, portfolio/value reads |
| Orders/payments | `clientOrderRoutes.ts`, `clientPaymentRoutes.ts`: order creation, payment initiation/status |
| SIP/AutoPay/KYC | `clientSipPlanRoutes.ts`, `clientAutoPayRoutes.ts`, `clientKycRoutes.ts` |
| Admin applications | `adminApplicationRoutes.ts`: `POST /v1/admin/applications/:id/decision` |
| Admin catalogue/AUM | `adminCatalogRoutes.ts`, `adminAumRoutes.ts` |
| Admin growth/receipts | `adminClientGrowthRoutes.ts`, admin fund receipt acknowledgement route |
| Provider events | optional provider event routes registered when provider configuration is enabled |

The broad repository scan found 94 direct route registrations, about 98 registration call sites when helper calls are counted, and approximately 100 expanded operations. These are different counting scopes, not three different APIs.
