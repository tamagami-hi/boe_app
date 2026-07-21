# Removed: JavaScript DB Operational Scripts

- Removed in: `BE-005`, on branch `ts-migration/backend` (PR #1).
- Deleted: `backend_controller/scripts/migrate.js` (~150),
  `backend_controller/scripts/check-db.js` (~15),
  `backend_controller/scripts/seed-auth.js` (dead legacy-schema seed).
- Replacement: `src/scripts/migrate.ts` (ordered, checksummed, per-migration
  transactional, idempotent apply tracked in `schema_migrations`; `status|up`
  CLI over the typed BE-004 `pg` pool — no `psql` dependency) and
  `src/scripts/check-db.ts` (connectivity check). Emitted to `dist/scripts`;
  `migrate`/`migrate:dev`/`check:db` package scripts added.
- Intentional behavior change: migrations apply through the owned pool instead of
  the `psql` subprocess; ordering/checksum/transaction/idempotency behavior is
  preserved. The typed bootstrap seed (needs the canonical identity tables) is
  authored in BE-007; `seed-auth.js` (which seeded the dead legacy schema via
  removed `#config`/`#db` aliases) is deleted now as superseded dead code.
- Data impact: none (no schema applied outside ephemeral test containers).
- Rollback: revert the BE-005 commit; the scripts return as dead backlog.
