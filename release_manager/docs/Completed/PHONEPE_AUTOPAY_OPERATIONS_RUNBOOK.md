# PhonePe AutoPay Operations Runbook

**Status:** Operational draft for sandbox/UAT and controlled rollout
**Last updated:** 2026-08-24
**External approval:** Not completed
**Related UAT:** [PHONEPE_AUTOPAY_UAT_CHECKLIST.md](./PHONEPE_AUTOPAY_UAT_CHECKLIST.md)
**Implementation plan:** [PHONEPE_SIP_AUTOPAY_MANDATE_IMPLEMENTATION_PLAN_2026-08-24.md](./PHONEPE_SIP_AUTOPAY_MANDATE_IMPLEMENTATION_PLAN_2026-08-24.md)

## 1. Scope and authority

This runbook covers PhonePe native one-time checkout, UPI AutoPay mandate setup, monthly AutoPay notification/collection, callbacks, reconciliation and cancellation.

PhonePe is authoritative for provider orders, payment outcomes and mandate state. BeOnEdge is authoritative for users, SIP schedules, canonical investment orders/payments, admin review, allocation, contribution records and fund performance. An SDK return, redirect, notification acknowledgement or cancellation HTTP 204 is never final financial truth.

## 2. Non-negotiable safety invariants

1. Never repeat a setup, debit-notification or cancellation POST after a timeout, network failure, process crash or provider 5xx.
2. Inquire using the already-persisted merchant order or subscription identifier.
3. Never create a replacement merchant identifier while an earlier provider command is ambiguous.
4. Only authenticated callbacks and server-to-server inquiry may change payment or mandate truth.
5. A successful setup debit and an active mandate are separate facts. The SIP activates only when both are confirmed.
6. Successful money always enters the canonical payment and admin-review path exactly once. Mandate failure does not erase, fail or automatically refund a successful debit.
7. Disabling new commands must not disable callback ingestion or reconciliation.
8. Do not expose credentials, OAuth tokens, SDK tokens, callback authorization, raw payloads, VPAs or user data in tickets, chat, screenshots, commands or logs.

## 3. Implemented operational surfaces

| Surface | Implemented contract |
|---|---|
| Setup and user commands | `POST /v1/client/sips/autopay`, `GET /v1/client/sips/autopay/:sipPlanId`, `POST /setup/retry`, `POST /cancel` |
| Subscription callback | `POST /v1/provider-events/phonepe/subscription` |
| Callback authentication | Authorization is validated against the exact raw request body before JSON parsing; only the configured exact event allowlist is accepted |
| Setup/mandate/cancel repair | `paymentReconciliationEntrypoint.js` runs payment reconciliation and mandate reconciliation |
| Monthly collection | `mandateCollectionEntrypoint.js` creates eligible T-24 work only when collection commands are enabled and always reconciles existing collection attempts |
| Canonical money truth | `payment_attempts` and `payments`; successful setup/monthly debit proceeds to `review_pending` |
| Recurring workflow history | `payment_mandates`, `mandate_setup_attempts`, `mandate_collection_attempts`, `mandate_cancel_commands` |

The recurring callback and reconciliation capability is composed whenever complete PhonePe credentials are present. `PHONEPE_AUTOPAY_ENABLED` gates new setup and setup-retry commands; owner cancellation of existing mandates remains available. `PHONEPE_AUTOPAY_COLLECTION_ENABLED` gates new monthly collection commands, not inquiry of existing attempts.

## 4. Pre-deployment readiness

Do not enable any PhonePe command flag until every item below is satisfied:

- PhonePe has confirmed investment-category AutoPay entitlement for the merchant.
- The environment is exact: sandbox credentials with dev endpoints, production credentials with production endpoints.
- PhonePe has registered the exact Android application ID and SHA-256 signing certificate for the build under test.
- Dev client uses `com.beonedge.app.dev`; production client uses `com.beonedge.app`.
- The supported stack is confirmed by PhonePe: `ionic-capacitor-phonepe-pg` 3.0.5, Capacitor 8, Android target SDK 36.
- The generated client native target contains exactly one PhonePe plugin entry and the admin target contains none.
- SDK logging is disabled.
- `PHONEPE_SUBSCRIPTION_CALLBACK_URL` is the exact environment host plus `/api/v1/provider-events/phonepe/subscription`.
- `PHONEPE_SUBSCRIPTION_EVENT_ALLOWLIST` contains only event names enabled and confirmed for this merchant.
- Callback credentials, API credentials, merchant ID and encryption keys are installed through the approved secret path, not copied into documentation or a shell transcript.
- Database backup and rollback artifact checks have passed.
- The payment reconciliation and collection worker services are healthy before command enablement.
- The focused [UAT checklist](./PHONEPE_AUTOPAY_UAT_CHECKLIST.md) has been completed in sandbox/UAT. Repository tests alone are insufficient.

## 5. Kill-switch procedure

### 5.1 Stop all new recurring money commands

Apply flags through the approved environment/deployment workflow. Do not print the effective environment.

1. Set `PHONEPE_AUTOPAY_COLLECTION_ENABLED=false` and deploy/restart the affected services.
2. Confirm the collection worker still runs and reports reconciliation passes, but creates zero new collection commands.
3. Set `PHONEPE_AUTOPAY_ENABLED=false` and deploy/restart.
4. Confirm new AutoPay create and setup retry requests fail closed; confirm owner cancellation of existing mandates remains available.
5. Keep complete PhonePe credentials, subscription callback configuration, the backend, payment reconciliation worker and collection worker running.
6. Confirm callbacks continue returning the expected authenticated acknowledgement and inquiry continues reducing already-pending work.

This order is mandatory because startup validation rejects `PHONEPE_AUTOPAY_COLLECTION_ENABLED=true` when `PHONEPE_AUTOPAY_ENABLED=false`.

Already-queued durable cancellations continue through reconciliation. Existing setup and collection attempts continue inquiry. Do not remove credentials as a routine kill switch: doing so disables the repair path.

### 5.2 Re-enable safely

1. Resolve the incident and complete targeted sandbox/UAT evidence.
2. Enable `PHONEPE_AUTOPAY_ENABLED=true`; keep collection disabled while setup and cancellation behavior is observed.
3. Confirm callbacks and reconciliation are current and no ambiguous backlog exists.
4. Enable `PHONEPE_AUTOPAY_COLLECTION_ENABLED=true` only before a controlled T-24 window with staffed observation.

## 6. Ambiguous provider command response

An HTTP timeout, connection failure, worker crash or provider 5xx after dispatch is ambiguous. It does not prove that PhonePe rejected the request.

1. Disable the relevant new-command flag if the problem is broad.
2. Preserve the existing attempt and its stable merchant identifier.
3. Do not click retry, issue a replacement command or manually edit state.
4. Confirm the payment reconciliation or collection worker is running.
5. Let inquiry query the existing order/subscription identifier.
6. Treat `NOT_FOUND` as non-terminal until the persisted checkout expiry and configured grace have both elapsed.
7. Escalate only sanitized category, environment, timestamps and approved correlation references through the secure vendor-support channel.

The recovery rule is inquiry first. A setup POST or monthly notify POST is never blindly replayed.

## 7. Setup debit succeeded but mandate failed

This is a valid split outcome, not a data contradiction.

1. Confirm the canonical setup payment is succeeded and the investment order is `review_pending` or later.
2. Confirm no second setup debit has been created.
3. Process the successful investment through normal admin review. Do not auto-refund, relabel it failed or remove its allocation after acceptance.
4. Confirm the mandate/SIP reflects provider truth: pre-activation failure becomes `setup_failed`; failure after authorization history becomes `mandate_failed`.
5. Confirm no future AutoPay collection is created for the failed mandate.
6. Tell the user that the completed investment remains invested while future automatic installments are stopped. Do not claim that the mandate activated.

Any refund requires the ordinary authorized refund workflow and separate provider truth.

## 8. Cancellation handling and escalation

1. A client cancellation request creates a durable command before the provider call.
2. A provider 204 means accepted for processing. Keep the mandate/SIP pending until callback or inquiry confirms `CANCELLED`, `REVOKED`, `EXPIRED` or another terminal state.
3. On timeout, network failure or 5xx, never repeat the cancellation POST. Inquiry the subscription.
4. A definite provider rejection may restore the previous active/paused state through the guarded repository transition.
5. If the provider remains `ACTIVE` or `PAUSED`, the worker records status observations. After at least two observations beyond the cancellation grace, the command becomes `reconciliation_required`.
6. For `reconciliation_required`, keep inquiry running and escalate through PhonePe support. Do not forge terminal state and do not dispatch another cancel command.
7. If the provider reports a spontaneous terminal state, accept it through reconciliation even when no local pending action exists.

## 9. Monthly collection timeline

The implemented schedule treats the SIP due date as 10:00 IST and persists:

```text
T-24h, 10:00 IST previous day
  -> confirm local and provider mandate are ACTIVE
  -> create exactly one sip_installment/order/payment/payment_attempt for the due period
  -> create exactly one mandate_collection_attempt
  -> notify PhonePe with autoDebit:true and STANDARD retry

T-24h to provider expiry
  -> notification acknowledgement is not payment success
  -> callback and status inquiry reconcile the stable merchant order

Provider COMPLETED with matching completed amount
  -> canonical payment succeeds
  -> investment order enters review_pending exactly once
  -> allocation occurs only after admin acceptance
```

There must be no manual redeem/execute call for the same `autoDebit:true` collection. A paused, cancelled, revoked, expired, failed or mismatched mandate must not create a new debit command.

## 10. Callback incident response

### Authentication failures

- Do not weaken authentication or temporarily accept unsigned callbacks.
- Verify the configured callback username/password in the secret store and the exact callback URL registered at PhonePe.
- Verify the proxy preserves the Authorization header and raw body.
- Check environment and merchant pairing.
- Keep inquiry workers running while callback delivery is repaired.

### Unknown or disallowed event

- Do not broaden the allowlist speculatively.
- Capture only the event name and sanitized request correlation from protected logs.
- Compare it with the merchant-specific PhonePe event subscription and current official contract.
- Add an event only after written confirmation and a structural flow/correlation test.

### Duplicate or out-of-order event

Duplicates are expected and deduplicated. Terminal provider truth must not regress. Use inquiry to repair ordering gaps; never edit provider state directly.

## 11. Safe operational inspection

Use read-only queries through the approved database access path. Aggregate before sharing results.

```sql
SELECT state, count(*) FROM payment_mandates GROUP BY state ORDER BY state;
SELECT state, count(*) FROM mandate_setup_attempts GROUP BY state ORDER BY state;
SELECT notify_state, count(*) FROM mandate_collection_attempts GROUP BY notify_state ORDER BY notify_state;
SELECT state, count(*) FROM mandate_cancel_commands GROUP BY state ORDER BY state;
```

Useful sanitized log operation names include `create_mandate_sdk_order`, `get_mandate_setup_status`, `get_mandate_status`, `cancel_mandate`, `reconcile_cancel_mandate`, `notify_collection`, `get_collection_status` and `precheck_collection_mandate`. Search by request ID and operation, not by secret, token, VPA or raw payload.

Prometheus application alert rules are intentionally deferred. The current monitoring configuration states that the backend exposes no `/metrics` endpoint. Do not create alert expressions for unimplemented metric names. Until application metrics exist, use worker pass logs, readiness, container health, database health and the aggregate queries above.

## 12. Rollback and schema safety

1. Disable collection commands, then setup/cancel commands, before application rollback.
2. Keep callbacks, payment/mandate reconciliation and collection inquiry running until every dispatched attempt is terminal or explicitly escalated.
3. Take and verify a database backup before deploying migrations or rolling back application code.
4. Migrations `033_phonepe_mobile_sdk_checkout.sql`, `034_sip_autopay_states.sql` and `035_phonepe_autopay_mandates.sql` add financial history and constraints. Do not down-migrate, drop, truncate or rewrite these tables during incident response.
5. After the first live mandate or callback, roll back only to a version that understands these schema additions and preserves the subscription callback/reconciliation path.
6. Preserve provider-event inbox rows, payment attempts, mandate/setup/collection/cancel history and encrypted token envelopes until normal retention policy removes them.
7. Do not rotate or delete an encryption key version while unexpired encrypted SDK tokens still reference it.
8. Re-enable commands only after migration state, worker health and inquiry backlog are verified.

## 13. Escalation package

Prepare a sanitized incident package containing:

- sandbox or production environment;
- affected operation category;
- UTC and IST time window;
- HTTP class such as timeout, 4xx or 5xx without body/authorization headers;
- counts by normalized local state;
- whether callbacks and inquiry are healthy;
- approved merchant order/subscription references sent only through the secure PhonePe support channel.

Never include client secrets, callback passwords, OAuth/SDK tokens, raw payloads, full VPA, database dumps or user identity.
