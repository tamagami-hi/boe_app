# Audit log

What changed, in order, with verification status. Vocabulary: **TESTED** (command run here and
passed, named), **STATIC** (read or type-checked only), **UNVERIFIED** (needs a device, database or
deploy — command given).

Baseline: working tree `13f2c76`, clean, v0.12.7.

---

## Entry 001 — Lifecycle fixes in the payment workers

**What changed.**

`src/mandateCollectionWorker.ts` — `MandateCollectionConfig` gained `expiryGraceMs`. Added
`isCollectionPastExpiry` and `expireStaleCollection`. `reconcileCollections` now checks the locked
attempt's `checkout_expires_at` against `now - expiryGraceMs` **before** calling the gateway; past
that it moves `notify_state` to `failed` (from `dispatching` only), expires the attempt and payment,
and fails the order. It returns `{ resolved, expired }` and the pass summary gained
`collectionsExpired`.

`src/repositories/refundRepository.ts` — `lockDueRefunds` takes `checkedBefore` and admits a row
only when `last_status_checked_at IS NULL OR < checkedBefore`.

`src/paymentReconciliationWorker.ts` — added optional `refundIntervalMs`; `lockDueRefunds` is called
with `now - (refundIntervalMs ?? pendingIntervalMs)`; added `recordRefundCheck` and called it on the
three paths that previously returned without recording a check.

`src/runtime/composition.ts` — wired `expiryGraceMs` from
`serverConfig.payments.reconciliation.expiryGraceMs`. Introduced
`PaymentReconciliationPassSummary extends ReconciliationSummary` with
`mandateReconciliation: MandateReconciliationSummary | null`, and `runOnce` now returns the mandate
pass's summary instead of discarding it. Removed the hardcoded `PAYMENT_NOT_FOUND_GRACE_MS = 60_000`
and the hardcoded `claimLimit: 25`; both now come from `serverConfig`.

**Why.** Three non-terminating paths. Full reasoning in `../02-lifecycle-and-state-machines.md`
F-001 to F-003.

**Why time-based rather than D-071's error-code approach.** The gateway D-071 fixed was deleted by
`380ba1a`; the replacement talks to an out-of-repo payment service whose error contract cannot be
verified here, and `PLAN/payments-relay-design.md` does not specify it. D-057 records the cost of
building on an undisproven inference. A time-based edge depends on nothing external.

**Deliberate behaviour change.** The setup not-found grace moves from a hardcoded 60 s to the
configured `expiryGraceMs` (default 300 s) — strictly more conservative, and now operator-tunable.
`claimLimit` is unchanged in effect (default 25).

**Verified.** **TESTED** — `npx vitest run`: 804 tests pass. Five new tests: two in
`mandateCollectionWorker.test.ts` (the expiry path fires without calling the gateway and writes all
four transitions; a collection inside its window is polled and not expired even when the gateway
throws), three in `paymentReconciliationWorker.test.ts` (the `checkedBefore` argument, and both new
`markStatusChecked` paths). `composition.test.ts` and `mandateCollectionWorker.test.ts` summary
assertions updated for the new field.

**Not verified.** **UNVERIFIED** — the new `lockDueRefunds` SQL has never met PostgreSQL
(`npm run test:integration` needs testcontainers). No wedged row has been observed or repaired;
existing rows are not retroactively fixed. Read-only SQL to find them is in
`../02-lifecycle-and-state-machines.md` §6.

---

## Entry 002 — Backend dead code

**What changed.**

`src/db/repositories.ts` 507 → 77 lines: removed 14 unconsumed port interfaces, the 58 types
orphaned by them, 3 duplicate types whose authoritative versions live in `src/repositories/*.ts`,
and 2 row aliases with no consumer. `Brand` was briefly removed and restored — `UserId` needs it.

Nine repository methods removed: `adminContentRepository.findContentItem`,
`adminOversightRepository.findUser`, `authSessionRepository.lockActiveBySid`,
`orderRepository.findOpenInstallment`, `sipPlanRepository.lockByIdUnscoped`,
`workerHeartbeatRepository.findLatestAllWorkers` (+ its now-unused `sql` import),
`mandatesRepository.findSetupAttemptForAdmin`, `mandatesRepository.findCollectionAttemptForOwner`,
`userRepository.lockByEmailWithCredential`.

`src/email/emailSender.ts` — removed `createLogEmailSender` and `EmailSendLog`; rewrote two prose
references.

`src/domain/payments/mandateStates.ts` — `NOTIFY_TRANSITIONS.failed` is now terminal;
`claimCollectionNotification`'s `fromState` narrowed to `"created"` in both signatures.

Comments rewritten in `src/repositories/userRepository.ts` and `src/domain/auth/webAuth.ts` because
they named a deleted symbol.

**Why.** `../03-backend-dead-code.md`.

**Kept deliberately.** `refundRepository.create`, `markPaymentRefundPending`,
`newMerchantRefundId` (D-048), and `mandatesRepository.findMandateForOwner` — an integration test
asserts its owner-scoping, which is why it stayed while its untested structural sibling went.

**Verified.** **TESTED** — typecheck, lint, 804 tests, build, `smoke:source`, `smoke:dist`.
`mandateStates.test.ts` updated: it asserted the retry edge, and now asserts `failed` is terminal.

---

## Entry 003 — Configuration

**What changed.**

Deleted the root `.env.example`. Removed `DATABASE_SSL`, `ACCESS_TOKEN_SECRET`,
`REFRESH_TOKEN_SECRET`, `ALLOW_DEV_AUTH`, `MOCK_WEBHOOK_ENABLED` from
`backend_controller/.env.production.example`. Removed `PROVIDER_MODE=live` from the production stack
example. Removed the six-line dead `DATABASE_HOST/PORT/NAME/USER/PASSWORD/SSL` block from both stack
compose files.

`src/scripts/seedAuth.ts` — `resolveSeedAuthConfig` now reads `SEED_ADMIN_FIRST_NAME ??
ADMIN_FIRST_NAME`, and likewise for last name and phone.

`backend_controller/.env.example` — documented `TRUST_PROXY`, `DB_STATEMENT_TIMEOUT_MS`,
`DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`.

`src/runtime/envPassthrough.test.ts` — added a reverse-direction guard: "no environment example
offers a setting nothing consumes", across four example files, with an explicit
`INFRASTRUCTURE_KEYS` allowlist and a sanity assertion on the scan itself.

**Why.** `../05-configuration-audit.md`. The `SEED_ADMIN_*` case is the sharpest: three documented
settings did nothing while their `SEED_CLIENT_*` siblings worked.

**Verified.** **TESTED** — `envPassthrough.test.ts` 10 tests pass; `seedAuth.test.ts` 16 pass. The
new guard was **proven both ways**: appending `PROVIDER_MODE=development` to
`backend_controller/.env.example` made it fail with `expected [ 'PROVIDER_MODE' ] to strictly equal
[]`; removing it made it pass.

**Not verified.** **UNVERIFIED** — the compose edits take effect on the next deploy. Behaviour is
unchanged, since nothing read the removed keys.

---

## Entry 004 — Frontend dead code and duplicates

**What changed.**

`src/domain/money.ts` — added `formatRupees(rupees, options)`; `formatINR` delegates to it. Three
screens dropped their local `Intl.NumberFormat` and import it.

`src/ui/patterns/AsyncBoundary.tsx` — deleted the local `isSessionEndingError` (verbatim duplicate
of `api/errors.isSessionEnded`) and the dead `transportErrorVariant`.

`scripts/generate-api-client.mjs` — stopped emitting `OPERATIONS` / `OperationId` /
`OPERATION_IDS`. Regenerated: 315 → 207 lines.

24 dead exports removed plus their cascade. `platform/systemChrome.ts` collapsed after
`pushSystemChrome` went — the stack, subscriber set, `notify` and `subscribeToSystemChrome` were all
only reachable through it. `SystemBarsController.tsx` simplified to apply on mount and on resume.

13 unused `--be-*` tokens removed from `ui/tokens/tokens-core.css`.

`@capacitor/local-notifications` removed from `package.json`, `capacitor.config.ts` and the lock
file. `POST_NOTIFICATIONS` removed from `android/app/src/main/AndroidManifest.xml`.

Three mis-sourced `LINK_MAP` edges corrected.

**Why.** `../04-frontend-dead-code.md`.

**Behaviour preserved.** The `systemChrome` collapse is byte-identical in effect:
`applySystemChrome(DEFAULT_CHROME)` on mount and on resume, as before —
`getSystemChrome()` had *always* returned the default because nothing ever pushed.

**Attempted and reverted.** A static guard asserting every `LINK_MAP` target is backed by a
rendered path literal. It false-positives on `OverviewScreen`'s dynamic
`ADMIN_ROUTES.filter().map()` nav rendering, so it would pressure a future developer into deleting a
correct edge. D-062 remains enforceable only by the runtime crawl.

**Verified.** **TESTED** — typecheck, lint, 199 tests, `npm run build`, `check-bundle-boots`,
`check-phonepe-native-target`. Generator confirmed idempotent; diff is 108 deletions, zero
additions.

**Not verified.** **UNVERIFIED** — both APKs need rebuilding
(`npm run android:sync` and `android:sync:admin`, then install). The plugin and permission removal
changes APK contents.

---

## Entry 005 — Tooling and infrastructure

**What changed.**

All three nginx site configs: the `boe_auth` location regex widened from
`^/api/v1/auth/(native|web)/login$` to
`^/api/v1/auth/(?:native|web|client/web|admin/native)/login$`.

Deleted `test_e2e/faq-debug.mjs` and `test_e2e/frontend-ts-shots.mjs`. Removed
`repo_sync_notice()` from `release_manager/lib/repo_sync.sh`. Removed the commented `/ws/` blocks
from three configs and the now-unreferenced `$connection_upgrade` map from `boe-shared.conf`.
Removed 15 `BOE_APP/` rules from `release_manager/.gitignore`. Added `.kotlin` and
`android/.kotlin` to `frontend_stack_ts/.gitignore`.

Removed the unaliased `x-worker-health` anchor and the `rm -f`/`touch /tmp/boe-worker-ready` side
effects from both stack compose files, and rewrote the three `runtime_contract.test.sh` assertions
that pinned them to pin the heartbeat protocol instead.

**Why.** `../07-tooling-deployment-docs.md`. T-001 is the security item: two live login endpoints
were limited 240× more loosely than intended, and the nginx zone is the only real brute-force
control because the DB rate-limit table is dead.

**Verified.** **TESTED** — 15/15 `release_manager/tests/*.test.sh`; `verify.sh` 108 passed / 0
failed / 1 skipped; `repo_sync.test.sh` and `runtime_contract.test.sh` specifically.

**Not verified.** **UNVERIFIED, and this one matters** — the nginx configs were never parsed.
`nginx -t` needs the installed config and root. The rate-limit fix is **inert until reloaded**:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Entry 006 — Documentation

**What changed.**

`DEPLOY.md` rewritten in full. The old text described a `release_manager/BOE_APP/` directory that
does not exist, a `--ship` DB-sync feature and six flags that do not exist, **inverted the
DB-restore default**, omitted all four workers, contradicted `nginx_ship.sh`'s install mapping, and
published a container port as the public one.

`CLAUDE.md` — rewrote the backend command block, the "Backend architecture" section, the
test-runner paragraph, the environment paragraph, the PhonePe-egress claim and the "CSS Modules"
claim. Verified absent from the tree first: `src/server.js`, `shared/`, `src/db/store.js`,
`scripts/migrate.js`, `scripts/start-dev.js`, and the `routes` / `db:check` / `migrate:status` /
`authz:*` scripts. Zero `*.module.css` files exist.

`WORKFLOW.md` — corrected the version-file path and the `authz:*` CI claim; noted that
`release_manager/tests/*.test.sh` and `verify.sh` are not in CI.

`PRODUCT.md` — added a scope block stating it specifies the out-of-repo marketing site.

**My own error, corrected before commit.** The first draft of `DEPLOY.md` claimed nginx restricts
`/metrics` to loopback. There is no `/metrics` location in any nginx config; the guard is
`isPrivateRequest` in `runtime/metrics.ts`.

**Verified.** **STATIC** — every figure checked against source: ports against both stack
`.env.example` files, flags against the three script `usage()` blocks, the worker set and heartbeat
thresholds against both compose files, the nginx mapping against `lib/nginx_ship.sh`, the key names
against `runtime/environment.ts`.

**Not verified.** **UNVERIFIED** — `DEPLOY.md` is now the operative runbook and should be read once
by someone who actually deploys, to catch anything derived wrongly from source alone.

---

## Entry 007 — Final sweep, and three leftovers it caught

**What changed.**

Removed two dangling `vi.fn()` stubs from `src/sipScheduleWorker.test.ts`
(`lockByIdUnscoped`, `findOpenInstallment`) for methods deleted in Entry 002 — invisible to `tsc`
because the mock is cast `as unknown as`. Removed `pushSystemChrome`, which was listed for removal
in Entry 004 and omitted from the script; removing it then exposed the dead push/subscribe
subsystem, which was collapsed as described in Entry 004.

**Why.** A symbol sweep over 60 removed names across every file type. It earned its place: a green
`tsc` had missed all three.

**Result.** Clean apart from three intentional hits — one negative deletion guard
(`onboarding-harness.test.mjs:50`) and two retirement notes inside config comments.

**Verified.** **TESTED** — the full gate set re-run afterwards. See `../09-verification-results.md`.

---

## Cumulative

```
77 files changed, 685 insertions(+), 1457 deletions(-)      net -772
```

| Area | Net |
| ---- | --- |
| `backend_controller` | −153 |
| `frontend_stack_ts` | −389 |
| `release_manager` | −114 |
| `test_e2e` | −117 |
| root docs / config | +1 |

Deleted: `.env.example`, `test_e2e/faq-debug.mjs`, `test_e2e/frontend-ts-shots.mjs`.

All gates green. Bundle size unchanged to the byte — the dead frontend exports were already
tree-shaken, so this bought clarity, not size.
