# Risk and Decisions Register

## Approved architectural decisions

| Area | Decision | Rationale / evidence |
| --- | --- | --- |
| SIP / AutoPay | Keep SIP and AutoPay. Backend schedules due SIPs, validates an active mandate, sends PhonePe Notify Redemption, and reconciles webhooks/status. Use `autoDebit=true` and `redemptionRetryStrategy=STANDARD`; do not implement merchant-side Execute Redemption for this path. | `backend_controller/src/providers/phonepe/phonePeRecurringGateway.ts` sends and validates these values. `sipScheduleWorker.ts` and `mandateCollectionWorker.ts` contain scheduling, precheck, Notify, reconciliation, idempotency, and heartbeat responsibilities; no Execute Redemption call was found. Deployed scheduling remains runtime verification. |
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
| Renaming KYC terminology could accidentally rename genuine regulatory compliance concepts. | Rename only code proven to represent email OTP control; preserve actual regulatory KYC/compliance concepts and legal copy. |
| PhonePe debit/retry behavior could be duplicated by an internal worker. | Keep provider request contract canonical and inspect worker code for Execute Redemption/custom retry behavior. Any remaining duplicate behavior is a release blocker. |
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

## Implementation status

- Active application code now uses Email Verification terminology and the durable
  `users` projection; old KYC route/module imports are absent from the runtime tree.
- Migrations 040–042 are forward-only and fail closed when legacy tables contain
  rows or when verified users/codes do not map to durable `users` records. They are
  not a substitute for production retention approval or a live row-count review.
- The deployment alignment is committed as `2033dbf`; application behavior still
  selects PhonePe environment through configuration rather than source-level gates.
