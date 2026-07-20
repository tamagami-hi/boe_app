# BE-020 Backend zero-JavaScript gate

Status: DONE — branch `ts-migration/backend` (PR #1). Final backend migration
batch. The backend controller now contains zero authored JavaScript, and a
permanent gate keeps it that way.

## Change

- `src/zero-legacy-js.guard.test.ts` — recursively scans `src/` and `scripts/`
  (excluding `dist/` and `node_modules/`) and asserts:
  1. no authored `.js` / `.jsx` / `.cjs` / `.mjs` files, and
  2. no lingering legacy `#`-subpath alias imports in any `.ts`/`.tsx` source.
  It runs under `npm run check` (the unit suite) and lists any offenders on
  failure. This is the permanent successor to the per-file
  `legacy-deletion.guard.test.ts` (which stays to keep the specific removed files
  from returning).

## Result — backend JS -> TS migration complete

Authored backend JavaScript over the migration:

| Checkpoint | Authored JS/JSX |
|---|---:|
| Start (BE-001 baseline) | 83 |
| BE-010 (auth) | 76 |
| BE-011 (health) | 74 |
| BE-012 (outbox worker, additive) | 74 |
| BE-013 (public content retired) | 72 |
| BE-014 (payment webhooks retired) | 67 |
| BE-015 (client domain retired) | 51 |
| BE-016 (admin identity, additive) | 51 |
| BE-017 (admin finance retired) | 39 |
| BE-018 (shared retired) | 13 |
| BE-019 (transport/persistence retired) | 0 |
| **BE-020 (gate)** | **0** |

`find backend_controller/src backend_controller/scripts -type f \( -name '*.js' -o
-name '*.jsx' \) | wc -l` -> **0**.

## Verification

- `npm run check` green (typecheck + lint + unit coverage incl. the new gate +
  build + source/dist smoke).
- `npm run test:integration` green (63/63).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact;
  `package.json`/`package-lock.json` unchanged.

## Notes and deferred items (carried forward, not blocking zero-JS)

The canonical TypeScript backend covers the spec-04 first slice end to end:
public application + email verification, admin review/approval/rejection +
activation invites, native/web authentication with refresh rotation, RBAC,
audit, idempotency, the SES/SNS outbox delivery worker + signed provider-event
ingress, and health/readiness. Deferred (documented in the respective logs):

- Production composition wiring in `server.ts` (route registration + env/PEM/
  cookie/origin/cursor-key composition) and concrete AWS SES/SNS adapters — the
  deferral tracked since BE-010/BE-011/BE-012/BE-016.
- Later-slice business domains intentionally out of the first slice: public
  content/catalog, payments/mandates/orders/ledger, client investing, and admin
  finance/content (retired here, to be re-introduced canonically with their
  schema in later slices — GATE-07/GATE-08).
- `BE-019A` (Fastify hardening / descriptor-to-handler + security-control
  inventory) remains as a review task; it is an audit, not a JS-deletion item.
