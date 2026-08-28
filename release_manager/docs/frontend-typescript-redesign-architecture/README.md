# BOE Frontend TypeScript Redesign — Architecture Documentation

Investigation completed 2026-08-27 against working-tree state `089dd27` + 34 uncommitted
changes. Every conclusion below is traceable to a file path, function name, migration,
route constant, or CSS line. Static analysis only — nothing was executed on this machine
beyond `tsc --noEmit`, so anything requiring a running system is marked
`NEEDS RUNTIME VERIFICATION`.

## Purpose

Implementation-ready blueprint for `frontend_stack_ts`, a greenfield TypeScript frontend
for the BOE application, replacing the legacy JS/JSX `frontend_stack`.

## Hard boundaries

1. `frontend_stack/` is the legacy/current frontend. It must remain untouched and
   operational for the whole rebuild. Do not refactor it, migrate files out of it,
   convert it to TypeScript, or make it depend on the new frontend.
2. `frontend_stack_ts/` is a greenfield replacement, not a migration.
3. The old frontend is evidence about product behaviour and API usage only. Its
   directory structure, component hierarchy, state management, routing, layout system,
   styling strategy, hooks, API wrappers, and responsive behaviour carry no authority.
4. `backend_controller/` is the canonical integration target, analysed independently.
5. Compatibility with old frontend architecture is not a requirement.
6. Feature parity matters. Implementation parity does not.
7. `frontend_stack` deletion happens only after verified cutover. Git history retains it.
8. No permanent dual-frontend architecture remains afterward.
9. The `release_manager/docs/complexity-audit-2026-08-26/` backlog does **not** need to be
   completed. It is read here purely as evidence of what is legacy versus canonical.

## Document order

Read in this order. Documents 00, 04, 07 and 10 are the load-bearing ones.

| Doc | Title | Read it to learn |
| --- | ----- | ---------------- |
| [00](00-executive-summary.md) | Executive summary | What the app does, why the frontend decayed, the strategy, the risks |
| [01](01-current-system-architecture.md) | Current system architecture | Backend, DB, Redis, workers, auth, payments, deployment as they actually are |
| [02](02-active-feature-inventory.md) | Active feature inventory | Every capability with its frontend/backend/API/DB evidence and REBUILD/REMOVE verdict |
| [03](03-frontend-forensic-audit.md) | Frontend forensic audit | What is wrong with the legacy frontend, with file and line evidence |
| [04](04-backend-api-contract-map.md) | Backend API contract map | Every endpoint, auth model, envelope, errors, pagination, idempotency |
| [05](05-route-navigation-map.md) | Route and navigation map | Current routes, their defects, and the canonical target route map |
| [06](06-legacy-dead-duplicate-code.md) | Legacy / dead / duplicate code | Classified inventory of what must not be carried forward |
| [07](07-typescript-frontend-target-architecture.md) | TypeScript target architecture | Stack choice, directory design, API layer, state, errors, types |
| [08](08-responsive-web-mobile-layout-system.md) | Responsive web/mobile layout system | Breakpoints, shells, safe areas, Android contract, per-component strategy |
| [09](09-design-system-component-plan.md) | Design system / component plan | The exact primitive and application component set |
| [10](10-migration-and-implementation-plan.md) | Migration and implementation plan | Phases 0–12 with acceptance criteria |
| [11](11-target-file-and-directory-map.md) | Target file and directory map | Full target tree plus legacy→target migration table |
| [12](12-risk-regression-test-plan.md) | Risk / regression / testing plan | High-risk areas and the minimum verification before cutover |

## Current project status

Nothing of the new frontend exists yet. `frontend_stack_ts/` has not been created.

**Phase 0 is complete** (2026-08-27). Error-code parity with the backend (24 codes), `PageMeta`,
a descriptor variant allowing `native-bearer` writes to require an idempotency key, the drift
checker parameterised to scan the new tree, and the dead `.env.legacy-backup` removed.

**Phase 0 was amended.** Contracts and backend corrections are now extended **per feature phase**
rather than as one ~7,000-line push up front. That is safe because the drift checker now fails CI
the moment the new frontend calls an uncontracted path. The backend corrections in doc 04 are
promoted from "consider" to **mandatory** — the application is pre-production, so the contract is
shaped for the new frontend and the legacy frontend may break as a consequence — but each is made
in the phase that consumes it, since an unconsumed API change is an unverified one.

The repository still holds an **uncommitted payment refactor** (31 files) replacing the PhonePe
native mobile-SDK one-time checkout with hosted Standard Checkout, plus untracked migration
`043_hosted_checkout_dispatch_claim.sql`. Verified read-only on the dev stack: 33 migrations
applied, latest `042`, and `payment_attempts` still carries the 035 constraint that excludes
`hosted_redirect`. Migration 043 is verified together with the new frontend at new-stack deploy
time, with a schema backup, and gates **Phase 7** only.

## Recommended starting point

**Phase 1.** Phase 0 is done and nothing else blocks it. Phase 1 also closes B5 (origin
allowlist) and B6 (the fourth CI job), both of which need the project directory to exist.

## Implementation sequence

```
Phase 0   Land the in-flight payment refactor; extend packages/contracts to full coverage
Phase 1   frontend_stack_ts foundation: workspace, Vite, TS, tokens, CI, Docker
Phase 2   Shells, routing, providers, native coordinators
Phase 3   Authentication and session
Phase 4   Email OTP Verification and eligibility gate
Phase 5   Funds catalogue and fund detail
Phase 6   Portfolio, transactions, statements
Phase 7   Orders and hosted-redirect payments
Phase 8   SIP and AutoPay
Phase 9   Client account surfaces: notifications, support, profile, device security, disclosures
Phase 10  Admin console
Phase 11  Android packaging and APK verification
Phase 12  Cutover, legacy retirement, backend cleanup
```
