# 09 — Verification results

Verification vocabulary per [01](01-method-and-classification.md) §4: **TESTED** means a command
was run here and passed.

## 1. Gates run — all green

### `backend_controller` — `npm run check`, exit 0

| Step | Result |
| ---- | ------ |
| `typecheck` (`tsc -p tsconfig.json`) | clean |
| `lint` (`eslint .`) | clean |
| `test:coverage` (Vitest) | **804 tests, 79 files, 0 failures** |
| `build` (`tsc -p tsconfig.build.json`) | clean |
| `smoke:source` | pass |
| `smoke:dist` | pass |

804 up from 794 at the start of this work: five new tests, five updated.

### `frontend_stack_ts`

| Step | Result |
| ---- | ------ |
| `typecheck` | clean |
| `lint` | clean |
| `vitest run` | **199 tests, 21 files, 0 failures** |
| `build` | app chunk **216.05 kB** (gzip 61.18), CSS **85.45 kB** (gzip 14.73) |
| `check-bundle-boots` | 7 chunks evaluated, no error |
| `check-phonepe-native-target` | pass — no native PhonePe SDK in either variant; both plugin allowlists pinned |
| `check-android-dist` | ran as part of `build:client`/`build:android` |

**One gate reports a difference by design.** `generate:api:check` runs the generator then
`git diff --exit-code -- src/api/generated`, so an *uncommitted* regeneration always fails it. Two
things were verified instead:

- the generator is **idempotent** — a second run produced a byte-identical file;
- the diff against `HEAD` is **108 deletions and zero additions**, exactly the registry removal
  described in [04](04-frontend-dead-code.md) §4.

The gate passes once the change is committed. This is a property of comparing against git, not a
defect.

### `packages/contracts` — `npm run check`, exit 0

- OpenAPI regenerated and validated by Redocly: "Your API description is valid."
- Package export identity check passes.
- `check-frontend-contract-bypass`: **"No contract bypasses. 101 contracted operations, all
  reachable through the generated client."**

### `release_manager`

| Gate | Result |
| ---- | ------ |
| `tests/*.test.sh` | **15 / 15 pass** |
| `verify.sh` | **108 passed, 0 failed, 1 skipped** (the skip is the remote block; needs `--remote`) |

The 15 suites include `runtime_contract.test.sh`, which was modified in this change set
([07](07-tooling-deployment-docs.md) §2), and `repo_sync.test.sh`, which covers the file a function
was removed from.

### Root

`npm run test:onboarding:harness` — **7 pass, 0 fail.**

## 2. Dangling-reference sweep

A script checked **60 removed symbols** — every removed export, repository method, type, interface,
configuration key and shell function — across `.ts`, `.tsx`, `.mjs`, `.js`, `.sh`, `.yml`, `.yaml`,
`.json`, `.conf`, `.css`, `.example` and `.xml`, over `backend_controller`, `frontend_stack_ts`,
`packages/contracts`, `release_manager`, `test_e2e`, `tools`, `emu` and `.github`.

**Result: clean, apart from three intentional hits.**

| Hit | Verdict |
| --- | ------- |
| `test_e2e/onboarding-harness.test.mjs:50` — `assert.doesNotMatch(source, /createLogEmailSender/u)` | A **negative** deletion guard. Keep |
| `stacks/dev_release/.env.example:191-192` — `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | Text inside a retirement note explaining the absence. Keep |
| `docker-compose.dev_app.yml:92-93` — the same plus `ALLOW_DEV_AUTH` | Same. Keep |

### The sweep found three real leftovers the type-checker could not

Worth recording, because it justifies running a symbol sweep even after a green `tsc`:

1. **`sipScheduleWorker.test.ts` — `lockByIdUnscoped: vi.fn()`.** A stub for a removed repository
   method. Invisible to `tsc` because the mock object is cast `as unknown as`.
2. **`sipScheduleWorker.test.ts` — `findOpenInstallment: vi.fn()`.** Same.
3. **`platform/systemChrome.ts` — `pushSystemChrome`.** It was in my verification list and I omitted
   it from the removal script, so it was never actually cut. Removing it then exposed the dead
   push/subscribe subsystem described in [04](04-frontend-dead-code.md) §3 — a genuine finding that
   would have been missed entirely.

All three fixed, and the full gate set re-run afterwards.

## 3. Measured reduction

`git diff --shortstat` over tracked files:

```
77 files changed, 685 insertions(+), 1457 deletions(-)
```

**Net −772 lines.**

| Area | Added | Removed | Net |
| ---- | ----- | ------- | --- |
| `backend_controller` | 444 | 597 | **−153** |
| `frontend_stack_ts` | 32 | 421 | **−389** |
| `release_manager` | 14 | 128 | **−114** |
| `test_e2e` | 0 | 117 | **−117** |
| root docs / config | 195 | 194 | **+1** |
| `packages` | 0 | 0 | 0 |

The backend's insertions are mostly the three lifecycle fixes and five new tests, so its net figure
understates how much dead code went: `src/db/repositories.ts` alone fell from **507 lines to 77**.

Files deleted: `.env.example`, `test_e2e/faq-debug.mjs`, `test_e2e/frontend-ts-shots.mjs`.

Other measurable reductions:

- `src/api/generated/operations.ts`: 315 → 207 lines
- one npm dependency removed (`@capacitor/local-notifications`), lock file regenerated
- one Android runtime permission removed (`POST_NOTIFICATIONS`)
- 13 CSS custom properties removed
- 12 configuration settings removed across 4 example files and 2 compose files

Bundle size is unchanged to the byte (216.05 kB app chunk before and after). The dead frontend
exports were tree-shaken already; removing them buys clarity, not size. Stating that plainly
matters more than implying a win that did not happen.

## 4. What was NOT verified

Read this before trusting anything above as evidence about the running system. Per the workspace
rules, a green test run is not proof of wiring.

### Requires the VPS

- **The nginx configs were never parsed.** `nginx -t` was not run — it needs the full installed
  config and root. The `boe_auth` regex fix is **inert until reloaded**, and two login endpoints
  stay at 20 r/s until then. → `sudo nginx -t && sudo systemctl reload nginx`
- **`verify.sh --remote` was not run.** 1 of 109 assertion blocks is skipped.
- **No database was touched.** Every persistence claim in [06](06-persistence-audit.md) and every
  wedged-row question in [02](02-lifecycle-and-state-machines.md) §6 is a source-level inference.
  The SQL to settle them is in those documents.
- **The compose changes have not been deployed.** Removing the unwired `x-worker-health` anchor and
  the dead `DATABASE_*` block takes effect on the next deploy. Neither changes behaviour, since
  neither was consumed.

### Requires a device or emulator

- **Neither APK was rebuilt.** Removing `@capacitor/local-notifications` and `POST_NOTIFICATIONS`
  changes APK contents. `capacitor.plugins.json` is untracked and regenerated by `cap sync`, so it
  converges on the next build — but that build has not happened.
  → `npm run android:sync` and `npm run android:sync:admin`, then install both variants.
- **`SystemBarsController`'s simplification was not observed on device.** The change is
  behaviour-preserving by construction — `applySystemChrome(DEFAULT_CHROME)` on mount and on
  resume, as before — and D-040 notes this path had never been observed running even before this
  change.

### Requires a container runtime

- **`npm run test:integration` was not run.** It needs testcontainers. So no pagination predicate,
  session channel or cache invalidation in this change set has met PostgreSQL. In particular, the
  new `lockDueRefunds` `checkedBefore` predicate is asserted only against a stubbed repository —
  its **SQL** is unverified.

### Not attempted at all

- No worker was started. No `npm run dev`. No browser opened. Nothing deployed.
- `test_e2e/frontend-ts-audit.mjs` and the other runtime crawls were not run — they need a live
  local stack. That matters specifically for D-062: the link-map corrections in
  [04](04-frontend-dead-code.md) §8 were made by **manual inspection**, and rendered-link
  reachability remains unmeasured.
- No full column-by-column read/write matrix across all 50 tables.
- `outboxRepository.ts` was not read in full, so the `OutboxState` `processing`/`dead_lettered`
  question is open — the highest-value remaining check in
  [08](08-retained-and-uncertain.md) §3.

## 5. Regression risk, by area

| Area | Risk | Why |
| ---- | ---- | ---- |
| Backend dead-code removal | **Very low** | Type-checked, 804 tests, both smoke gates, and a symbol sweep. Nothing removed had a caller |
| Frontend dead-code removal | **Very low** | Same, plus an idempotent generator and an unchanged bundle |
| Collection expiry (F-001) | **Low–medium** | New writes on a payment path. Covered by two new tests, and it reuses the same primitives the mandate worker already uses. But it has never run against PostgreSQL or a real provider |
| Refund poll bound (F-002) | **Low–medium** | Changes which rows a claim query returns. The SQL predicate is unverified against PostgreSQL |
| Mandate summary + config (F-003) | **Low** | Type-enforced. One deliberate behaviour change: setup not-found grace 60 s → configured 300 s, which is strictly more conservative |
| Configuration removal | **Low** | Every key proven unread in both directions, and a new guard prevents regression |
| nginx regex | **Low, but unverified** | A syntax error would take the site down on reload. `nginx -t` **must** run first |
| Compose changes | **Very low** | Both removals were provably unconsumed |
| Documentation | **None to runtime** | But `DEPLOY.md` is now the operative runbook and should be read once by someone who deploys, to catch anything I got wrong from source alone |

## 6. Commands to reproduce this verification

```bash
# backend
cd backend_controller && npm run check

# frontend (generate:api:check reports a diff until the change is committed)
cd frontend_stack_ts && npm run typecheck && npm run lint && npx vitest run \
  && npm run build && node scripts/check-phonepe-native-target.mjs

# contracts
cd packages/contracts && npm run check

# release tooling
cd release_manager && for t in tests/*.test.sh; do bash "$t" || echo "FAIL $t"; done
cd release_manager && bash verify.sh

# root
npm run test:onboarding:harness
```
