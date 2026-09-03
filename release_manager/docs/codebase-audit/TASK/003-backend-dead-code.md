# 003 — Backend dead code

## The port layer nobody implemented

`src/db/repositories.ts` declared 15 repository interfaces. Checking each name across `src/`,
`test/` and `scripts/` gave: `IdempotencyRepository` 32 references, and **the other fourteen zero**.

Not "few". Zero.

The reason is structural rather than accidental. Every concrete repository under
`src/repositories/*.ts` declares **its own** interface, and the two generations do not share method
names:

```
dead port:  UserRepository.createFromApprovedApplication / lockByNormalizedEmailWithCredential
live impl:  UserWriteRepository.createActive / findLoginIdentityByEmail / findPasswordHash
```

So this was not an abstraction with one implementation — it was a **superseded design left beside
its replacement**, which is the textbook STALE case.

Removing the 14 interfaces orphaned 58 command, input and row types that existed only as their
parameters. Five more were outright duplicates of the authoritative versions —
`ApplicationQueueQuery`, `UserWithCredential` and `RevokeSessionsResult` are each declared twice in
this repository, and the copies here were the dead ones.

`507 lines → 77`. What remains is exactly what has consumers.

One iteration was needed: `Brand` was removed with the batch and immediately restored, because
`UserId = Brand<string, "UserId">` needs it and `UserId` has 45 references. The type-checker caught
it on the first run.

## Nine repository methods

Each verified across production code, tests and scripts. Two are worth their own note.

**`workerHeartbeatRepository.findLatestAllWorkers`** — its only reference was a stub in
`check-worker-health.test.ts` that **throws `"unexpected"`**. The test asserts it is never called.
The script uses `findLatestByWorker`. Removing it also made the file's `sql` import unused.

**`userRepository.lockByEmailWithCredential`** — STALE, not merely dead, and the code said so
itself. Two separate doc comments explained that the locking variant "used to" hold `FOR UPDATE`
across the Argon2id verification, serialising sign-ins and occupying a pooled connection during pure
CPU work, and that `findLoginIdentityByEmail` plus `findPasswordHash` replaced it. Both comments
were rewritten to describe the current design without naming a deleted symbol.

## The email sender that lied about delivery

`createLogEmailSender` was the only outright-dead export in the whole
`domain`/`http`/`auth`/`crypto`/`cache`/`email` sweep, and the most instructive one. Its own module
comment records the defect that retired it:

> it resolves successfully — so `dispatchDueDeliveries` recorded the delivery as `sent` and settled
> the outbox event as `delivered` for a message that never left the process.

`createUnconfiguredEmailSender` replaced it and fails closed. Keeping a fail-open sender beside a
fail-closed one is a live re-regression hazard: one wrong wire in `composition.ts` and
`email_deliveries.state` stops meaning anything.

`test_e2e/onboarding-harness.test.mjs:50` already asserts its absence from `composition.ts`. That
negative guard is both the evidence the removal is safe and the reason the symbol still shows up in
a repo-wide grep — see `007-final-sweep.md`.

## A retry edge that was never taken

`NOTIFY_TRANSITIONS.failed → dispatching` was declared in `mandateStates.ts`, and plumbed all the
way through `claimCollectionNotification(fromState: "created" | "failed")` and
`lockCollectionNotificationChain`. The only caller passes `"created"`.

A complete retry mechanism for failed collection notifications — declared, typed, wired to the
database — and never once exercised.

`failed` is now terminal, `fromState` is narrowed to `"created"` in both signatures, and the
declared machine finally matches the implemented one. It also matches what the new expiry path from
task 002 writes.

The test asserting the retry edge was updated to assert `failed` is terminal. Per the root
`README.md` that is the permitted case: expected behaviour intentionally changed.

## The line between two identical candidates

Worth stating because it is the audit's operative rule (A-003).

`mandatesRepository.findMandateForOwner` — dead in production — was **kept**, because an integration
test asserts it returns `null` for a foreign `userId`. It is the owner-**scoped** half of a pair
whose unscoped sibling (`findMandateForAdmin`, 7 callers) is live. Deleting the safe variant and
leaving the unsafe one is the shape that invites a future unscoped read on a client route.

`mandatesRepository.findCollectionAttemptForOwner` — equally dead, equally owner-scoped, **no
test** — was **removed**.

A test asserting a security boundary is evidence. Its absence is not.

## What to check next

Nothing blocking. Two things reported rather than acted on:

- `composition.ts` casts `serverConfig.payments.recurring.merchantId as string` while
  `environment.ts` only requires `PHONEPE_MERCHANT_ID` when autopay is enabled, and the registration
  guard never consults `payments.autoPay.enabled`. A `null` can reach a `string` in the combination
  *relay configured, PhonePe callback credentials present, autopay disabled*. Needs a config-matrix
  decision.
- PhonePe webhook ingestion requires **both** `payments.phonepe` and `payments.relay` to be
  configured. A deployment with only the relay registers no webhook routes and
  `createReadinessCheck` does not object.
