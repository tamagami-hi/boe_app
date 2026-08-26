# Database, Tables, and Sources of Truth

## Decisions that constrain schema simplification

`users` is the durable canonical user/client identity, created by
`backend_controller/db/migrations/010_canonical_identity.sql`. Orders, payments,
allocations, ledger entries, SIP plans, mandates, notifications, and support
records reference that identity directly or through their owning canonical
record. Existing Email OTP verification does not yet follow the desired naming
or storage model: `backend_controller/db/migrations/019_kyc_email_verification.sql`
creates `kyc_verification_codes` linked to `kyc_cases`, and the active routes and
domain code still call this flow KYC. A future migration must copy the durable
verification state to a retained email-verification representation before any
legacy compliance table is dropped.

## Typed table inventory and disposition

The current Kysely `Database` interface is `backend_controller/src/db/types.ts` (55 tables). The following grouping is the audit disposition; “runtime verification” is required before schema removal.

| Group | Tables | Static disposition |
|---|---|---|
| Onboarding/identity | `applications`, `consent_documents`, `application_consents`, `application_reviews`, `users`, `user_credentials` | KEEP; direct user lifecycle |
| Auth/RBAC | `auth_sessions`, `auth_refresh_tokens`, `auth_login_events`, `roles`, `permissions`, `role_permissions`, `user_roles` | KEEP; security boundary |
| Integrity/audit | `audit_events`, `idempotency_records`, `legal_holds` | KEEP audit/idempotency; legal holds verify compliance use |
| Reliability/email | `outbox_events`, `email_deliveries`, `email_provider_events`, `email_suppressions` | KEEP if email notifications remain |
| Rate limiting | `rate_limit_windows` | INVESTIGATE; runtime uses in-process map in `http/rateLimit.ts` |
| Email verification / compliance naming | `kyc_cases`, `kyc_verification_codes` | KEEP temporarily because these are the active Email OTP storage tables; migrate terminology and durable state before rename/drop |
| Confirmed legacy compliance/profile | `investor_profiles`, `kyc_documents`, `kyc_reviews`, `risk_assessments` | REMOVE through a reviewed forward migration after FK, data-retention, legal-hold, and row-preservation checks; no drop migration exists yet |
| Funds/catalogue | `funds`, `fund_versions`, `fund_disclosure_versions`, `fund_stock_disclosures`, `content_items`, `app_config_versions` | KEEP; app config can be simplified |
| AUM/reporting | `fund_aum_snapshots`, `aum_growth_batches`, `finance_policy_versions` | Keep AUM if reporting requires; investigate finance policy usage |
| Investing | `investment_orders`, `investment_allocations`, `client_value_entries`, `client_growth_batches`, `fund_receipt_acknowledgements` | KEEP; canonical financial core |
| Payments | `payments`, `payment_attempts`, `provider_payment_details`, `provider_events` | KEEP; provider integrity and reconciliation |
| Refunds | `refund_operations` | INVESTIGATE; no production create caller found |
| Notifications/support | `notifications`, `support_requests` | KEEP if product surfaces remain |
| SIP/AutoPay | `sip_plans`, `payment_mandates`, `mandate_setup_attempts`, `mandate_collection_attempts`, `mandate_cancel_commands`, `worker_heartbeats` | KEEP; required product capability and PhonePe-managed debit/retry boundary |
| Confirmed legacy marketing | `marketing_leads` | REMOVE through a reviewed forward migration after checking ownership and retention; no current runtime query found |
| Historical investment review | physical `legacy_investment_reviews` | REMOVE through a reviewed forward migration after data/archive/retention approval; absent from typed current path |

Migration evidence in the committed baseline is 30 SQL migrations (`009`–`039`, with archived `001`–`008`). Migration `039_immediate_investment_settlement.sql` renames `investment_reviews` to `legacy_investment_reviews` and adds receipt acknowledgements. The current worktree additionally contains implementation-in-progress migrations `040_email_verification_schema.sql`, `041_email_verification_backfill.sql`, and `042_remove_legacy_compliance_tables.sql`; these must not be treated as proven safe until their FK inventory, preservation assertions, migration tests, and deployed row/relationship counts pass. The physical table count and row/relationship counts are **Needs runtime verification** against the deployed database. A drop must not cascade through `users` or financial records; the relevant canonical foreign keys in migrations 010, 017, 018, 019, 022, and 039 are restrictive for identity and financial paths.

## Relationships

```text
applications -> application_consents -> consent_documents
applications -> application_reviews
approved applications -> users
users -> credentials, sessions, refresh tokens, roles, email verification, orders,
        payments, SIP plans, notifications, support, value entries
funds -> versions, disclosures, stock disclosures, AUM snapshots
investment_orders -> payments -> payment_attempts -> provider details/events
investment_orders -> investment_allocations -> client_value_entries
payment_mandates -> setup/collection/cancel attempt tables
all privileged mutations -> audit_events
external/retriable work -> outbox_events
```

## Financial sources of truth

### Client value

`backend_controller/src/domain/client/portfolioLedger.ts` derives client value by summing append-only `client_value_entries`. Allocation and payment/order amounts are corroborating transactional facts, not a separately editable client balance. The repeated paise amounts (`investment_orders.amount_paise`, `payments.amount_paise`, `investment_allocations.amount_paise`, `client_value_entries.principal_delta_paise/value_delta_paise`) are protected by constraints and settlement code but create reconciliation burden.

### Payment status

The state projection spans `investment_orders`, `payments`, `payment_attempts`, provider evidence, `provider_events`, and receipt acknowledgement. `applyCanonicalPaymentOutcome.ts` is the canonical transactional synchronizer. Any new payment path must call it or intentionally replace it with equivalent invariants.

### Fund AUM

`fund_aum_snapshots` stores absolute operational AUM and is independent of the client ledger. There is no static invariant that reconciles AUM to client value. Determine whether this is intentional before attempting consolidation.

### Email OTP verification

The current state is represented by the latest `kyc_cases` row and its active
`kyc_verification_codes` row. `backend_controller/src/domain/client/kyc.ts` marks
the case approved after OTP verification, while investing eligibility and
order/portfolio reads query that state. This is semantically Email OTP
verification, not regulatory KYC. The required future shape is a durable
user-linked email-verification state, with short-lived OTP material separated
from the durable status. Migration work must preserve every verified user and
must not delete financial history.

### Application configuration

`app_config_versions` is the remote/versioned store, but `frontend_stack/packages/shared/src/appConfig.js` also supports local fixtures and stale fallback. A failed remote fetch may therefore produce a plausible but stale UI. Make the fallback explicit and observable before removal.

## Tables read without complete current writes

Static search found no complete current write workflow for `investor_profiles`, `kyc_documents`, `marketing_leads`, `legal_holds`, and `finance_policy_versions`; `risk_assessments` is read by eligibility/order logic but has no current write route. `kyc_reviews` is used for admin detail/count behavior but is not a complete client verification workflow. The user has now designated the six named legacy tables for removal, subject to preservation and statutory-retention checks. They remain **not yet removed** until a forward migration proves that no active user or financial history depends on them. Genuine regulatory records or legal holds must be retained even if the application no longer uses them.

## Redis role and isolation

Redis is retained as infrastructure. Static tracing of
`backend_controller/src/cache/cache.ts`, `src/cache/redisClient.ts`, and
`runtime/composition.ts` shows a shared read-through cache for fund catalogue,
public content/app data, and app configuration. Cache failures fall back to
PostgreSQL through `createUncachedCache`. Redis is not the session store, queue,
distributed lock, rate limiter, worker coordinator, or Pub/Sub bus in the
current code; sessions are persisted in PostgreSQL and the runtime rate limiter
is an in-process map in `http/rateLimit.ts`.

The dev and production compose files provide separate Redis services, volumes,
networks, and project/container names (`dev_redis_data`/`prod_redis_data`,
`boe-dev-redis`/`boe-prod-redis`). This establishes repository-level isolation;
the actual VPS deployment remains **Needs runtime verification**. The reason
Redis resolved the earlier multi-user/concurrency failure is not proven by
source or git history. It must not be described as the mechanism that makes the
HTTP server concurrent without incident evidence or a reproducible runtime
test.

## Consistency risks

1. A failed or duplicated settlement could create divergent order/payment/attempt/ledger projections; existing DB transactions/idempotency mitigate this, so preserve and test them.
2. AUM and client ledger can disagree by design; define a reconciliation report or document the accounting boundary.
3. Receipt acknowledgement is now post-settlement metadata; older docs may lead operators to treat it as an approval gate.
4. `rate_limit_windows` suggests a persistent limiter but runtime enforcement is an in-process map, so multiple replicas would not share limits.
5. Legacy physical tables and archived migrations make fresh-schema reasoning harder than runtime-schema reasoning.
