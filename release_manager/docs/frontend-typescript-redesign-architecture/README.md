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

**All twelve phases have landed.** `frontend_stack_ts` is the only frontend in the repository;
`frontend_stack/` was deleted in Phase 12 and survives only in git history.

State as of 2026-08-29:

- `packages/contracts` describes **101 operations** across 91 paths. The drift checker was replaced
  by `check-frontend-contract-bypass.mjs` (D-030), which fails on any `/v1/...` literal outside the
  generated client and on any mismatch between the contracted and generated operation counts.
- Every route in both manifests renders a real screen. There is no placeholder screen.
- Styling is a token layer plus **Tailwind v4** utilities derived from it via `@theme inline`, plus a
  typed recipe layer (D-033). All 35 CSS Modules are gone. `tokens-core.css` is still the sole
  reader of `env(safe-area-inset-*)`.
- Both APKs build, install and launch. R8/minification was exercised for the first time in
  Entry 019; the release APKs are unsigned and were never installed.
- Gates: `npm run check` in `frontend_stack_ts`, `npm run check` in `packages/contracts`, the backend
  suite, and `release_manager/verify.sh`.

**Read `LOGS/implementation_log.md` for what actually landed, and `LOGS/risk_and_decision.md`
(D-001 to D-052) for the decisions that constrain it.** Several statements in the numbered documents
have been superseded; where a document and the decision log disagree, the log is authoritative. This
applies with particular force to **doc 10's Phase 13 tables**, four rows of which were disproved in
Entry 024 — see known gap 6.

### Known gaps, still open

These were required by the plan and have not landed. They are tracked here because the numbered
documents still read as though they were done:

1. ~~**No cursor pagination anywhere.**~~ Closed in Entry 023. Every browsable list in the product
   pages on the opaque cursor through `usePagedQuery` and one shared `LoadMore`; the lists that stay
   one-shot, and the pickers that walk every page instead, are enumerated with reasons in D-043. The
   `Cursor` scalar was also fixed — it could not match a token the backend can mint. No paginated
   query has been run against PostgreSQL; see Entry 023's UNVERIFIED list for the VPS check.
2. ~~**App-update gate absent.**~~ Closed in Entry 022. `AppUpdateGate` is mounted in both shell
   roots, `getAppUpdate` has a consumer, and a mandatory update blocks the app. Unverified on a
   device — see Entry 022's UNVERIFIED list.
3. ~~**Device security is a settings screen with no lock.**~~ Closed in Entry 022. `DeviceLockGate`
   locks on cold start and after 120 s in the background, `NativeBiometric` is wired through
   `src/platform/biometric.ts`, and Android Back cannot bypass the lock. Unverified on a device.
4. ~~**Android admin has no bearer auth path.**~~ Closed in Entry 026. The admin scope has its own
   bearer channel (`admin_native`), three contracted endpoints under the admin native auth prefix,
   `buildAdminDevice`, and an `adminRuntime` that picks bearer + Secure Storage on native and keeps
   cookies in a browser. Closing it also closed a real hole: the admin bearer leg previously accepted
   any `native` session, so an investor's APK token passed admin *authentication*. Nothing has been
   exercised on a device or against PostgreSQL — see Entry 026's UNVERIFIED list, and note that
   migration 047 must be applied before the code that writes `admin_native` runs.
5. **`OptimisticVersionForm` / `PreviewCommitPanel` were never built.** The `basisHash` and
   `expectedVersion` protocols are implemented correctly but inline in four admin screens, so there
   is no single guard. `parseIfMatchVersion` in the backend has no callers.
6. **Phase 13 backend cleanup is partly done** — Entry 024 closed five items of doc 10's list
   (`sessionTokens.ts`, the three duplicate `requireIdempotencyKey` bodies, CORS `PUT`,
   `locked_until` in `db/types.ts`, the provider-event inbox drain, and the Razorpay agent-memory
   note). **Four items in doc 10's Phase 13 tables are factually wrong and must not be acted on:**
   `optionalIdempotencyKey` has three live callers (D-046), `adminFundGrowthPreviewRoutes.ts` is a
   live endpoint the admin console calls (D-049), `mandateReconciliationWorker` is wired inside the
   payment-reconciliation pass (D-047), and the refund machinery backs a shipped admin screen
   (D-048). The rest of doc 10's list — `CACHE_KEYS.fundList`/`invalidatePrefix`, the
   email-verification resend alias, `payments.mobileSdk`, `MOBILE_CHECKOUT_DISABLED`, the
   `'rejected'` CHECK value, fixture residue, in-process rate limiting,
   `legacy_investment_reviews`, and suspend/reinstate/close — is untouched.
7. **`assertHttpMode()` is dead code**; D-009's configuration-error screen does not exist.
8. **`secureStorage.ts` asks the bridge for a plugin name that does not exist.** It calls
   `"SecureStoragePlugin"`; `@aparajita/capacitor-secure-storage` registers, and annotates its Java
   class as, `"SecureStorage"`. Found in Entry 022 and deliberately left: correcting it moves client
   bearer tokens on Android and needs a device. See D-040.
9. ~~**The browser client keeps refresh tokens in `localStorage`.**~~ Closed in Entry 025. The client
   scope has its own HttpOnly cookie session on a `client_web` session channel, and `persistSecrets`
   is native-only. Nothing credential-shaped reaches `localStorage` on either platform. No cookie has
   been issued by a running backend — see Entry 025's UNVERIFIED list, which also carries the four
   cross-scope replays that prove the isolation, and note that migration `046` must be applied before
   the backend image that writes the new channel.

## Recommended starting point

The phased build is finished. Pick from "Known gaps, still open" above; items 4 (Android admin bearer
auth) and 5 (`OptimisticVersionForm` / `PreviewCommitPanel`) are the widest of what remains.

**Before trusting any native behaviour, read D-040.** Until Entry 022 nothing in `src/` had ever
called Capacitor's `registerPlugin`, so `window.Capacitor.Plugins` was empty on device and every
wrapper in `src/platform/` failed silently. That is now fixed, which means `NativeBackCoordinator`,
`applySystemChrome` and `openDestination` are executing for the first time and have never been
observed running.

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
