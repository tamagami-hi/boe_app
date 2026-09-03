# 002 — Lifecycle fixes

The most consequential pass. Three non-terminating paths fixed, two reported.

## The collection wedge

`mandateCollectionWorker.reconcileCollections` selected collections with
`notify_state IN ('dispatching','notified')` and a payment attempt still `created` or
`provider_pending`, called `getCollectionStatus`, and wrapped the whole body in a catch that only
logged.

There was no not-found path, no expiry path, and — the detail that makes it unambiguous —
`MandateCollectionConfig` had **no grace parameter at all**, while the sibling
`MandateReconciliationDeps.config` has both `notFoundGraceMs` and `cancelDispatchGraceMs`. The
collection machine was never given the means to give up.

What that means for a real customer: a collection the provider never created leaves the SIP
installment order at `payment_pending`, its payment at `provider_pending`, and its attempt at
`created`, **permanently**, with a provider call every 60 seconds forever. And the payments worker
cannot rescue it, because `lockAttemptsForReconciliation` filters
`checkout_channel = 'hosted_redirect'` — autopay and mandate-setup attempts are invisible to it.

### The fix, and the choice behind it

Copying D-071 was the obvious move and was rejected. Reasoning in full at `../LOGS/risk_and_decision.md`
A-001; the short version is that the gateway D-071 patched no longer exists, its replacement maps
not-found from HTTP status alone, and it talks to a payment service outside this repository whose
error contract `PLAN/payments-relay-design.md` does not specify. D-057 is the recorded cost of
building on an inference like that.

So the exit is the collection's own clock. `checkout_expires_at` is already set at creation to
`notifyAt + 48 h`; once `now` is past that plus `expiryGraceMs`, `expireStaleCollection` runs
**before** the gateway call:

- `notify_state` → `failed` with `COLLECTION_EXPIRED` (only from `dispatching`; `notified` is already
  terminal);
- the payment attempt → `expired`;
- the payment → `expired`;
- the order → `payment_failed`.

Those are the same primitives `mandateReconciliationWorker.expireCanonicalPayment` uses, so a
synchronously expired collection and a worker-reconciled one are indistinguishable in the ledger.
The row then drops out of the candidate query on both predicates, so the loop provably terminates.

`expiryGraceMs` comes from `serverConfig.payments.reconciliation.expiryGraceMs`, and the pass summary
gained `collectionsExpired` so an expiry is visible rather than silent.

## The refund poll

`lockDueRefunds` selected open refunds ordered by `created_at` with **no due predicate, no lease, no
failure filter**. With the payments loop idling at 5 seconds, one stuck refund meant a provider call
every 5 seconds indefinitely.

The telling detail: `last_status_checked_at` was written by `markStatusChecked` and read only to
render a column in the admin list. A row that recorded every poll while governing none.

`lockDueRefunds` now takes `checkedBefore` and the worker passes
`now - (refundIntervalMs ?? pendingIntervalMs)` — 30 seconds by default, tied to an existing
documented knob rather than a new constant.

A predicate is only honest if every non-progress path stamps it, so three paths that previously
returned `false` silently now record a check: the latest attempt is not `succeeded`;
`initiateRefund` threw; `getRefundStatus` threw. `markProviderPending` is deliberately **not**
stamped, so a genuine state change still gets one immediate follow-up poll.

The column is now load-bearing rather than decorative.

## The invisible mandate pass

`composePaymentReconciliationWorker.runOnce` awaited `runMandateReconciliationPass` and threw its
result away. A pass that converged nothing looked identical to one that converged everything; a
throw inside it was attributed to payments in both the heartbeat and the logs; and a pass skipped
because the recurring gateway was unconfigured produced no signal at all.

This is exactly the defect D-047 named and left open — *"the summary returned to the entrypoint is
the payment summary and the mandate pass's result is discarded. That is the real defect behind doc
10's complaint."*

`PaymentReconciliationPassSummary` now carries
`mandateReconciliation: MandateReconciliationSummary | null`, where `null` means "skipped, no
recurring gateway" — distinguishable from "ran and resolved nothing". Both hardcoded config values
(`60_000` grace, `claimLimit: 25`) now come from `serverConfig`, and the dead module constant is
gone. A-002 records the deliberate consequence: the setup not-found grace becomes 300 s by default,
which is more conservative.

## Two left alone

**A SIP whose installment is abandoned pins `next_due_date` forever.** Both workers advance the due
date only on `accepted`. For `manual_checkout` this is arguably correct — `/pay` accepts a
`payment_failed` order, so the user can still pay that month, and advancing would silently skip an
installment they intend to make. The defect is that nothing expires that intent. Skip the month,
pause the plan, or expire the order: three different promises to the customer. A-011.

**`refund_operations` has no failure cap.** `attempt_count` is incremented and compared to nothing.
Rate is now bounded; total is not. Auto-failing a refund is a financial decision.

## Tests

Five new, all in the "critical state-machine correctness" category the root `README.md` permits.

`mandateCollectionWorker.test.ts` — the expiry path fires **without calling the gateway** and writes
all four transitions with `COLLECTION_EXPIRED`; and a collection still inside its window is polled
and **not** expired even when the gateway throws. The second is the one that matters: it pins that
the fix did not become an indiscriminate expiry.

`paymentReconciliationWorker.test.ts` — the `checkedBefore` argument is exactly
`now - pendingIntervalMs`; and both new `markStatusChecked` paths.

## What to check next

`../02-lifecycle-and-state-machines.md` §6 has read-only SQL to find out whether wedged rows already
exist in production. **The code no longer creates them; existing rows are not retroactively
repaired.** If the collection query returns rows, they need a one-off remediation decided with the
same care as the fix.

And `lockDueRefunds`' new SQL predicate has never met PostgreSQL — it is asserted only against a
stubbed repository. `npm run test:integration` needs a container runtime.
