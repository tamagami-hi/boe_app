# Database, Tables, and Sources of Truth

## Typed table inventory and disposition

The current Kysely `Database` interface is `backend_controller/src/db/types.ts` (55 tables). The following grouping is the audit disposition; “runtime verification” is required before schema removal.

| Group | Tables | Static disposition |
|---|---|---|
| Onboarding/identity | `applications`, `consent_documents`, `application_consents`, `application_reviews`, `users`, `user_credentials` | KEEP; direct user lifecycle |
| Auth/RBAC | `auth_sessions`, `auth_refresh_tokens`, `auth_login_events`, `roles`, `permissions`, `role_permissions`, `user_roles` | KEEP; security boundary |
| Integrity/audit | `audit_events`, `idempotency_records`, `legal_holds` | KEEP audit/idempotency; legal holds verify compliance use |
| Reliability/email | `outbox_events`, `email_deliveries`, `email_provider_events`, `email_suppressions` | KEEP if email notifications remain |
| Rate limiting | `rate_limit_windows` | INVESTIGATE; runtime uses in-process map in `http/rateLimit.ts` |
| Compliance/profile | `investor_profiles`, `kyc_cases`, `kyc_documents`, `kyc_reviews`, `kyc_verification_codes`, `risk_assessments` | KEEP KYC OTP; investigate document/review/profile/risk write paths |
| Funds/catalogue | `funds`, `fund_versions`, `fund_disclosure_versions`, `fund_stock_disclosures`, `content_items`, `app_config_versions` | KEEP; app config can be simplified |
| AUM/reporting | `fund_aum_snapshots`, `aum_growth_batches`, `finance_policy_versions` | Keep AUM if reporting requires; investigate finance policy usage |
| Investing | `investment_orders`, `investment_allocations`, `client_value_entries`, `client_growth_batches`, `fund_receipt_acknowledgements` | KEEP; canonical financial core |
| Payments | `payments`, `payment_attempts`, `provider_payment_details`, `provider_events` | KEEP; provider integrity and reconciliation |
| Refunds | `refund_operations` | INVESTIGATE; no production create caller found |
| Notifications/support | `notifications`, `support_requests` | KEEP if product surfaces remain |
| SIP/AutoPay | `sip_plans`, `payment_mandates`, `mandate_setup_attempts`, `mandate_collection_attempts`, `mandate_cancel_commands`, `worker_heartbeats` | Optional; retain or retire as one subsystem decision |
| Marketing/unused-looking | `marketing_leads` | INVESTIGATE; no current runtime query found |
| Historical | physical `legacy_investment_reviews` | REMOVE only after data/archive decision; absent from typed current path |

Migration evidence: there are 30 SQL migrations (`009`–`039`, with archived `001`–`008`). Migration `039_immediate_investment_settlement.sql` renames `investment_reviews` to `legacy_investment_reviews` and adds receipt acknowledgements. The physical table count is **Needs runtime verification** against the deployed database.

## Relationships

```text
applications -> application_consents -> consent_documents
applications -> application_reviews
approved applications -> users
users -> credentials, sessions, refresh tokens, roles, KYC, orders,
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

### Application configuration

`app_config_versions` is the remote/versioned store, but `frontend_stack/packages/shared/src/appConfig.js` also supports local fixtures and stale fallback. A failed remote fetch may therefore produce a plausible but stale UI. Make the fallback explicit and observable before removal.

## Tables read without complete current writes

Static search found no complete current write workflow for `investor_profiles`, `kyc_documents`, `marketing_leads`, `legal_holds`, and `finance_policy_versions`; `risk_assessments` is read by eligibility/order logic but has no current write route. `kyc_reviews` is used for admin detail/count behavior but is not a complete client verification workflow. These are **probably stale**, not automatically dead: confirm data ownership, reporting, and compliance obligations.

## Consistency risks

1. A failed or duplicated settlement could create divergent order/payment/attempt/ledger projections; existing DB transactions/idempotency mitigate this, so preserve and test them.
2. AUM and client ledger can disagree by design; define a reconciliation report or document the accounting boundary.
3. Receipt acknowledgement is now post-settlement metadata; older docs may lead operators to treat it as an approval gate.
4. `rate_limit_windows` suggests a persistent limiter but runtime enforcement is an in-process map, so multiple replicas would not share limits.
5. Legacy physical tables and archived migrations make fresh-schema reasoning harder than runtime-schema reasoning.
