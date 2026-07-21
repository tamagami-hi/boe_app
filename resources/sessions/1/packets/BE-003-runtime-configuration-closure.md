# BE-003: Runtime Configuration Closure

- Status: `DONE`
- Owner surface: `backend_controller/**` (delete legacy config/logger JS; guard).
- Dependencies: CON-006 (`DONE`), BE-002 (`DONE`).
- Objective: make the typed runtime configuration and observability boundary the
  sole authority and delete the superseded legacy JavaScript config/logger files.
- Normative sources: `TASKS.md` (BE-003 row); `specifications/05` §3.1-§3.3
  (typed config/observability, `allowJs:false`, no legacy aliases);
  `specifications/04` §4.2 (secret/keyring startup validation — owned by the
  later security/DB batches, not built speculatively here);
  `decisions/RISKS_AND_DECISIONS.md` (direct replacement + no mixed runtime).
- Dominant risk: deleting a config/logger file still required by the
  authoritative runtime. Mitigation: verified none of `src/**/*.ts` imports the
  legacy files, and the legacy `#config`/`#shared` alias graph was already
  removed in BE-001 (the importers are dead, uncompiled backlog).
- Production replacement closure: the typed boundary already exists from BE-001
  (`src/runtime/environment.ts` = Zod-parsed `HOST`/`PORT`/`LOG_LEVEL`/`NODE_ENV`;
  `src/runtime/logger.ts` = Pino with redaction; Node `--env-file-if-exists`
  replaces the hand-rolled dotenv loader). BE-003 retires the legacy files and
  guards their absence. Broader typed env/secret/release config (DB, CORS,
  keyrings) is authored by its owning batches (BE-004, BE-006, BE-009) when those
  surfaces exist, per the "no speculative adjacent work" selection rule.
- Exact JS/JSX deletion target: `src/config/env.js`, `src/config/dotenv.js`,
  `src/shared/logger.js` (3 files, ~208 lines). Backend backlog 89 -> 86 files.
- Capability eval: after deletion the authoritative `npm run check` stays green
  (typecheck, lint, coverage, build, source+dist smoke), and a runtime-boundary
  guard asserts the three legacy files are absent and no `src/**/*.ts` imports a
  legacy `#config`/`#shared`/relative config-logger path.
- Regression evals: `/health/live` unchanged; graceful shutdown (BE-002) intact;
  runtime env parsing/logging behavior unchanged.
- Coverage/build/integration/E2E/image gates: package `npm run check`
  (>=80% coverage). No PostgreSQL/provider/image behavior in scope.
- Required reviews: general/TypeScript review (deletion safety, no authoritative
  import of removed files) and security review (no lost, still-needed control;
  redaction preserved).
- ESLint MJS classification: `backend_controller/eslint.config.mjs` is retained
  as a classified non-production tooling exception (flat config is ESM), matching
  the CON-006 decision for the contracts config. Recorded in the inventory.
- Rollback shape: revert the BE-003 commit; the legacy files return as dead
  backlog. No schema/provider/Legacy change.
- Done condition: gates/reviews resolved; 3 files deleted; guard added; records
  and inventory updated; commit pushed to `ts-migration/backend`; PR updated;
  Legacy hash still `d5fd7425...`.
- Phase log: [BE-003 log](../logs/BE-003-runtime-configuration-closure.md)
