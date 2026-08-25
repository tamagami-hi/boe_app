# PhonePe AutoPay Focused UAT Checklist

**Status:** Pending external sandbox/UAT execution
**Last updated:** 2026-08-24
**Runbook:** [PHONEPE_AUTOPAY_OPERATIONS_RUNBOOK.md](./PHONEPE_AUTOPAY_OPERATIONS_RUNBOOK.md)

This checklist records physical-device, PhonePe sandbox/UAT and operational evidence. Checked repository tests do not substitute for vendor entitlement, signing registration, physical UPI behavior or a complete monthly collection cycle.

## Sign-off record

| Field | Value |
|---|---|
| Environment | |
| PhonePe merchant/UAT approval reference | |
| Client application ID | |
| Signing certificate fingerprint verified by | |
| APK version/build | |
| Backend release | |
| Database migration head | |
| Test device and Android version | |
| Compatible UPI app/version | |
| Execution date/time | |
| Operator | |
| Reviewer | |

Do not paste credentials, tokens, raw callbacks, VPAs or personal data into this document.

## 1. Vendor and build gates

- [ ] PhonePe confirms investment-category AutoPay entitlement for this merchant and environment.
- [ ] PhonePe confirms fixed monthly `UPI_MANDATE`, `TRANSACTION` setup and ₹15,000 maximum behavior.
- [ ] Dev test uses `com.beonedge.app.dev`; production candidate uses `com.beonedge.app`.
- [ ] The exact SHA-256 signing certificate for this APK/application ID is registered with PhonePe.
- [ ] PhonePe confirms plugin 3.0.5 compatibility with Capacitor 8 and Android target SDK 36.
- [ ] Client sync/build guard proves exactly one PhonePe native plugin entry.
- [ ] Admin sync/build guard proves no PhonePe native plugin entry or runtime classpath/DEX presence.
- [ ] SDK logging is disabled.
- [ ] No PhonePe credential, OAuth token or SDK token is present in APK assets, bundles or captured application logs.

## 2. Environment and callback gates

- [ ] Sandbox uses pre-production APIs, dev hosts and sandbox merchant registration only.
- [ ] Production candidate uses production APIs, production hosts and production merchant registration only.
- [ ] Subscription callback is exactly `/api/v1/provider-events/phonepe/subscription` on the correct environment host.
- [ ] Payment callback is exactly `/api/v1/provider-events/phonepe/payment` on the correct environment host.
- [ ] An invalid or missing callback Authorization header is rejected before state mutation.
- [ ] A correctly authenticated callback is accepted using the exact raw body.
- [ ] Only the merchant-confirmed exact event allowlist is accepted.
- [ ] Duplicate callbacks acknowledge safely and do not duplicate payment/review/allocation.
- [ ] Out-of-order callbacks do not regress terminal payment or mandate state.
- [ ] Callback loss is repaired by server inquiry without manual state editing.

## 3. Kill-switch gates

- [ ] With all command flags false, callback ingestion and payment/mandate reconciliation remain operational.
- [ ] `PHONEPE_MOBILE_SDK_ORDER_ENABLED=false` prevents new native one-time orders without affecting inquiry.
- [ ] `PHONEPE_AUTOPAY_ENABLED=false` prevents new AutoPay create and setup-retry commands without affecting callbacks, existing-fact repair or owner cancellation of existing mandates.
- [ ] `PHONEPE_AUTOPAY_COLLECTION_ENABLED=false` creates no new collection/notify command while existing collections continue inquiry.
- [ ] Disabling order is collection first, then AutoPay commands; enabling order is AutoPay setup first, collection last.

## 4. Native mandate setup

- [ ] An eligible user can create one pending AutoPay SIP for a published fund.
- [ ] Double tap, request replay and process restart reuse the same idempotency key and create only one SIP, mandate, first installment, payment and setup attempt.
- [ ] The native client opens PhonePe without an external browser as the primary path.
- [ ] Unsupported device/plugin fails honestly and does not create a second setup.
- [ ] SDK `SUCCESS`, `FAILURE` and `INTERRUPTED` never activate the SIP locally.
- [ ] Process death while the UPI app is open recovers to the owner-bound canonical SIP/mandate status without storing an SDK token.
- [ ] The SIP remains `pending_mandate` until both the setup payment succeeds and subscription inquiry reports `ACTIVE`.
- [ ] Setup-payment success arriving before `ACTIVE` remains pending, then activates once `ACTIVE` arrives.
- [ ] `ACTIVE` arriving before setup-payment success remains pending, then activates once payment success arrives.
- [ ] Cross-user mandate detail, retry and cancel requests are rejected.
- [ ] A failed unpaid setup is the only setup eligible for retry.
- [ ] Expired, ambiguous `NOT_FOUND`, already-paid or live setup cannot create a second debit.

## 5. Ambiguous setup recovery

- [ ] Induce a network timeout after PhonePe may have received setup POST.
- [ ] Confirm the persisted attempt remains ambiguous and the client does not send another setup POST.
- [ ] Confirm reconciliation inquiries with the same merchant order ID.
- [ ] Confirm provider `PENDING` remains pending.
- [ ] Confirm `NOT_FOUND` before setup expiry is non-terminal.
- [ ] Confirm `NOT_FOUND` becomes expired only after persisted expiry plus grace.
- [ ] Confirm a new setup attempt is impossible unless the prior setup is authoritatively failed and unpaid.

## 6. Split setup outcomes

- [ ] Setup order/payment succeeds but subscription activation fails.
- [ ] The successful payment enters canonical `review_pending` exactly once.
- [ ] The SIP/mandate records failure and no future AutoPay collection is created.
- [ ] No automatic refund, payment failure rewrite or second setup debit occurs.
- [ ] Admin acceptance creates exactly one allocation/contribution for the successful first investment.
- [ ] User copy explains that the completed investment remains while future AutoPay is stopped.

## 7. Cancellation

- [ ] Cancel before setup dispatch abandons local setup and sends no provider setup POST.
- [ ] Cancel after an ambiguous/materialized setup uses durable cancellation handling.
- [ ] Provider 204 leaves cancellation pending until callback/inquiry confirms terminal state.
- [ ] Timeout or 5xx sends no second cancel POST and continues status inquiry.
- [ ] Definite provider rejection restores the previous active/paused state safely.
- [ ] Two active/paused observations beyond grace move the durable command to `reconciliation_required` without redispatch.
- [ ] Spontaneous provider `CANCELLED`, `REVOKED`, `EXPIRED`, `FAILED` or `PAUSED` reconciles truth even without a local pending action.

## 8. Monthly T-24 collection

- [ ] Test SIP due time is recorded as 10:00 IST.
- [ ] No collection record or notification is created before T-24h.
- [ ] At the T-24 boundary, exactly one due-period installment, payment, payment attempt and collection attempt is created.
- [ ] Concurrent worker passes still send at most one notify command.
- [ ] Request uses `autoDebit:true` with `STANDARD` retry.
- [ ] No manual redeem/execute request is sent for the same collection.
- [ ] Provider mandate is inquired and confirmed `ACTIVE` before collection creation/dispatch.
- [ ] Paused, cancelled, revoked, expired, failed or correlation-mismatched mandate creates no new debit command.
- [ ] Notification acknowledgement alone does not mark payment successful or advance the SIP schedule.
- [ ] Timeout/5xx after notify sends no replacement POST and inquiry uses the stable merchant order ID.
- [ ] Provider `FAILED` before provider expiry remains reconcilable rather than prematurely terminal.
- [ ] Provider `COMPLETED` with matching completed amount reaches canonical `review_pending` exactly once.
- [ ] Callback loss, duplicate callback, out-of-order callback and worker crash all converge to the same final record.
- [ ] Admin acceptance creates one allocation/contribution and only then advances portfolio truth.

## 9. Manual SIP and one-time compatibility

- [ ] Existing SIPs remain `manual_checkout` without silent mandate creation.
- [ ] Manual SIP installment checkout remains available and truthful.
- [ ] AutoPay plans expose no fake merchant pause/resume action.
- [ ] One-time native checkout still uses canonical payment status after every SDK result.
- [ ] Hosted fallback, when enabled, uses the opaque expiring return bridge and cannot mutate payment state.

## 10. Rollback and recovery drill

- [ ] Disable collection commands, then setup/cancel commands.
- [ ] Confirm callbacks and both reconciliation paths continue.
- [ ] Verify database backup and application rollback artifact.
- [ ] Roll back only to a schema-compatible recurring-aware application version.
- [ ] Confirm migrations 033-035 and all provider-event/payment/mandate history remain intact.
- [ ] Confirm pending setup, collection and cancellation work resumes inquiry after rollback.
- [ ] Confirm no destructive down migration, table truncation or provider-history rewrite is required.

## 11. Exit criteria

- [ ] All failures have a sanitized incident reference and disposition.
- [ ] No critical/high security or financial-integrity issue remains open.
- [ ] PhonePe has approved the exact production merchant/app/signing/callback configuration.
- [ ] A controlled production pilot has completed before broad enablement.
- [ ] At least one complete monthly notification/debit/reconciliation/admin-review cycle has been observed before rollout is declared complete.
- [ ] Operations and support owners have reviewed [the runbook](./PHONEPE_AUTOPAY_OPERATIONS_RUNBOOK.md).

**Result:** ☐ Pass ☐ Fail ☐ Blocked
**Blocking evidence/reference:**
**Operator signature/date:**
**Reviewer signature/date:**

