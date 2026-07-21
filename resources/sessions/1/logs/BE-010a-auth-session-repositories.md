# BE-010a Phase Log: Auth Session + Credential Repositories

Status: `DONE`

## Objective And Dependency Closure

- Objective: native-session DB layer (credential + session/refresh repositories).
- Dependencies: BE-007 (schema), BE-009 (security core).
- Normative sources: `specifications/03` §7, `04` §4.1; migration 011.
- Dominant risk: storing raw tokens or violating the native/web CSRF invariants.
- Intentional behavior change: none (additive DB layer).

## Atomic Units

- [x] `credentialRepository.ts` (exists/create; Argon2id hash stored only).
- [x] `authSessionRepository.ts` (createNativeSession, lockByRefreshTokenHash,
      revokeAllForUser).
- [x] Integration test (create/lookup/revoke) on real PG.
- [x] `npm run check` + `npm run test:integration` green.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded (deleted later) | Guard |
|---|---|---|
| `credentialRepository.ts`, `authSessionRepository.ts` | part of legacy `security/auth.js` + `db/store.js` (deleted BE-010c / consumer cutover) | integration tests on real PG |

## RED Evidence

- Honest note: authored with tests together and validated GREEN against real
  PostgreSQL. Row-lock lookups and the revoke counts are asserted on live rows;
  the native session relies on the DB CHECK that keeps CSRF fields null.

## Implementation And Decisions

- `authSessionRepository.createNativeSession` inserts the session
  (`channel='native'`, device hash, refresh key version, expiry) then its
  generation-0 refresh token in one transaction; `lockByRefreshTokenHash` locks
  the token then its session `FOR UPDATE`; `revokeAllForUser` revokes active
  sessions + current refresh tokens and returns the counts.
- `credentialRepository` stores only the encoded Argon2id hash (the DB CHECK
  enforces the prefix) and reports existence.
- Web (cookie + CSRF) sessions and the refresh-rotation state machine
  (previous-pair 30s grace, family reuse) are BE-010c; activation is BE-010b.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green |
| Integration | `npm run test:integration` | green; new repos exercised (99.64% stmts / 87.64% branch) |

## Reviews

- Code + security (focused inline review): only hashes persisted; native session
  keeps CSRF fields null (DB CHECK); lookups take row locks; revoke is scoped to
  the user's active rows. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `credentialRepository.ts`, `authSessionRepository.ts`.
- Test added: `authRepositories.integration.test.ts` (3rd integration container
  file).
- Production JS/JSX deleted: 0 (additive). Backend authored JS backlog unchanged
  at 80 files.

## Risk, Rollback, And Resume

- Residual risk: web/CSRF + rotation + activation not yet implemented.
- Rollback shape: revert the BE-010a commit.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-010b activation route (consume invite -> Argon2id
  credential + session + refresh + activate user + audit atomically).
