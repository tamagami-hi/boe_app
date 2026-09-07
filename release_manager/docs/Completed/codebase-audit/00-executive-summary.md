# 00 — Executive summary

## The finding that matters most

The repository's dead code was largely harmless. Its **non-terminating active code** was not.

Five execution paths could not reach a terminal state. Three are now fixed; two need a product
decision and are reported rather than guessed at. The common shape, in every case, is the one
`LOGS/risk_and_decision.md` D-071 already named after the AutoPay investigation:

> A permanent wedge is created not by the upstream failure but by a state machine with no edge
> out of its in-flight state.

D-071 fixed that for mandate **setup** attempts. The same defect existed, unfixed, in mandate
**collections** — and there it was worse, because the collection machine had no grace or expiry
parameter at all. `MandateCollectionConfig` carried only `claimLimit` and `commandEnabled`
(`mandateCollectionWorker.ts:31-34`), and `reconcileCollections` swallowed *every* gateway
error, including the `GatewayNotFoundError` that was the only conceivable exit:

```
catch (error) {
  logGatewayFailure(deps.logger, error, { ... operation: "get_collection_status" })
}
```

So a collection the provider never created left the attempt at `dispatching`, its
`payment_attempt` at `created`, its `payment` at `provider_pending` and its `order` at
`payment_pending` — **permanently**, re-polled every 60 seconds forever. And because
`lockAttemptsForReconciliation` filters `checkout_channel = 'hosted_redirect'`
(`paymentsRepository.ts:667`), the payments worker could not rescue those rows either.

## What was fixed, and how

The fix deliberately does **not** copy D-071's error-code approach. D-071 solved it by reading
PhonePe's response body for a `*_NOT_FOUND` code — but commit `380ba1a` retired PhonePe egress,
that gateway file no longer exists, and the replacement (`providers/relay/`) talks to a payment
service **outside this repository** whose error shape cannot be verified from here. Inventing an
error-code mapping against an unknowable contract is precisely the mistake D-057 records:

> "the only remaining candidate I can see" is not the same as "the cause", and I presented it as
> strong when it was merely undisproven.

So the exit edge is **time-based** instead, which depends on nothing external. Once a
collection's own `checkout_expires_at` (already set to `notifyAt + 48h`) has passed by the
configured `expiryGraceMs`, the worker expires the attempt, the payment and the order, and moves
`notify_state` to `failed`. That terminates regardless of which error the provider emits, or
whether it emits one at all.

Three fixes, all in `backend_controller`:

| # | Was | Now |
| - | --- | --- |
| 1 | Collections had one exit, requiring an error class the relay may never produce | A time-based expiry edge, plus `collectionsExpired` in the pass summary. Two new tests pin both directions. |
| 2 | `lockDueRefunds` had no due filter, so the same open refunds were re-polled every 5 s forever; `last_status_checked_at` was written and never read | A `checkedBefore` predicate bounds the poll to the configured interval (30 s default), and the three non-progress paths now record a check so the predicate is honest. Three new tests. |
| 3 | The mandate reconciliation pass's summary was discarded, and its grace/limit were hardcoded (`60_000`, `25`) rather than read from config | The summary is returned in `PaymentReconciliationPassSummary.mandateReconciliation`, and both values now come from `serverConfig.payments.reconciliation`. A skipped pass is now visible as `null` instead of silence. |

Fix 3 answers the defect D-047 identified and left open — "that is the real defect behind doc
10's complaint, and it is an observability fix … not a topology one."

## The security control that had stopped covering its surface

`release_manager/nginx/*.conf` gated login brute-force with:

```
location ~ ^/api/v1/auth/(native|web)/login$ {
    limit_req zone=boe_auth burst=10 nodelay;
```

The backend serves **four** login endpoints, not two. `/v1/auth/client/web/login`
(`clientWebAuthRoutes.ts:50`, added by D-052) and `/v1/auth/admin/native/login`
(`adminNativeAuthRoutes.ts:69`, added by D-053) do not match that regex. They fell through to
`location /api/` and were limited by `boe_general` at **20 r/s** instead of `boe_auth` at
**5 r/m** — 240× weaker, on the admin console's own login door.

Neither D-052 nor D-053 mentions nginx. The regex was written for the pre-split auth surface and
nothing connected it to the two new doors. Widened in all three site configs to
`^/api/v1/auth/(?:native|web|client/web|admin/native)/login$`.

**This is inert until nginx is reloaded on the VPS.**

## A readiness probe that never ran

Both stack compose files declared:

```
x-worker-health: &worker-health
  test: ["CMD-SHELL", "test -f /tmp/boe-worker-ready"]
```

and **no service aliased it**. All four workers use heartbeat-age probes instead
(`check-worker-health.js <worker> <maxAge>`). So the file probe never executed, and the
`rm -f` / `touch /tmp/boe-worker-ready` in three worker commands were writes nothing read.

It survived because `runtime_contract.test.sh:125` grepped for the anchor's *text* and
:155-157 for the `touch`, rather than checking either was *used*. That is the recurring
pattern in this repository's stale material: **a test that asserts a string exists rather than
that it does anything.** The same shape produced the link-map defect in
[04](04-frontend-dead-code.md) §5.

Removed, and the three assertions rewritten to pin the heartbeat protocol that actually runs.

## Dead code removed

The largest single item was a **superseded port layer**. `backend_controller/src/db/repositories.ts`
declared 15 repository interfaces; **14 had zero consumers anywhere** (only
`IdempotencyRepository` is live). The concrete repositories in `src/repositories/*.ts` each
declare their own interface, with different method names — `UserRepository.lockByNormalizedEmailWithCredential`
versus the real `UserWriteRepository`, and so on. Removing the 14 interfaces orphaned 58 command
and input types, plus 5 that were outright duplicates of the live ones. The file went from
**507 lines to 77**.

Everything else, with counts:

- **9 repository methods** with no production caller (`findContentItem`, `findUser`,
  `lockActiveBySid`, `findOpenInstallment`, `lockByIdUnscoped`, `findLatestAllWorkers`,
  `findSetupAttemptForAdmin`, `findCollectionAttemptForOwner`, `lockByEmailWithCredential`).
- **`createLogEmailSender`** — the fail-open email sender whose own module comment records the
  defect that retired it: it "recorded the delivery as `sent` … for a message that never left
  the process." `test_e2e/onboarding-harness.test.mjs:50` already asserts it is absent from
  `composition.ts`; that negative guard is why it was safe to remove and is deliberately kept.
- **One dead state transition**: `NOTIFY_TRANSITIONS.failed → dispatching`, declared and
  plumbed through `claimCollectionNotification(fromState: "created" | "failed")`, never
  exercised — the only caller passes `"created"`. `failed` is now terminal, which is also what
  the new expiry edge writes.
- **24 frontend exports**, verified by a script requiring zero external references *and* a
  single intra-file occurrence. Plus the cascade: `timeFormatter`, the `DIVIDER` and
  `CARD_INTERACTIVE` recipes, `qk.client.appConfig()`, four now-unused generated-op imports.
- **13 unused `--be-*` CSS tokens**, including `--be-bp-{sm,md,lg,xl}` — one of three
  declarations of the same four breakpoints. Two remain, which is the minimum: one for
  Tailwind (`theme.css`), one for JS media queries (`useBreakpoint.ts`).
- **`@capacitor/local-notifications`** and **`android.permission.POST_NOTIFICATIONS`**. The
  manifest comment justified the permission by citing `updateNotification.js` — **a file that
  does not exist anywhere in the repository**. Nothing calls `requestPermissions`. The app
  declared a runtime notification permission it never asks for and cannot use.
- **The generated API client shrank 108 lines**: the generator emitted an `OPERATIONS` registry
  plus `OperationId` and `OPERATION_IDS`, none of which anything imports. Call sites use the
  individual operation exports.
- **12 configuration settings** across four example files and both compose files, including
  `PROVIDER_MODE`, `ALLOW_DEV_AUTH`, `MOCK_WEBHOOK_ENABLED`, the retired symmetric
  `ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET` pair, `DATABASE_SSL` (the DB config has no SSL
  key at all), and the five `DATABASE_HOST`/`PORT`/`NAME`/`USER`/`PASSWORD` duplicates of
  `DATABASE_URL`.
- **The root `.env.example`**, entirely. There is no root compose file; nothing reads a root
  `.env`; its port and Postgres keys appear nowhere outside `release_manager/stacks/`, which
  uses different names.

## Configuration that lied about what it controlled

Two findings of the same class — a setting an operator can set that does nothing.

`SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME` and `SEED_ADMIN_PHONE` were published in the
root `.env.example`, but `seedAuth.ts` read `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` /
`ADMIN_PHONE`. Setting the documented names did nothing; the admin silently seeded as
"BeOnEdge Admin". Note the asymmetry that hid it: `SEED_CLIENT_FIRST_NAME` **is** read. Fixed in
the code, reading `SEED_*` first with the bare `ADMIN_*` retained as a fallback, matching the
existing `SEED_ADMIN_EMAIL ?? ADMIN_LOGIN_ID` pattern.

Conversely, `TRUST_PROXY` — the *only* control over whether `auth_login_events.ip_address` holds
a real client address — appeared in **no** env example, so no operator could discover it. Now
documented, along with the two DB timeout bounds that were equally invisible.

`envPassthrough.test.ts` structurally could not catch either: it intersects the schema with the
example file, so a key missing from the example is filtered out, and a key the schema does not
declare is invisible. It now has a **reverse-direction guard** across four example files —
"no environment example offers a setting nothing consumes" — proven to fail on a reintroduced
`PROVIDER_MODE` and to pass when clean.

## What is still open, and deliberately so

Two non-terminating paths were **not** fixed, because the fix is a product decision:

1. **A SIP whose installment order ends non-`accepted` pins `next_due_date` forever.** Both
   `sipScheduleWorker.advanceOnePlan` and `mandateCollectionWorker.prepareCollection` advance the
   due date only on `accepted`. For `manual_checkout` this is arguably *correct*: `/pay` accepts
   a `payment_failed` order (`clientOrderRoutes.ts` `prepareAttempt` admits
   `submitted | payment_pending | payment_failed`), so the user can still pay that month, and
   advancing would silently skip an installment they intend to make. But nothing expires that
   intent, so an abandoned installment holds the plan indefinitely. Skip the month, pause the
   plan, or expire the order — that is a product choice.
2. **`refund_operations` has no failure cap.** The poll is now bounded in *rate*, not in *total*.
   `attempt_count` is incremented and never compared to anything. Auto-failing a refund is not a
   cleanup decision.

Plus one deployment-shaped gap left alone: `AWS_REGION`, `SNS_TOPIC_ARN` and
`SES_CONFIGURATION_SET` are absent from **both** stack examples, so `composition.ts:562` never
registers `providerEventRoutes` and the entire SES/SNS inbox — `certificateFetcher`,
`snsMessages`, `snsProvenance`, the `email_provider_events` table — is **dead in deployment**
while being live, correct code. Adding those keys would require compose passthrough and would
switch on a path that has never run. That is a maintainer's call, not a cleanup.

## Where the audit's own analysis was wrong

Four claims from the initial static sweep were **disproved** by reading the code, and are
recorded because the same traps will catch the next tool:

1. "Four admin overview link-map edges are stale." **False.** `OverviewScreen.tsx:80-84`
   filters `ADMIN_ROUTES` and renders `<Link to={route.path}>` at :121-127. The links are
   built dynamically; no literal-string scan can see them.
2. "The generated client has four duplicate alias keys." **False.** The registry was keyed by
   `operationId` while the export block uses `exportName`. Two naming systems, not duplicates.
3. "`BREAKPOINTS` is dead." **False.** `useBreakpoint`/`isCompact` are used by
   `FundListScreen.tsx`, and `BREAKPOINTS` backs their media queries.
4. "`abandonUndispatchedSetup` has no call site." **False.** `clientAutoPaySipRoutes.ts:481`.

A fifth, self-inflicted: I initially wrote in the new `DEPLOY.md` that nginx restricts
`/metrics` to loopback. There is no `/metrics` location in any nginx config; the guard is
`isPrivateRequest` inside the application (`runtime/metrics.ts:50`). Corrected before commit.

I also **built and then reverted** a static guard intended to enforce D-062 (reachability must
be measured from rendered links). It false-positives on exactly the dynamic nav pattern in
correction 1 above, so it would have pressured a future developer into deleting a correct edge.
A worse guard than none. D-062 is only soundly satisfiable by the runtime crawl in
`test_e2e/frontend-ts-audit.mjs`; `routeIntegrity.test.ts` measures declarations by design, and
[04](04-frontend-dead-code.md) §5 says so plainly rather than pretending otherwise.

## Verification

All gates green. Full detail and the explicit not-verified list in
[09](09-verification-results.md).

| Gate | Result |
| ---- | ------ |
| `backend_controller` `npm run check` | typecheck, lint, **804 tests / 79 files**, build, `smoke:source`, `smoke:dist` — exit 0 |
| `frontend_stack_ts` | typecheck, lint, **199 tests / 21 files**, build, `check-bundle-boots` (7 chunks), `check-phonepe-native-target` — all pass |
| `packages/contracts` `npm run check` | OpenAPI validates; "No contract bypasses. 101 contracted operations" |
| `release_manager/tests/*.test.sh` | **15 / 15 pass** |
| `release_manager/verify.sh` | **108 passed, 0 failed**, 1 skipped (remote) |
| `npm run test:onboarding:harness` | 7 pass, 0 fail |
| Dangling-reference sweep | 60 removed symbols; clean apart from one deliberate negative guard and two retirement notes |

The sweep earned its place: it caught three leftovers the type-checker could not, including two
`vi.fn()` stubs for removed repository methods (invisible because the mock is cast
`as unknown as`) and one export I had listed for removal and then omitted from the script.
