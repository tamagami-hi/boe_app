# 08 — Retained and uncertain

The governing rule:

> **If deadness cannot be proven, do not delete it.**

This is the list of things that survived that test. Each entry gives the evidence that justified
keeping it, so a later pass does not have to re-derive it — and so a later pass does not delete it
on the strength of a grep.

## 1. LATENT / INTENTIONALLY RETAINED

### `release_manager/lib/apk_manifest.sh` — the top recommendation in this document

`apk_manifest_debuggable()` is 17 lines. It is sourced by **no** entry point — not `deploy.sh`,
`export.sh`, `rollback.sh`, `verify.sh` or `status.sh` — and its only caller is
`tests/apk_logging_policy.test.sh`, which also asserts the file exists.

By the letter of the audit it is dead, and by the letter of the brief a test-only implementation
should go. It is kept because of **what it checks**: whether a shipped APK is debuggable. That is a
release-safety property, and `release_manager/docs/CAPACITOR_DEBUG_LOG_TOKEN_EXPOSURE.md` records a
real debug-log token-exposure incident in this product.

So the finding is not "dead code" but something worse and more useful: **a safety check that is
unit-tested and never runs.** Deleting it removes the intent; leaving it as-is preserves the
illusion that the check happens.

**Recommendation: wire it into `export.sh` or `deploy.sh` for release builds, or delete it
deliberately and record why.** Doing either needs `aapt` availability on the build host, which is a
deployment decision. This is the same class as D-047 — "wire it or remove it" — and it should be
answered rather than inherited.

### `test_e2e/vps-*.mjs` (7 files) and `test_e2e/lib/amount-guard.mjs`

**Do not delete.** These drive the **live production PhonePe merchant**. D-055 is an explicit
decision about them, written after a run created an unintended ₹50,000 order:

- `amount-guard.mjs` enforces a hard ₹2 cap as a **module constant**, which `BOE_TEST_AMOUNT` may
  only lower;
- it checks the **rendered total** the screen shows, not the value typed;
- it fails closed if the total cannot be read.

All six payment-driving scripts import it. They are also the evidence base for the open Entry 032
and Entry 041 diagnoses. Classification: **LATENT-RETAINED**, deliberately.

### `refundRepository.create`, `paymentsRepository.markPaymentRefundPending`, `merchantIds.newMerchantRefundId`

All three have no production caller. All three are kept, per D-048's decision that the refund
machinery stays whole.

The reasoning holds and is worth restating, because a naive sweep will flag them every time: these
are the missing **creation** path for a feature whose other nine-tenths ship — `adminFundReceiptRoutes`
serves the list, requeue and reconcile-now; `paymentReconciliationWorker` claims open refunds and
drives the state machine; `domain/payments/applyRefundOutcome.ts` applies provider callbacks;
`RefundQueueScreen.tsx` is a shipped admin screen behind a `refunds.write` permission.

The question is not "is this dead" but "is refunding a product feature". If yes, the fix is to add
the creation route, and deleting these three makes that harder. If no, the removal spans a
repository, a worker branch, a domain module, three endpoints, a screen, a permission and a table
with a restrictive FK — one reviewed change, not a cleanup pass.

**Consequence to be aware of:** the admin Refunds screen can only ever show an empty list in
production, and an operator may read that as "no refunds have failed" rather than "no refund can
exist". The screen's copy does not distinguish them.

### `mandatesRepository.findMandateForOwner`

Dead in production. Kept because `test/integration/mandatePersistence.integration.test.ts` asserts
it returns `null` for a foreign `userId` — a security contract.

It is the owner-**scoped** half of a pair whose unscoped sibling (`findMandateForAdmin`, 7 callers)
is live. Deleting the safe variant and leaving the unsafe one is the shape that invites a future
unscoped read on a client route.

This is the line that separated it from `findCollectionAttemptForOwner`, which was structurally
identical, equally dead, and had **no test** — and was removed. A test asserting a security boundary
counts as evidence; the absence of one does not.

### `test_e2e/onboarding-harness.test.mjs:50`

`assert.doesNotMatch(source, /createLogEmailSender/u)` against `composition.ts`. A **negative**
guard preventing reintroduction of the fail-open email sender. It is why that symbol still appears
in a repo-wide grep after removal, and it is exactly the kind of assertion that should survive.
Same category as the razorpay guard at `legacy-deletion.guard.test.ts:46`.

### Retirement notes in configuration templates

`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` and `ALLOW_DEV_AUTH` still appear as **text inside
comments** in `stacks/dev_release/.env.example` and `docker-compose.dev_app.yml`, explaining why
those keys are deliberately absent. Not live configuration. The root `README.md`'s no-comments rule
governs source code, not env templates, and a note explaining an absence is more useful than the
absence alone.

### `tools/strip-comments.mjs`

Referenced only by the implementation and decision logs. A recorded one-shot codemod for the
no-comments rule, using the TypeScript parser rather than regex — D-056 notes that a regex stripper
corrupts this codebase's URLs, regex literals and template strings. Kept: cheap, and the repo-wide
sweep it exists for is explicitly still undone.

### `emu/out/` and `release_manager/build/`

Untracked, correctly gitignored, and **not scratch**. `export.sh` reads APKs from `emu/out`, so it is
a pipeline input, and its four captured logs are the evidence for the open Entry 032/041 payment
diagnoses. `release_manager/build/` holds three staged release bundles. Housekeeping candidates,
not dead code — and `emu/out` should not be pruned without checking the release path.

### Over-exported backend symbols

Roughly 30 symbols exported from a module and used only within it (`isCheckoutLive`,
`isInFastWindow`, `parseCookies`, `computeGrowthDelta`, `CURSOR_TTL_MS`,
`INTERNAL_OUTCOME_TO_CODE`, `zodFieldErrors`, `resolveRequestId`, `RETRY_DELAYS_MS`, and the rest).
They have real intra-file callers, so they are **not dead**. Unexporting them is a visibility tidy
across ~20 files with no correctness gain. Recorded so a future sweep does not confuse them with
genuinely unreferenced exports.

### Single-implementation gateway ports

`providers/paymentGateway.ts` and `providers/recurringPaymentGateway.ts` each have exactly one
implementation, both under `relay/`. They are no longer polymorphic. Kept: they are the seam the
relay migration was built on, and `PLAN/payments-relay-design.md` names the port as the thing that
made the migration cheap.

## 2. Reported for decision, deliberately not changed

### Money as a JSON number in three admin contracts

`packages/contracts/src/operations/admin-money.ts` declares `amountPaise: z.number()` in three
places — the admin mandate list row, the mandate detail, and the collection attempts array — while
**every other money field in the contract** uses the `Paise` scalar, a string with a
`^(0|[1-9][0-9]*)$` pattern and a bigint range refinement.

This is why the two admin mandate screens compute `row.amountPaise / 100` in JavaScript: they have a
number, not a `Paise` string, so `formatINR` cannot take it. Floating-point division on money.

It also contradicts the invariant `clientOrderRoutes.ts` states in its own header — *"integer money
never crosses the wire as a float"* — and the frontend's `paiseToRupees`, which per D-019 throws
rather than silently losing precision.

**Not changed.** It is a wire-format change spanning the contract, the backend response shapes, the
generated client and two screens. It needs a decision and a coordinated release, not a cleanup edit.
The formatter duplication it caused *was* fixed — see [04](04-frontend-dead-code.md) §5 — so the
three screens now share one presenter even while the underlying typing stays wrong.

### The SES/SNS inbox is dead in deployment

Fully described in [05](05-configuration-audit.md) §5. `AWS_REGION`, `SNS_TOPIC_ARN` and
`SES_CONFIGURATION_SET` are absent from both stack examples, so `providerEventRoutes` is never
registered and three email modules plus a table are unreachable in every deployed stack. Live,
correct code that configuration switches off.

Adding the keys requires compose passthrough and would switch on a path that has never run.
Maintainer's decision.

### Two lifecycle paths needing a product answer

Both from [02](02-lifecycle-and-state-machines.md):

- **F-004** — a SIP whose installment order ends non-`accepted` pins `next_due_date` forever. Skip
  the month, pause the plan, or expire the order: each is a different product promise.
- **F-005** — `refund_operations` has no failure cap. The poll rate is now bounded; the total is
  not. Auto-failing a refund is a financial decision.

### The relay's error contract

[02](02-lifecycle-and-state-machines.md) §5. Both relay adapters map not-found from HTTP status
alone. D-071 established that PhonePe answers an unknown reference with HTTP 400 and a
`*_NOT_FOUND` **body code**, and fixed it — in a file `380ba1a` deleted along with its regression
test. Whether `GatewayNotFoundError` is producible now depends on an out-of-repo service.

Deliberately **not** guessed at, for the reason D-057 records. Specify the relay's error contract,
then either restore a code-based mapping with a test or give setup attempts a time-based edge
mirroring F-001.

### `PAYMENT_PROVIDER` cannot switch

`z.literal("phonepe").default("phonepe")`. A provider switch with one possible value. Removing it
changes a public config surface and the `ServerConfig` shape.

### Six uncontracted v1 mutations, and five unhandled error codes

[07](07-tooling-deployment-docs.md) §6. `CURSOR_INVALID` is the one with a user-visible
consequence: a filter change must restart pagination, and an unhandled `CURSOR_INVALID` shows an
error where it should silently re-page.

### `divider-fade`

The `@utility` in `ui/styles/status.css` is unreferenced after the `DIVIDER` recipe removal. Left
because Tailwind `@utility` reachability follows the class-name rule, not `var()`, and a same-pass
double removal was not worth the risk.

### `kimi-api-key.txt`

Untracked, gitignored, never committed, contents not read. Correctly contained but still a live
credential on disk. **Rotate and remove.**

## 3. UNCERTAIN — insufficient evidence, untouched

| Item | What is unknown |
| ---- | --------------- |
| `orders.cancelled` | No writer found, but `cancelled` is a plausible operator action that may exist in historical rows |
| `applications.withdrawn` | Read in four places, no writer. Reachable only by manual SQL — deliberate or abandoned? |
| `mandate_collection_attempts.retry_strategy` | A `text` column with no reader found. Low-confidence grep |
| `erased_at` / `pii_tombstoned_at` | No writer found. A **compliance** gap rather than dead code — the schema encodes an erasure capability nothing performs |
| `aum_growth_batches` | Referenced only via a FK from `fund_aum_snapshots`. `fundAumRepository.ts` uses raw SQL that was not exhaustively read |
| `OutboxState` `processing` / `dead_lettered` | The same shape as the confirmed-dead `provider_events` states. `outboxRepository.ts` was not read in full — this is the highest-value remaining check, because the outbox is otherwise the best-behaved machine in the system |
| `composition.ts`'s `merchantId as string` cast | Reachable only in the combination *relay configured, PhonePe callback credentials present, autopay disabled*. Needs a config-matrix decision |
| `https://invalid.local/dashboard` placeholder | Same narrow combination; would be emitted as a real checkout redirect there |
| `ACTIVE_APPLICATION_EXISTS`, `TOKEN_ALREADY_USED` | Each appears in exactly one backend file. A file-level grep cannot distinguish "thrown" from "named in a mapping table" |
| `getAppConfig` | Has no reachable frontend consumer at all now. Either the admin-published client configuration is unfinished, or the publish side is dead. A product question |

## 4. What would make the next pass cheaper

Three of this audit's findings were only findable by reading, and all three are the same defect
class: **a declaration and its consumer were never checked against each other.**

- the nginx `boe_auth` regex versus the registered login routes;
- the `x-worker-health` anchor versus the services that alias it;
- `SEED_ADMIN_*` in an example versus `ADMIN_*` in the code.

Two guards were added here — the reverse-direction configuration check
([05](05-configuration-audit.md) §6) and the collection-expiry state-machine tests
([02](02-lifecycle-and-state-machines.md) F-001). The third, a login-route-to-nginx-zone guard, is
described in [07](07-tooling-deployment-docs.md) §1 and not built.

The general lesson, and the one worth carrying forward: **a test that asserts a string is present
proves nothing about whether it is used.** Three separate stale artefacts in this repository were
kept alive by exactly that. Prefer asserting the relationship.
