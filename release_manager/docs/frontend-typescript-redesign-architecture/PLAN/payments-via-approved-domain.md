# Plan — move the PhonePe gateway behind `beonedge.in`

> **OUTCOME: DO NOT BUILD PHASES 1-4.** Phase 0 ran on 2026-08-29 and did not move
> `Transacting_URL`. PhonePe cannot distinguish the proxy from the relay, so the migration would
> achieve nothing. See implementation log Entry 033. The design below is kept because it is sound if
> the constraint changes; the premise is what died, not the architecture.

## The constraint

PhonePe approves one merchant URL and re-approval takes 14+ days. `www.beonedge.in` is approved
today; `dev-app.beonedge.in` is not, and `app.beonedge.in` will not be at go-live. Payments are
refused with `INTERNAL_SECURITY_BLOCK_1` and `Transacting_URL: https://dev-app.beonedge.in/`.

Goal: PhonePe only ever sees `www.beonedge.in`. The app keeps behaving exactly as it does now, with
no user-visible mention of the landing domain, and the payment API is callable only by
`dev-app.beonedge.in` and `app.beonedge.in`.

## The design: a stateless relay, not a copy of the payment stack

The instruction was to copy payment processing into `boe_landing`. This plan deliberately narrows
that to a **credential-holding, stateless relay**, because copying the stack duplicates the parts
that are hard to get right and splits the parts that must not be split.

```
initiation   app backend ──(private docker network, HMAC)──▶ landing relay ──▶ PhonePe
callback     PhonePe ──(public, www.beonedge.in)──▶ landing relay ──(HMAC)──▶ app backend
```

`boe_landing` owns: the PhonePe credentials, the PhonePe-facing origin, the OAuth token, and the
HTTP calls to PhonePe. It holds **no payment state at all**.

`backend_controller` keeps: orders, payments, attempts, allocations, idempotency keys, the `version`
optimistic-concurrency columns, the reconciliation worker, and the audit trail. It remains the system
of record.

### Why not copy the state as well

- **The webhook → allocation step must be transactional with order state.** Splitting it across a
  service boundary turns one transaction into a distributed one, which is the single most likely way
  to lose or double-count money.
- **Idempotency and optimistic concurrency already exist and are tested** in the backend. A second
  implementation drifts, and the drift is invisible until it costs a real payment.
- **A fintech's system of record should hold the payment rows.** Reconciliation, statements and audit
  all read from there.
- The relay shape gets the same PhonePe-facing result — every URL on the approved host — for a small
  fraction of the change surface.

### What this does not avoid

PhonePe credentials move into the landing deployment, which also serves the public marketing site.
That is inherent to the requirement and is the real cost of this approach. Mitigations: the relay
runs as its own route group with its own secret, credentials are never exposed to any public path,
and the initiation endpoint is not reachable from the internet at all.

## Access control, stated honestly

"Only `dev-app.beonedge.in` and `app.beonedge.in` may call it" **cannot** be enforced with an
`Origin` check. The caller is the app's *backend server*, which sends no `Origin`, and any client can
forge one. Three layers instead:

1. **Not publicly routed.** The initiation endpoint is bound to a shared Docker network between
   `boe-landing` and `boe-dev-backend`, and is not exposed through Cloudflare or nginx. The two
   containers are currently on separate networks (`boe-landing_edge`, `boe_dev_frontend`), so this
   needs an explicit shared network.
2. **HMAC on every request** with a per-stack secret, following the existing `x-signup-key` pattern
   but signing the body and a timestamp so a captured request cannot be replayed.
3. **Path allowlist in nginx.** Only `/api/v1/provider-events/phonepe/` is public on the approved
   host — the callback leg, which PhonePe must reach. Everything else 404s.

The callback leg cannot be private. PhonePe calls it from the internet. It is protected by PhonePe's
own callback username/password and signature, which the backend already verifies.

## Phase 0 — prove the premise before building anything

Do not skip. If `Transacting_URL` does not move, none of the phases below help, and PhonePe approval
is the only route. From PhonePe's side the proxy below and the full relay are **indistinguishable**:
both put the callback on the approved host. So this validates the entire plan for an hour of work.

1. nginx on `www.beonedge.in` proxies `/api/v1/provider-events/phonepe/` to `127.0.0.1:47423`.
   Already staged and syntax-checked; needs a privileged reload.
2. Re-register the webhook on the PhonePe dashboard as
   `https://www.beonedge.in/api/v1/provider-events/phonepe/payment`. **This is the decisive change** —
   the callback URL is never sent in any request, so it reaches PhonePe only as dashboard state.
3. Deploy the backend at `2143c76` or later, then set `PHONEPE_PUBLIC_CALLBACK_ORIGIN` and point the
   two callback URLs at `www`. Order matters: the running image predates the new code and would
   refuse to start against a `www` callback URL.
4. Re-run the ₹1 test and read `Transacting_URL`.

**Stop here if it moves to `https://www.beonedge.in/`.** Payments work, the app is untouched, and
phases 1–4 are unnecessary.

## Phase 1 — the relay, initiation only

- Shared Docker network between `boe-landing` and the app backend.
- `boe_landing`: `POST /internal/phonepe/checkout` — creates a PhonePe checkout and returns the
  redirect URL. Stateless. HMAC-authenticated. Not publicly routed.
- `boe_landing` gains the PhonePe credential env keys and the OAuth token cache.
- `backend_controller`: a second `PaymentGateway` implementation that calls the relay instead of
  PhonePe directly, selected by config. The `PaymentGateway` interface already exists, so the routes,
  idempotency and state machine are untouched.
- Contract test asserting the two gateway implementations are interchangeable.

## Phase 2 — the relay, callbacks

- `boe_landing`: public `POST /api/v1/provider-events/phonepe/{payment,subscription}` — verifies
  PhonePe's callback auth, then forwards to the backend's existing provider-events route with the
  relay HMAC. No interpretation of the payload; the backend keeps deciding what an event means.
- Replay and duplicate handling stays in the backend, where the idempotency store already lives.

## Phase 3 — order status and refunds

`getOrderStatus`, `refund` and `getRefundStatus` move behind the relay too, otherwise the
reconciliation worker still talks to PhonePe from the app host. Easy to forget; it is the reason a
partial migration would leave the block half-lifted.

## Phase 4 — cut over and remove the direct path

Forward-only: once the relay is proven, delete the direct-to-PhonePe gateway rather than leaving it
selectable. Keep exactly one path in the tree.

## Verification gates

- The relay must be unreachable from the internet: `curl` the initiation path against
  `https://www.beonedge.in` and `https://beonedge.in` and require 404.
- An unsigned or stale-timestamp request to the relay must be refused.
- ₹1 end-to-end with the spend cap in place, then the leg that has never run on this database:
  order → payment → **`investment_allocations` gaining a row** → acknowledgement.
- `envPassthrough.test.ts` will fail if any new key is added to a stack `.env.example` without a
  compose passthrough. That defect already cost a day this session.

## Risks

| risk | mitigation |
| --- | --- |
| `Transacting_URL` is bound to the onboarding record, not the webhook | Phase 0 finds out before any code is written |
| PhonePe credentials in the marketing deployment | own route group, own secret, no public path, initiation not routed publicly |
| relay becomes a second source of truth | it is stateless by construction; no payment tables in `boe_landing` |
| partial migration leaves reconciliation on the app host | Phase 3 exists specifically for this |
| landing deploy cadence now affects payments | payments break if the landing site is down; needs the same monitoring as the backend |
