# BE-009b Phase Log: Breached-Password Check

Status: `DONE`

## Objective And Dependency Closure

- Objective: HIBP k-anonymity breached-password checker for activation/password
  change.
- Dependencies: BE-009a.
- Normative sources: `specifications/04` §4.1.
- Dominant risk: leaking the password/hash, or failing open.
- Intentional behavior change: none (additive; a check the legacy code lacked).

## Atomic Units

- [x] `src/auth/breachCheck.ts` (HIBP checker + bypass + mode resolution).
- [x] Unit tests with injected fetch (breached / padding / cache / non-2xx /
      reject / bypass / mode resolution).
- [x] `npm run check` + `npm run test:integration` (24/24) green.
- [x] Records updated; commit/push.

## Replacement And Deletion Map

| New | Superseded | Guard |
|---|---|---|
| `src/auth/breachCheck.ts` | none (new capability) | offline unit tests via injected fetch |

## RED Evidence

- Honest note: authored with tests together and validated GREEN. Real lint REDs
  were fixed (unused fake-fetch params + a redundant cast) by typing the fake
  `impl` directly as `typeof fetch`. Tests are fully offline (no network), so the
  fail-closed and cache behaviors are deterministic.

## Implementation And Decisions

- `createHibpBreachChecker`: SHA-1 of the password, uppercase; sends only the
  first five hex chars to the range endpoint with `Add-Padding: true` and a 2s
  `AbortController` timeout; compares the 35-char suffix in constant time
  (`timingSafeEqual`), treating a match with count > 0 as breached
  (VALIDATION_FAILED); caches the range body per prefix for 24h in a bounded map;
  any non-2xx / rejection / abort throws DEPENDENCY_UNAVAILABLE (fail closed). The
  password, full SHA-1, suffix, and matching line are never logged or persisted.
- `resolveBreachCheckMode` permits `bypass` only under NODE_ENV test/development
  and rejects it otherwise; `createBreachChecker` selects bypass vs HIBP.
- `fetch` is injectable so unit tests run offline and deterministically.
- Deferrals: ES256 (BE-009c); refresh rotation (BE-009d); activation wiring
  (BE-010). Login never calls HIBP (spec).

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Unit check | `npm run check` | green (offline) |
| Integration | `npm run test:integration` | 24/24 (unchanged; breach check has no DB use) |

## Reviews

- Code + security (focused inline review): only the 5-char prefix leaves the
  process; padded responses requested; constant-time suffix comparison;
  fail-closed on any error; bypass gated to non-production; nothing sensitive
  logged. No CRITICAL/HIGH/MEDIUM.

## Metrics

- Source TS added: `src/auth/breachCheck.ts`. Test: `breachCheck.test.ts`.
- Production JS/JSX deleted: 0 (additive). Backend authored JS backlog unchanged
  at 81 files.

## Risk, Rollback, And Resume

- Residual risk: not yet wired into a command until BE-010 activation.
- Rollback shape: revert the BE-009b commit.
- Commit/push: conventional commit on `ts-migration/backend`; PR #1 updated.
- Exact next action: BE-009c ES256 access-token service (jose; kid selection,
  pinned iss/aud/typ/skew claims), then BE-009d refresh/CSRF rotation and the
  deletion of `security/{auth,tokens}.js`.
