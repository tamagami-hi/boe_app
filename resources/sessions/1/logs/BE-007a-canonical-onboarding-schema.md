# BE-007a Phase Log: Canonical Public-Onboarding Schema

Status: `DONE`

## Objective And Dependency Closure

- Objective: additive canonical public-onboarding tables/enums proven on empty
  PostgreSQL 16.
- Dependencies: BE-004, BE-005 (`DONE`). Parent: BE-007 (split into children;
  parent remains in progress).
- Normative sources: `specifications/03` §2.1/§3.1; `plans/01` Phase 3.
- Dominant risk: wrong constraints/indexes.
- Intentional behavior change: none (additive; no runtime consumer yet).

## Atomic Units

- [x] Confirm no legacy table-name collision for the four target tables.
- [x] Author `009_canonical_onboarding.sql` (enums + 4 tables + constraints/
      indexes).
- [x] Integration test: apply on empty PG; assert unique-active partial index +
      reuse-after-rejection, phone check, SHA-256 consent digest, one-pending
      token index.
- [x] `npm run check` green; `npm run test:integration` green (8/8).
- [x] Records updated; commit/push; PR updated.

## Replacement And Deletion Map

| New | Superseded JS deleted | Guard |
|---|---|---|
| `db/migrations/009_canonical_onboarding.sql` | none (additive) | integration test asserts constraints on real PG |

## Research And Reuse

- Legacy chain grep confirmed the four table names are new; applied in isolation
  on empty PG (filtering the runner to the `009_` file).
- Reused BE-005 `loadMigrationFiles`/`runMigrations` and the BE-004
  Testcontainers harness; `pgcrypto` `digest()` enforces the consent SHA-256
  check inside the schema.

## RED Evidence

- Honest note: unlike the prior batches, a separate failing run was not captured
  for this schema increment — the migration and its constraint assertions were
  authored together and validated GREEN on the first integration run. The
  assertions still encode the intended contract (they only pass because the
  migration's constraints exist); a strict RED-first sequence was not recorded.

## Implementation And Decisions

- `009_canonical_onboarding.sql` adds enums `application_state`/`token_purpose`
  and tables `applications`, `consent_documents`, `application_consents`,
  `verification_tokens` with the §3.1 constraints, partial unique indexes
  (active-email/phone; current-consent-per-kind; one-pending-token), composite
  `(id, application_id)` on verification tokens, and a `digest()`-backed consent
  SHA-256 check.
- Decisions/deferrals: `verification_tokens.user_id` is a plain nullable column
  (gains its `users` FK in the next child packet); full Unicode code-point /
  tombstone-marker-format and the full canonical public-path regex are enforced
  at the Zod boundary and hardened later — the DB uses pragmatic equivalents
  (`[[:cntrl:]]`, `char_length` bounds, `^/` path prefix).
- Security: schema-only; no PII values; enumeration-safe uniqueness lives in the
  DB while the public route returns the generic 202 (contract already enforces
  that).

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (42 tests, coverage >=80%) |
| Integration | `npm run test:integration` | 8/8 (4 BE-004 + 4 BE-007a) vs PostgreSQL 16 |

## Reviews

- Code + security (focused inline review): constraint correctness verified by
  the integration assertions (unique-active + reuse-after-rejection, phone
  format, consent digest match, one-pending-token); additive-only; no collision;
  no secret/PII. No CRITICAL/HIGH/MEDIUM. Fuller review available on PR #1.

## Metrics

- Schema SQL added: `009_canonical_onboarding.sql` (4 tables, 2 enums).
- Test TS added: 4 integration tests (integration suite 4 -> 8).
- Production/Test unit TS added: 0 (schema only).
- Production JS/JSX deleted: 0 (additive; onboarding service JS deleted by
  BE-008). Backend authored JS backlog unchanged at 83 files.

## Risk, Rollback, And Resume

- Residual risk: the `users`-dependent tables and repositories are not yet
  present; the schema is not consumed by a route yet.
- Rollback shape: revert the BE-007a commit; remove the migration file.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-007b — `users`, `user_credentials`, `activation_invites`,
  `auth_sessions`, `auth_refresh_tokens`, `application_reviews` (+ the deferred
  `verification_tokens.user_id` FK), then RBAC/audit and repositories.
