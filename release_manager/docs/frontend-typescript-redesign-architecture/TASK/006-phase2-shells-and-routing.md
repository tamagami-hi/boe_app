# TASK 006 — Commit the in-flight work, then land Phase 2

Date: 2026-08-28
Log entries: [013](../LOGS/implementation_log.md), [014](../LOGS/implementation_log.md)
Decisions: [D-024](../LOGS/risk_and_decision.md#d-024) · [D-025](../LOGS/risk_and_decision.md#d-025) · [D-026](../LOGS/risk_and_decision.md#d-026)

## What was done

### 1 · Five commits out of one tangled tree

58 modified, 8 deleted and 8 untracked paths spanning four independent concerns. Split by concern
and each verified before landing: contracts, backend, legacy frontend, new frontend, docs. The
legacy frontend slice was the largest at −1,100 lines and removes fixture mode entirely, collapses
the accidental second transport in `appConfig.js` into the canonical one, renames the misnamed
`legacy/legacyRoutes.jsx` container away, and makes `markAllRead` actually issue requests.

### 2 · Read the rules that `AGENTS.md` points at, and corrected my own breach

`AGENTS.md` requires reading root `README.md` before inspecting, changing, testing or committing.
I had been committing without doing so. On reading it, my test suites were over-scoped against
§2, §4 and §5 — I had written transport plumbing tests the rules explicitly exclude. Removed nine
passing tests (67 → 57 at that point) and recorded why. This is the one correction in this task I
would flag as a genuine process failure rather than a discovery.

### 3 · Phase 2

Routing infrastructure, six providers in their contracted order, five layouts, nine primitives,
five patterns, three native coordinators, six platform modules, two shells with their runtimes, and
four real auth screens. 90 tests.

## What the gates caught that tests could not

Three failures, all of them in the class `rules.md` §2 warns about — invisible to a green suite.

| Failure | Why it matters |
|---|---|
| Chunk graph cycle, twice | `check-android-dist.mjs` counts dynamic imports as graph edges, so any arrangement where a manifest chunk lazy-imports screens that import shared code is a cycle. This is the v0.9.0 blank-screen defect. Resolved by D-024 |
| Vendor chunk 329,202 bytes against a 327,680 limit | Same script, same fix |
| `blocked` route unreachable | `routeIntegrity.test.ts` found a route with no nav entry and no inbound link. It is reached by a guard redirect. Made that explicit with `GUARD_DESTINATIONS` rather than faking a link to silence the test |

## Contract coverage

`packages/contracts` gained health, the four web-auth operations and the admin session — six paths
taken from the handlers rather than from documentation. The drift baseline fell from **60
uncontracted paths to 54**, the first movement toward D-005's cutover target of zero.

## Verification

TESTED: all three project gates exit 0. `frontend_stack_ts` is at 90 tests across 6 files;
`build:client` passes the android and boot gates at 16 assets / 586,621 bytes / largest JS
193.69 kB; contracts drift is clean at the regenerated baseline; `backend_controller` is at 676
tests and 80.04% branch coverage.

UNVERIFIED, and this is the honest state of the product:

- **Nothing has rendered in a browser.** No dev server, no Playwright run. JSDOM chunk evaluation
  proves the modules load, not that the app paints or that a click works.
- **No login has ever succeeded against a real backend.** The VPS dev stack is at migration `042`
  and its `WEB_ORIGIN_ALLOWLIST` has no `http://localhost:5174` entry, so it cannot serve a
  locally-run new frontend and it does not carry the hosted-checkout backend either. End-to-end
  auth needs a local stack.
- **47 of 55 routes are placeholders.** Phases 3–10 are not done.
- Nothing has run on a device or emulator.

## Next, in dependency order

1. Bring up `test_e2e/local-stack.sh`, run the backend locally, and verify client and admin login
   end to end with Playwright. This is the first real proof the transport, session, CSRF and CORS
   paths work, and it gates everything after it.
2. Contract and build Phase 3 properly (session restore, refresh-on-401 against a live backend),
   then Phase 4 eligibility, then 5–9 client surfaces, then 10 admin.
3. Backend corrections BC6, BC9 and BC10 in the phases that consume them, per D-002.
4. Phase 11 Android packaging, then emulator verification of safe areas, system bars, keyboard and
   the five Back rules.
