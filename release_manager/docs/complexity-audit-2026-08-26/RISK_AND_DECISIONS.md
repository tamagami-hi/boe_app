# Risk and Decisions Register

## Approved architectural decisions

| Area | Decision | Rationale / evidence |
| --- | --- | --- |
| SIP / AutoPay | Keep SIP and AutoPay. Backend schedules due SIPs, validates an active mandate, sends PhonePe Notify Redemption, and reconciles webhooks/status. Use `autoDebit=true` and `redemptionRetryStrategy=STANDARD`; do not implement merchant-side Execute Redemption for this path. Keep the active Standard Checkout API family: `/checkout/v2/subscriptions/...`, `/checkout/v2/order/...`, and `SUBSCRIPTION_CHECKOUT_REDEMPTION`. | `backend_controller/src/providers/phonepe/phonePeRecurringGateway.ts` creates `SUBSCRIPTION_CHECKOUT_SETUP` SDK orders and uses PhonePe's product-specific Standard Checkout AutoPay endpoints. PhonePe's Standard Checkout Notify, status, and cancellation pages confirm this contract and state that AutoDebit removes the Execute step while STANDARD delegates retry to PhonePe. The generic `/subscriptions/v2` family documented elsewhere must not be mixed into this adapter. |
| Durable identity | `users` is the durable user/client identity. Email OTP verification must persist on that identity and is not regulatory KYC. | Existing financial records reference `users`; committed migrations 040/041 move KYC-named OTP state to `users.email_verification_*` and `email_verification_codes`. Migration safety, retention approval, and deployed counts remain unverified. |
| Legacy tables | Remove only through forward migrations after FK, row-count, relationship, and retention checks. Never cascade-delete financial history. | User explicitly approved removal of the listed obsolete tables subject to preservation guarantees. |
| Redis | Keep Redis, isolated between dev and prod. Document actual cache/session/queue/lock use; Redis is not financial truth. | Static inspection found shared read caching with PostgreSQL fallback; PostgreSQL stores sessions and worker state, while the runtime limiter is in-process. The historical concurrency fix is not proven by source/history. |
| Deployment | Keep one application deployment per environment initially, with isolated PostgreSQL and Redis resources. Reuse the same application source/artifact semantics and select environment behavior through configuration. | `release_manager/stacks/dev_release` and `prod_release` provide separate stacks/resources. The frontend API base is baked separately into dev/prod bundles, so byte-identical artifact promotion is not yet proven; see `DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md`. |
| Monitoring | Monitoring/analytics is a separate future repository/stack. BOE_APP may expose standard health, metrics, logs, and audit events, but must not embed an unrestricted monitoring database admin path. | Current repository contains monitor-stack material; extraction/decoupling is being assessed before any removal. |
| Money conversion | Share only the read-side paise-to-rupee conversion. Keep command/write parsers in their feature modules until their validation semantics are proven equivalent. | `frontend_stack/packages/shared/src/money.js` is now used by admin/client read adapters; signed amount parsing remains in `admin/helpers/signedAmounts.js` and order/fund command code. |

## Active risks and controls

| Risk | Control / decision |
| --- | --- |
| Dropping a legacy table could erase data required for retention or leave records without a durable owner. | Migration must fail closed when preservation/retention conditions are not met, and must verify canonical user/financial relationships before removal. Runtime row counts and legal-retention status remain `Needs runtime verification` where the database is unavailable. |
| Legacy KYC terminology could imply a regulatory feature that the product does not provide. | The owner confirmed there is no regulatory KYC feature. Treat `kyc_cases` and `kyc_verification_codes` only as legacy Email OTP storage, preserve their durable user state, then remove them through migration 042. |
| PhonePe debit/retry behavior could be duplicated by an internal worker. | Keep provider request contract canonical and inspect worker code for Execute Redemption/custom retry behavior. Any remaining duplicate behavior is a release blocker. |
| PhonePe publishes both generic AutoPay `/subscriptions/v2` examples and product-specific Standard Checkout `/checkout/v2` examples. | Bind endpoint and flow-type decisions to the setup product used by the adapter. This repository uses Standard Checkout setup, so its product-specific API pages control; exact gateway tests prevent accidental cross-family changes. |
| A provider-rejected Notify could leave collection and payment truth permanently open. | Only a definitive `GatewayRejectedError` now atomically fails the dispatching collection and canonical payment/order. Ambiguous transport/provider failures remain status-reconciled to avoid false failure or duplicate debit. Persistent 404 recovery remains `Needs runtime/vendor verification` until PhonePe idempotent resend or terminal-not-found semantics are contractually proven. |
| A destructive legacy-table migration could run while old application consumers are still connected, or could fail without a usable rollback snapshot. | `_boe_deploy.sh` detects migration 042 only as a destructive upgrade when the database has applied migration history, requires a recorded current release, rejects `--skip-db-backup`, stops Compose consumers before the mandatory backup, and blocks image-only auto-rollback after the destructive boundary. Fresh databases are not misclassified. Stop, backup, and migration-status failures are fail-closed. The live VPS sequence is **Needs runtime verification**. |
| Migration 042 could be deployed or rolled back under an incompatible release identity. | `v0.11.8` predates migrations 040–042, so `0.11.9` is the enforced migration-042 schema boundary. Pending destructive migration deployment fails below that family; rollback and restored-snapshot checks reject incompatible pre/post-042 combinations. |
| Dev/prod configuration drift could make tested artifacts differ from production. | Align source/build semantics and isolate env credentials, URLs, databases, Redis, and PhonePe environment selection. Do not add hard-gated deployment behavior. |
| Existing monitor stack files may be operationally used despite the intended future separate repository. | Do not delete blindly; classify and decouple only after references and release scripts are verified. |
| Redis could be mistaken for the fix for historical concurrency defects. | Preserve Redis for measured ephemeral cache duties, while documenting the evidence that PostgreSQL/transaction contention and password verification were the historical correctness issue. |

## Explicit unresolved items

- Production/dev runtime row counts, FK contents, and statutory retention obligations require environment verification before executing destructive cleanup migrations.
- Deployment artifact byte-identity and actual VPS resource isolation require runtime/deployment verification.
- Monitoring extraction destination is intentionally outside this repository and is not created as part of this change.
- The shared money helper changes presentation mapping only; financial persistence
  continues to use validated integer/string paise values and canonical backend
  settlement invariants.
- Removing the preview-only UI surfaces is reversible through Git and does not
  alter shipped application routes or runtime services; the bundle contract and
  full frontend build are the acceptance gates.

## Implementation status

- Active application code now uses Email Verification terminology and the durable
  `users` projection; old KYC route/module imports are absent from the runtime tree.
- Migrations 040–042 are forward-only and fail closed when legacy tables contain
  rows or when verified users/codes do not map to durable `users` records. They are
  not a substitute for production retention approval or a live row-count review.
- Migration 041 preserves the latest approved historical Email OTP state even when
  a later legacy case is rejected, counts approved identities distinctly, and
  Email Verification audit entries use the updated durable user version.
  Populated-upgrade coverage applies migration 042 and verifies that a durable
  user and linked SIP plan remain while the legacy case table is removed. It is in
  `backend_controller/test/integration/emailVerificationMigration.integration.test.ts`.
- The deployment alignment is committed as `2033dbf`; application behavior still
  selects PhonePe environment through configuration rather than source-level gates.
- PhonePe Standard Checkout endpoint and payload tests now cover setup status,
  subscription status, Notify, redemption status, and cancellation. Definitive
  Notify rejection recovery is implemented; ambiguous failures are not resent or
  failed without provider evidence.
- Deployment safety now has focused regression coverage for migration 042:
  pending-status detection, mandatory backup policy, consumer isolation before
  backup, and destructive-boundary rollback blocking. Static tests pass; actual
  production migration state and container ordering are **Needs runtime
  verification**.
