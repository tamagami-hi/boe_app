# BE-007f Phase Log: Kysely Schema Types + Repository Interfaces

Status: `DONE`

## Objective And Dependency Closure

- Objective: full canonical Kysely `Database` schema types + the §7 repository
  interface contract, proven against live PostgreSQL 16 with a typed round-trip.
- Dependencies: BE-007a-e (`DONE`). Parent BE-007 stays in progress.
- Normative sources: `specifications/03` §7; migrations `009`-`013`.
- Dominant risk: schema-type drift from the DDL.
- Intentional behavior change: none (type foundation).

## Atomic Units

- [x] Author full `src/db/types.ts` `Database` (23 tables, exact column mapping).
- [x] Author `src/db/repositories.ts` (§7 shared types + repository interfaces).
- [x] Add `src/db/limits.ts` (+ unit test) for the §7 numeric ceilings.
- [x] Extend the integration test: typed Kysely round-trip (defaulted enum,
      bigint-as-string, jsonb, timestamp columns).
- [x] `npm run check` green; `npm run test:integration` green (14/14).
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded | Guard |
|---|---|---|
| `src/db/types.ts` full `Database` | the empty `Record<string, never>` placeholder | typecheck + typed round-trip on real PG |
| `src/db/repositories.ts` (§7 contract) | none | typecheck resolves `Row<T>` for every table |
| `src/db/limits.ts` (+ test) | none | unit test pins values |

## Research And Reuse

- Reused BE-005 runner + BE-004 harness. Column shapes read directly from
  migrations `009`-`013`. Kysely `Generated`/`ColumnType`/`JSONColumnType` used
  for defaulted, bytea, bigint, and jsonb columns.

## RED Evidence

- Honest note: no separate failing run was captured; the schema types and the
  round-trip test were authored together and validated GREEN on the first run.
  The typed round-trip is the guard against silent type drift (a wrong
  nullability/default/bigint/jsonb mapping fails at compile or against real PG).

## Implementation And Decisions

- `src/db/types.ts` now defines all 23 first-slice tables and the `Database` map:
  `applications`, `consent_documents`, `application_consents`,
  `verification_tokens`, `users`, `user_credentials`, `application_reviews`,
  `activation_invites`, `auth_sessions`, `auth_refresh_tokens`, `roles`,
  `permissions`, `role_permissions`, `user_roles`, `approval_actions`,
  `audit_events`, `idempotency_records`, `rate_limit_windows`, `legal_holds`,
  `outbox_events`, `email_deliveries`, `email_provider_events`,
  `email_suppressions`. Conventions: timestamps select as `Date` / write
  `Date | string`; `bytea` selects as `Buffer` / writes `Buffer | Uint8Array`;
  `bigint` selects as `string` (node-postgres) / writes `string | number |
  bigint`; `jsonb` selects as an object / writes a serialized string; DB-defaulted
  columns are `Generated<T>` so they are optional on insert; closed enums are
  string-literal unions.
- `src/db/repositories.ts` transcribes spec §7 as a type-only contract:
  `ReadonlyDeep`, `Row<T>`, the branded ids (`ApplicationId`/`UserId`/...), the
  cursor/query/command input types, and all 24 repository interfaces
  (`ApplicationRepository` ... `EmailSuppressionRepository`) with the caller-owned
  `Transaction` handle. No runtime code.
- Decisions/deferrals: repository *implementations* land with their consuming
  command/route batches (BE-008+), where they get behavioral integration tests
  (matches the spec note that later slices add focused repositories). Numeric
  ceilings live in `src/db/limits.ts` (covered by a unit test) so the type-only
  contract file stays 0-statement and does not affect the coverage gate. The
  later-domain repositories (Kyc/Fund/Order/Payment/Mandate/Redemption/...) land
  with §4 schema in BE-016+. Bootstrap seed -> BE-007g.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (typecheck + lint + coverage 87.88% + build + smoke); 43 unit tests |
| Integration | `npm run test:integration` | 14/14 vs PostgreSQL 16 (typed round-trip on `applications`, `roles`, `outbox_events`) |

## Reviews

- Code + security (focused inline review): the typed round-trip confirms
  defaulted-enum, bigint-as-string, jsonb-object, and timestamptz-as-Date
  mappings against the real DDL; secret material (`bytea` hashes/ciphertext,
  `jsonb` payloads) is typed as opaque `Buffer`/object and never as a
  human-readable/loggable shape; branded ids keep ApplicationId/UserId from being
  used interchangeably at the boundary. Type-only + one covered constants module;
  no CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `src/db/types.ts` (expanded), `src/db/repositories.ts`,
  `src/db/limits.ts`.
- Test TS added: `src/db/limits.test.ts` (unit) + 1 integration round-trip
  (integration suite 13 -> 14; unit suite 42 -> 43).
- Production JS/JSX deleted: 0 (type foundation). Backend authored JS backlog
  unchanged at 83 files.

## Risk, Rollback, And Resume

- Residual risk: repository implementations do not yet exist, so the interfaces
  are unproven behaviorally until BE-008+ consumes them.
- Rollback shape: revert the BE-007f commit; restore the empty `Database` map.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-007g — typed bootstrap seed (roles/permissions + current
  consent documents) as an idempotent migration/seed, then BE-008 public
  onboarding Fastify routes (first identity/onboarding JS deletions).
