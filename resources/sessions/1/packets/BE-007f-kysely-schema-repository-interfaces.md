# BE-007f: Kysely Schema Types + Repository Interfaces (child of BE-007)

- Status: `DONE`
- Owner surface: `backend_controller/src/db/**`, `test/integration/**`.
- Dependencies: BE-007a-e (`DONE`), BE-004/BE-005.
- Objective: replace the intentionally-empty `Database` table map with the full
  canonical Kysely schema types (all 23 first-slice tables), and add the
  project-defined repository interface contract from spec `03` §7. Prove the
  schema types match the live DDL with a typed Kysely round-trip on real
  PostgreSQL 16.
- Normative sources: `specifications/03` §7 (repository interfaces + shared
  types), migrations `009`-`013` (column shapes).
- Dominant risk: schema types drifting from the DDL (wrong nullability /
  default / bytea / jsonb / bigint mapping). Mitigation: a typed round-trip
  integration test inserts and selects through the typed Kysely API so a mismatch
  fails at compile or at runtime against real Postgres.
- Production replacement closure: `src/db/types.ts` (full `Database`),
  `src/db/repositories.ts` (§7 contract). Type-only; no runtime behavior.
- Scope boundary / deferrals: repository *implementations* land with the
  consuming command/route batches (BE-008+) where they get behavioral
  integration tests; bootstrap seed -> BE-007g. Later-domain repositories
  (Kyc/Fund/Order/Payment/...) land with their schema in BE-016+.
- Exact JS/JSX deletion target: none (additive type foundation).
- Capability eval: typed `insertInto(...).returningAll()` round-trips on
  representative tables (`applications`, `roles`, `outbox_events` incl. jsonb,
  bigint, defaulted-enum columns) return correctly-typed rows on PG 16; whole
  contract typechecks (`Row<T>`/`Selectable<Database[T]>` resolve for every §7
  table).
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`.
- Required reviews: general + security (no secret material typed as loggable;
  bytea/jsonb columns typed as opaque).
- Rollback shape: revert the BE-007f commit; restore the empty `Database` map.
- Done condition: integration green; records updated; commit pushed; PR updated;
  Legacy hash `d5fd7425...`.
- Phase log: [BE-007f log](../logs/BE-007f-kysely-schema-repository-interfaces.md)
