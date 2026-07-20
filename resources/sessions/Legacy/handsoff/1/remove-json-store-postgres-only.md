# Handoff — Remove the JSON store, make the backend Postgres-only

**Status:** inspect-only (no code changed this session). Execute next session.
**Goal:** Delete `backend_controller/data/dev-db.json` and the JSON database
functionality across the entire backend. Postgres becomes the single data store
for dev, test, and production (you already ship Postgres + Docker for prod).

> ⚠️ **This is NOT a simple delete.** The JSON store is wired into ~15 services
> as the *active* data path, and some services have **no working Postgres
> implementation yet** (they return `postgres_pending` empty placeholders).
> Deleting `jsonStore.js` first would (a) break imports everywhere and (b) leave
> those endpoints returning no data. Finish the Postgres side **before** removing
> the JSON side. Read the "Critical blocker" section before touching anything.

---

## How the store is selected today (as inspected)

- **`src/config/env.js` (~lines 44–79, 111):** maps `DB_DRIVER` / legacy
  `DATA_STORE` → `config.dbDriver` (`'json'` | `'pg'`). **Default is `'json'`.**
  Also sets `config.dataStore` (`'json'`|`'postgres'`) and
  `config.jsonDbPath` (default `./data/dev-db.json`).
- **`src/db/store.js`:** `getStore(config)` → `pgAdapter` if `dbDriver === 'pg'`,
  else `jsonStore`. Re-exports both `jsonStore` and `pgAdapter`.
- **`src/db/jsonStore.js` (458 lines):** file-backed store reading/writing
  `data/dev-db.json` (`DEFAULT_JSON_DB_PATH`). Exports the data surface used
  app-wide: `jsonStoreEnabled(config)`, `jsonStorePath(config)`, `readJsonStore`,
  `updateJsonStore`, `findRecord`, `atomicCompositeWrite`, `updateMandate`,
  `updatePayment`, etc.
- **`src/db/pgAdapter.js`:** mirrors the jsonStore surface and has **real SQL**
  (transaction, insert, `updateById*`, `readAll`, row⇄record mappers).
  `jsonStoreEnabled()` returns `false`; `jsonStorePath()` returns `null`
  (compat shims so callers that branch on the gate still work).

## Critical blocker — the `jsonStoreEnabled` coupling

Services do **not** go through `getStore()`. They import `jsonStoreEnabled`
(and `readJsonStore`/`updateJsonStore`/`findRecord`/…) **directly from
`#db/jsonStore.js`** and branch:

```js
if (!jsonStoreEnabled(config)) return emptyCollection({ source: 'postgres_pending' });
```

Two consequences:
1. Some services (e.g. `clientDataService.js`, ~7 call sites) **still return
   empty `postgres_pending` collections** on the Postgres path — i.e. the PG
   implementation is incomplete. The JSON store is the only path that returns
   real data there.
2. Every listed service imports symbols straight from `jsonStore.js`, so the
   file cannot be deleted until those imports are removed.

**First job next session:** audit every `jsonStoreEnabled` branch and classify
each as (a) real PG implementation present, or (b) `postgres_pending` stub that
must be implemented in `pgAdapter` first.

```bash
grep -rn "jsonStoreEnabled\|postgres_pending" backend_controller/src
```

## File inventory (scope)

**Core data layer**
- `src/db/jsonStore.js` — **delete** after all callers migrate.
- `src/db/store.js` — simplify: always return `pgAdapter` (or drop the
  indirection); stop re-exporting `jsonStore`.
- `src/db/pgAdapter.js` — **keep**; complete any missing ops; once no caller
  imports the gate, remove the `jsonStoreEnabled`/`jsonStorePath` compat shims.
- `src/config/env.js` — remove the `dbDriver='json'` default + `DATA_STORE`
  legacy mapping + `jsonDbPath`; make `pg` the only driver and **require
  `DATABASE_URL`** (lean on the existing `assertProductionConfig`).
- `data/dev-db.json` and `data/*.json` — remove. Drop the
  `data/*.json` rule in `backend_controller/.gitignore`.

**Services importing the JSON store** (migrate each to `pgAdapter` via
`getStore(config)`, delete the json branch). Authoritative list via
`grep -rn "#db/jsonStore.js" backend_controller/src`:
- `src/client/services/`: `supportService`, `clientDataService`, `sipService`,
  `sipControlService`, `transactionService`, `statementService`,
  `mandateService`, `portfolioService`, `withdrawalService`, `kycService`,
  `paymentService`, `orderService`
- `src/shared/services/`: `appConfigService`, `timelineService`, `receiptService`

**Scripts / tests**
- `scripts/smoke-test.js`, `scripts/t11-smoke-test.js` — JSON-store smokes
  (t11 copies `data/dev-db.json`). Rewrite against a migrated+seeded PG, or
  retire. **Also the cause of the current red CI** (see below).
- `scripts/seed-dev-data.js`, `scripts/seed-smoke-data.js` — write to the JSON
  store; port to PG or retire. `scripts/seed-auth.js` likely already PG-aware —
  verify.
- `.github/workflows/ci.yml` — remove `DATA_STORE: json` env from the
  `node --test` step.

**Docs**
- `CLAUDE.md` — update the `db/store.js` description ("JSON mode for
  local/tests"), the JSON-mode notes, and the seed/`db:check` command list.
- `resources/agent/` backend README (authoritative env/route reference).

## Related CI failure (fix folds into this work)

CI is currently red on every commit. The `backend (guards + tests)` job's
`node --test` step auto-discovers `scripts/*-test.js` (Node matches the
`-test.js` suffix), pulling in the two JSON-store smoke scripts:
- `scripts/t11-smoke-test.js` → `ENOENT` copying the gitignored
  `data/dev-db.json`.
- `scripts/smoke-test.js` → 16 assertions read `0` (empty store).

The intended CI tests are the 3 colocated unit tests under `src/`
(`authService.signup.test.js`, `fundClientView.test.js`, `taxConfig.test.js`),
which pass. **Quick interim fix** (independent of the larger migration): change
`ci.yml` `node --test` → `node --test src/` and drop `DATA_STORE: json`. The
full migration then removes/rewrites the smoke scripts properly.

## Recommended sequence

1. **Audit** every `jsonStoreEnabled` / `postgres_pending` branch; list services
   with no real PG path.
2. **Implement** the missing PG ops in `pgAdapter` and wire those services to
   `getStore(config)`.
3. **Remove** the json branches + `jsonStoreEnabled` gates from all 15 services.
4. **Simplify** `store.js` (PG only) and `env.js` (PG only; require
   `DATABASE_URL`; drop `jsonDbPath` / `DATA_STORE` / `dbDriver=json`).
5. **Delete** `jsonStore.js`, `data/dev-db.json`, `data/*.json`; drop the
   `.gitignore` rule.
6. **Seeds:** port `seed-dev-data` / `seed-smoke-data` to PG (or rely on
   `migrate` + `seed:auth` + a new PG seed).
7. **CI:** drop `DATA_STORE: json`; `node --test src/`; ensure no test needs the
   JSON store.
8. **Docs:** update `CLAUDE.md` + backend README.
9. **Verify** (below).

## Verification checklist

- `DATA_STORE`/`DB_DRIVER` unset → backend boots on Postgres (fails fast if
  `DATABASE_URL` missing).
- Every client service returns **real** data from PG; no `postgres_pending`
  source anywhere: `grep -rn "postgres_pending" backend_controller/src` → empty.
- `grep -rn "jsonStore" backend_controller/src backend_controller/scripts` →
  empty.
- Backend `authz:*` guards still pass.
- `node --test src/` green; CI green.
- A Dockerized Postgres round-trip (compose up → migrate → seed → smoke) works.

## Risks / watch-outs

- JSON-only helpers (`atomicCompositeWrite`, idempotency helpers, `updateMandate`
  / `updatePayment`, composite writes) must have PG equivalents. `pgAdapter` has
  `updateByIdWithUpdater` for payments/mandates/sipControlRequests and generic
  insert/readAll — **verify full coverage** before deleting jsonStore.
- The idempotency layer (`src/http/idempotency.js`, `idempotency:smoke`) may
  read/write the store — confirm it's PG-backed.
- Don't regress the `authz:*` static guards; they scan source, not runtime.
- `JSON mode is for local/tests` is stated in CLAUDE.md as intentional — confirm
  with the team that dev should now also be Postgres-only (the stated intent
  here) before removing the dev convenience path.

## Pointers

- Store resolver: `backend_controller/src/db/store.js`
- JSON impl: `backend_controller/src/db/jsonStore.js`
- PG impl: `backend_controller/src/db/pgAdapter.js`
- Config: `backend_controller/src/config/env.js` (~44–79, 111)
- CI: `.github/workflows/ci.yml`
- Seeds/smokes: `backend_controller/scripts/`
