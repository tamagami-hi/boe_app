# BE-007g: Typed Idempotent Bootstrap Seed (child of BE-007)

- Status: `DONE`
- Owner surface: `backend_controller/src/db/**`, `src/scripts/**`, `package.json`,
  `test/integration/**`.
- Dependencies: BE-007a-f (`DONE`), BE-004/BE-005.
- Objective: add the always-run idempotent bootstrap seed that upserts the
  canonical role catalog, permission catalog, and current consent documents,
  runnable via typed tooling over the owned pool.
- Normative sources: `specifications/02` §3.5 (bootstrap), `03` §3.3 (seed
  `superadmin`/`onboarding`/`finance`/`content`/`support`), `04` role/permission
  catalog.
- Dominant risk: a non-idempotent seed, or a permission code that violates the
  `domain.action` CHECK. Mitigation: every statement is `ON CONFLICT DO NOTHING`
  and the catalog is unit-validated (single-dot codes, snake_case roles, every
  role permission present in the catalog); an integration test runs the seed
  twice and asserts stable counts.
- Production replacement closure: `src/db/seedCatalog.ts` (pure catalog +
  `buildSeedStatements()`), `src/scripts/seed.ts` (thin transactional runner +
  CLI), `package.json` `seed`/`seed:dev` scripts.
- Scope boundary / deferrals: `role_permissions`/`user_roles` grants and the
  optional admin user + Argon2id credential + redacted audit event are part of
  the security bootstrap transaction (`role_permissions.granted_by_user_id` is
  NOT NULL and needs a granting user) and land with BE-009/BE-016. This packet
  seeds only the catalog rows that carry no user FK.
- Exact JS/JSX deletion target: none (BE-005 already deleted `seed-auth.js`).
- Capability eval: on a migrated DB, `runSeed` inserts 5 roles + the full
  permission catalog + current terms/privacy consent documents (with a
  TS-computed SHA-256 matching the pgcrypto digest CHECK); a second run inserts
  nothing and leaves counts unchanged.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`.
- Required reviews: general + security (no secret/admin credential compiled into
  source; catalog only).
- Rollback shape: revert the BE-007g commit; remove the seed module/script.
- Done condition: integration green; records updated; commit pushed; PR updated;
  Legacy hash `d5fd7425...`. Closes BE-007.
- Phase log: [BE-007g log](../logs/BE-007g-bootstrap-seed.md)
