# 02 — Lifecycle and state machines

Read this before touching payments. Everything here is **STATIC** — source read only. No
database was queried; §6 gives the read-only SQL to find out whether wedged rows exist.

## 1. What actually runs

Four worker containers, from one backend image
(`release_manager/stacks/prod_release/docker-compose.prod_app.yml`):

| Service | Command | Cadence | Heartbeat name / max age |
| ------- | ------- | ------- | ------------------------ |
| `payments-worker` | `dist/paymentReconciliationEntrypoint.js` | long-lived self-scheduling loop | `payment_reconciliation` / 120 s |
| `email-worker` | `dist/emailWorker.js` in a shell loop | 15 s | `email_dispatch` / 60 s |
| `collections-worker` | `dist/mandateCollectionEntrypoint.js` in a shell loop | 60 s | `mandate_collection` / 180 s |
| `sips-worker` | `dist/sipScheduleEntrypoint.js` in a shell loop | 300 s | `sip_schedule` / 900 s |

**There is no mandate-reconciliation container.** `runMandateReconciliationPass` is called inside
`composePaymentReconciliationWorker`'s `runOnce` (`runtime/composition.ts`), guarded on the relay
gateway being configured. D-047 decided this co-hosting deliberately; the defect it left open —
the discarded summary — is fixed here (§4).

**A green heartbeat does not mean work happened.** `success` is `true` whenever `runOnce()` did
not throw, and `runOnce` returns an all-zero summary when the gateway is unconfigured. The email
worker likewise reports a healthy pass with no transport. All four healthchecks go green on a
stack where no payment is reconciled and no mail is sent. The metrics that *would* catch this
are computed and exported (`runtime/metrics.ts`: `countPaymentReconciliationBacklog`,
`countMandateReconciliationBacklog`, `countSetupDispatchBacklog`, `countCollectionNotifyBacklog`,
`countCollectionReconcileBacklog`, `countCancelEscalations`, `countStaleSetups`,
`countStaleCollections`) and **nothing alerts on them**. That is the highest-value observability
gap in the system and it is unchanged by this audit.

## 2. State machines, with terminal states

| Machine | States | Terminal | Transition enforcement |
| ------- | ------ | -------- | ---------------------- |
| `orders.state` | `submitted, payment_pending, accepted, refund_pending, refunded, refund_failed, payment_failed, cancelled` | `accepted` (until refund), `refunded`, `refund_failed`, `payment_failed`, `cancelled` | Guarded `UPDATE … WHERE state = …` in `paymentsRepository` |
| `payments.state` | `created, provider_pending, succeeded, failed, expired, reconciliation_required, refund_pending, refunded, refund_failed` | `succeeded, failed, expired, refunded, refund_failed`; `reconciliation_required` is terminal **by omission** — nothing re-claims it | Guarded UPDATEs |
| `payment_attempts` | same enum, plus `checkout_channel ∈ hosted_redirect, phonepe_mandate_setup, phonepe_autopay` | as payments | Per-channel dispatch pairs, all guarded on `state='created'` |
| mandates | `setup_pending, active, pause_pending, paused, cancel_pending, revoke_pending, cancelled, revoked, expired, failed` | `cancelled, revoked, expired, failed` | **Declarative** — `MANDATE_TRANSITIONS` in `domain/payments/mandateStates.ts`, enforced inside the UPDATE value builders |
| setup attempts | `created, dispatching, provider_pending, authorized, failed, expired` | `authorized, failed, expired` | `SETUP_TRANSITIONS` |
| collection notify | `created, dispatching, notified, failed` | `notified`, and now `failed` | `NOTIFY_TRANSITIONS` |
| `sip_plans` | `draft, pending_mandate, active, paused, cancel_pending, cancelled, completed, setup_failed, mandate_failed, expired, revoked` | `cancelled, completed, setup_failed, mandate_failed, expired, revoked` | `AUTOPAY_SIP_TRANSITIONS` |
| `refund_operations` | `pending, provider_pending, refunded, failed` | `refunded, failed` | Guarded UPDATEs |
| outbox / deliveries | `pending → processing → sending → delivered / retryable_failed / dead_lettered / cancelled` | `delivered, dead_lettered, cancelled` | **The best-behaved machine here**: a real lease cleared on every exit, an attempt counter, and a genuine cap → `dead_lettered` |
| `provider_events` | `received, processing, processed, dead_lettered` | `processed` | Only `received` and `processed` are ever written — see [06](06-persistence-audit.md) |
| `auth_sessions` | `active, revoked, expired` | `revoked` | `expired` has no writer; expiry is enforced by timestamp |

Only `payment_mandates` and its attempt tables have a declared transition table. Everything else
enforces transitions through query predicates, which works but is not inspectable in one place.

## 3. The five non-terminating paths

### F-001 — Collection attempts had no exit. **FIXED**

*Class: BROKEN / STUCK. Severity: highest — wedges an order, a payment and an attempt permanently.*

`listCollectionReconciliationCandidates` selects `notify_state IN ('dispatching','notified')`
**and** `payment_attempts.state IN ('created','provider_pending')`. `reconcileCollections`
called `getCollectionStatus` and wrapped the whole body in a catch that only logged. There was
no not-found path, no expiry path, and `MandateCollectionConfig` had no grace parameter at all —
in contrast to `MandateReconciliationDeps.config`, which has both `notFoundGraceMs` and
`cancelDispatchGraceMs`.

Consequences, all permanent: `mandate_collection_attempts.notify_state` stuck at `dispatching`;
`payment_attempts.state` at `created`; `payments.state` at `provider_pending`;
`investment_orders.state` at `payment_pending`; and a `getCollectionStatus` call every 60 s
forever. The payments worker could not help — `lockAttemptsForReconciliation` filters
`checkout_channel = 'hosted_redirect'`, so `phonepe_autopay` and `phonepe_mandate_setup`
attempts are invisible to it.

**Fix.** A time-based edge, chosen over D-071's error-code approach for the reason in
[00](00-executive-summary.md): the relay's error contract is out of repo and unverifiable, and
D-057 records the cost of building on an undisproven inference. Before calling the gateway,
`reconcileCollections` now checks the attempt's own `checkout_expires_at` (set to
`notifyAt + 48 h` at creation) against `now - expiryGraceMs`. Past that, `expireStaleCollection`
moves `notify_state` to `failed` (only from `dispatching`; `notified` is already terminal),
expires the attempt and the payment, and fails the order — reusing the same primitives
`mandateReconciliationWorker.expireCanonicalPayment` uses, so a synchronous expiry and a
reconciled one are indistinguishable in the ledger.

`expiryGraceMs` is wired from `serverConfig.payments.reconciliation.expiryGraceMs`
(`PAYMENT_RECONCILIATION_EXPIRY_GRACE_SECONDS`, default 300). The summary gained
`collectionsExpired`.

**Why time-based is the right shape.** It terminates regardless of which error the provider
emits, or whether it emits one at all, or whether the relay's status mapping is correct. An
error-class edge is only as reliable as the least reliable mapping between here and the provider.

**TESTED** — two new cases in `mandateCollectionWorker.test.ts`: one asserts the expiry path
fires without calling the gateway and writes all four transitions with `COLLECTION_EXPIRED`; one
asserts a collection still inside its window is polled and **not** expired even when the gateway
throws.

### F-002 — Refund polling was unbounded. **FIXED**

*Class: BROKEN / STUCK (unbounded retry).*

`lockDueRefunds` selected `state IN ('pending','provider_pending')` ordered by `created_at` with
**no due-time predicate, no lease and no failure filter**. With the payments loop idling at 5 s,
a single stuck refund produced a provider call every 5 seconds indefinitely. `last_status_checked_at`
was written by `markStatusChecked` and read only for display in `listPage` — a column that
recorded the poll without ever governing it.

**Fix.** `lockDueRefunds` takes `checkedBefore`, admitting a row only when
`last_status_checked_at IS NULL OR < checkedBefore`. The worker passes
`now - (refundIntervalMs ?? pendingIntervalMs)`, i.e. 30 s by default — a 6× reduction tied to an
existing documented knob.

A predicate is only honest if every non-progress path records a check, so three paths that
previously returned `false` silently now call `markStatusChecked`: the latest attempt is not
`succeeded`; `initiateRefund` threw; `getRefundStatus` threw. The two paths that already recorded
a check (correlation mismatch, outcome pending) are unchanged, and `markProviderPending` is
deliberately left un-stamped so a state change gets one immediate follow-up poll.

**TESTED** — three new cases in `paymentReconciliationWorker.test.ts` pinning the `checkedBefore`
argument and both new `markStatusChecked` paths.

**Not fixed:** there is still no *cap*. `attempt_count` is incremented and compared to nothing.
See §5.

### F-003 — The mandate pass was invisible. **FIXED**

*Class: BROKEN / STUCK (observability). This is the defect D-047 named and left open.*

`composePaymentReconciliationWorker.runOnce` awaited `runMandateReconciliationPass` and
**discarded its result**, returning only the payment summary. So a mandate pass that converged
nothing was indistinguishable from one that converged everything, a throw inside it was
attributed to payments in both the heartbeat and the logs, and a pass skipped because the
recurring gateway was unconfigured produced no signal at all.

Its configuration was also hardcoded — `claimLimit: 25` and
`notFoundGraceMs: PAYMENT_NOT_FOUND_GRACE_MS` (a module constant of `60_000`) — while the payment
path read all seven of its tunables from `serverConfig`.

**Fix.** `PaymentReconciliationPassSummary extends ReconciliationSummary` with
`mandateReconciliation: MandateReconciliationSummary | null`. `null` distinguishes "skipped, no
recurring gateway" from "ran and resolved nothing". Both hardcoded values now come from
`serverConfig.payments.reconciliation`, and the dead constant is gone.

**Deliberate behaviour change:** the setup not-found grace moves from a hardcoded 60 s to the
configured `expiryGraceMs`, default **300 s**. Longer is strictly more conservative — it waits
five minutes rather than one before declaring that a provider never created an order — and it is
now operator-tunable, consistent with the payment path. `claimLimit` is unchanged in effect
(`PAYMENT_RECONCILIATION_CLAIM_LIMIT` defaults to 25).

### F-004 — A SIP whose installment is abandoned pins its due date. **REPORTED, product decision**

*Class: BROKEN / STUCK. Not fixed.*

`sipScheduleWorker.advanceOnePlan` advances `next_due_date` only when the period's existing order
is `accepted`; any other non-open state returns `waiting` and breaks the loop.
`mandateCollectionWorker.prepareCollection` has the same structure — the advance sits inside the
`state === "accepted"` branch.

So an installment order that ends `payment_failed` holds `next_due_date` at that period. `listDue`
/ `listAutoPayDue` keep returning the plan; every pass re-locks it and makes no progress. For
autopay this additionally burns a `getMandateStatus` call per pass in
`confirmActiveBeforeCollectionCreation`.

**Why it was not fixed.** For `manual_checkout` the holding behaviour is defensible:
`clientOrderRoutes`' `prepareAttempt` admits `submitted | payment_pending | payment_failed`, so
the user can still pay that month, and advancing would silently skip an installment they intend
to make. The defect is that nothing ever *expires* that intent. Choosing between skip-the-month,
pause-the-plan and expire-the-order changes product behaviour, and
`AUTOPAY_SIP_TRANSITIONS.active` offers no `collection_failed` state to fall into.

### F-005 — `refund_operations` has no failure cap. **REPORTED, product decision**

Rate is now bounded (F-002); total attempts are not. Auto-failing a refund is a financial
decision. Contrast the outbox, which caps attempts and dead-letters — the pattern exists in this
codebase, just not here.

## 4. Dead and impossible transitions

**`NOTIFY_TRANSITIONS.failed → dispatching` — removed.** Declared in `mandateStates.ts` and
plumbed all the way through `claimCollectionNotification(fromState: "created" | "failed")` and
`lockCollectionNotificationChain`. The only caller passes `"created"`. A retry edge for failed
notifications was declared, wired, and never once exercised. `failed` is now terminal — which is
also what F-001's expiry path writes, so the declared machine and the implemented one now agree.
`fromState` is narrowed to `"created"` in both signatures. The test that asserted the retry edge
was updated to assert `failed` is terminal; per the root `README.md` this is a case where
expected behaviour intentionally changed.

**Left in place, reported:**

- `auth_sessions.expired` — no writer; every read filters `state = 'active'`. **DEAD** enum value.
- `applications.withdrawn` — read in four places, no writer. **STALE**, reachable only by manual SQL.
- `orders.cancelled` — no writer found. **UNCERTAIN**, likely dead.
- `provider_events.processing` / `dead_lettered` — no writer, no reader. **LATENT-RETAINED** per
  D-050, which removed their only driver and documented the consequence.
- `GatewayAuthenticationError` — not thrown by either relay adapter; only the callback verifier
  can produce it, yet `classifyGatewayFailure` still branches on it.

None of these can be removed without a migration; see [06](06-persistence-audit.md).

## 5. The latent risk this audit could not close

`relayPaymentGateway.ts` and `relayRecurringGateway.ts` are byte-for-byte symmetric in their error
mapping: `404 → GatewayNotFoundError`, `400|422 → GatewayRejectedError`, and **neither inspects the
response body**. D-071 established that PhonePe answers an unknown reference with HTTP 400 and
`{"code":"ORDER_NOT_FOUND"}`, and fixed it by reading the code — in a file that commit `380ba1a`
deleted along with its regression test.

Whether `GatewayNotFoundError` is producible now depends entirely on whether the out-of-repo
payment service converts PhonePe's 400 into a 404. **That cannot be determined from this
repository**, and `PLAN/payments-relay-design.md` does not specify the error contract.

Two consequences:

1. `mandateReconciliationWorker`'s setup not-found path is still gated on an error class that may
   be unreachable. F-001's time-based fix does not cover setup attempts — they have their own
   grace path, and changing it was out of scope for a cleanup.
2. The regression test that pinned D-071's behaviour is gone. Nothing now asserts that a
   provider not-found is recognised.

**Recommendation:** specify the relay's error contract explicitly, then either restore a
code-based mapping with a test, or add a time-based edge to setup attempts mirroring F-001.

## 6. Read-only SQL to find existing wedged rows

The code no longer creates these; rows created before this change are not retroactively repaired.

```sql
-- collections stuck in flight past their own expiry
select c.notify_state, a.state as attempt_state, count(*)
from mandate_collection_attempts c
join payment_attempts a on a.id = c.payment_attempt_id
where c.notify_state in ('dispatching','notified')
  and a.state in ('created','provider_pending')
group by 1, 2;

-- attempts by channel and state (the hosted_redirect-only claim filter)
select checkout_channel, state, count(*) from payment_attempts group by 1, 2;

-- open refunds and whether they have ever been checked
select state, count(*), min(last_status_checked_at), max(attempt_count)
from refund_operations where state in ('pending','provider_pending') group by 1;

-- active plans whose due date is in the past (pinned by F-004)
select collection_mode, count(*) from sip_plans
where state = 'active' and next_due_date < current_date group by 1;

-- enum values this audit believes are unwritten
select count(*) from provider_events where state in ('processing','dead_lettered');
select count(*) from auth_sessions where state = 'expired';
select count(*) from applications where state = 'withdrawn';
select count(*) from investment_orders where state = 'cancelled';
```

**UNVERIFIED** — run on the VPS with `ssh beonedge` and read-only access.
