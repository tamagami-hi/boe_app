# BOE Android UX Architecture Audit — implementation handover

Companion to `BOE_ANDROID_UX_ARCHITECTURE_AUDIT.md`. All 39 tasks are implemented.
This document exists because **the work was done on a machine that cannot run the
system**: no Gradle, no emulator, no device, no long-running services. Everything
below separates what was actually checked from what is still unproven, and gives
you the exact commands for the rest.

Read the two lists as they are written. A green test run in this repository does
not mean a screen works — three real defects in this codebase (a button whose
handler prop was never passed, a stale-snapshot concurrency precondition, and mail
recorded as `sent` by a transport that discarded it) were invisible to tests and
only appeared when the system ran.

---

## 1. What was verified locally

Re-runnable from a clean checkout of this branch:

| Check | Command | Result |
|---|---|---|
| Frontend unit/contract suite | `cd frontend_stack && npx vitest run` | 49 files / 740 tests pass |
| Backend suite | `cd backend_controller && npx vitest run --config vitest.config.ts` | 52 files / 458 tests pass |
| Release tooling suites | `for t in release_manager/tests/*.test.sh; do bash "$t"; done` | 14 / 14 pass |
| Web build (admin console) | `cd frontend_stack/app && npm run build` | exit 0 |
| Android bundle build | `cd frontend_stack/app && npm run build:android` | exit 0 |
| Packaged-artifact guard | `cd frontend_stack/app && node scripts/check-android-dist.mjs` | `Android artifact OK: 17 assets, 760.7 kB total.` |

Measured outcomes worth keeping an eye on in future changes:

- Android web assets **984 kB → 760.7 kB**, almost entirely fonts: 20+ font files
  down to exactly 8 woff2. `packages/design-tokens/src/fonts.css` now declares the
  `@font-face` rules explicitly. **`latin-ext` is mandatory** — the rupee sign
  U+20B9 falls in `U+20AD-20C0`; dropping that subset makes every amount in the app
  render in a system fallback font.
- Admin console CSS per page load **231 kB → 136 kB**. The client screen chunk is no
  longer shipped to the admin console at all.
- Razorpay's checkout script is no longer in `index.html`; it loads on demand via
  `loadRazorpay()` with a 15 s timeout and does not cache a failed load.

### The tests that will fail a careless future change

These are scan/contract tests rather than render tests, because most of the defects
found in this audit were in files nobody was editing:

- `design-tokens/src/cssContract.test.js` — token ownership, z-index literals, hit areas
- `design-tokens/src/classContract.test.js` — every `adm-/ash-/be-/apk-` class in a
  `className` must exist in some stylesheet
- `design-tokens/src/componentContract.test.js` — every `<Foo` and `icon={Foo}` must be
  declared in its file (a dependency-free `no-undef`)
- `design-tokens/src/safeArea.test.js`
- `design-tokens/src/interactionContract.test.js` — **new in the final sweep**, see §3
- `shared/src/motion/motionContract.test.jsx` — no gsap anywhere, no `<FadeIn`,
  `PageTransition` inert
- `app/src/bundleContract.test.js` — dead deps, font subsets, the deferred checkout
  script, the artifact guard's own budgets
- `client/src/ClientApp.test.jsx` and `admin/src/pages/Admin.test.jsx` — route
  manifest ↔ router drift
- `release_manager/tests/hermetic_branding.test.sh` — branding hermeticity, no Gradle needed

Several of these strip comments before asserting, because the files under test
explain the defect they fixed and the explanation names the forbidden string.

---

## 2. What was NOT verified and cannot be, here

### 2a. No Gradle ran. The APK is unproven.

T38 removed 27 duplicated branding files from the tracked `android/app/src/main/res`
and moved variant selection into Gradle source sets. **The change is asserted by a
wiring test, not by a build.** Run, from the VPS or any machine with the Android SDK:

```bash
# via the release script (preferred — it injects the app id, version and variant)
./emu/boe_update.sh --dev  --client --no-install
./emu/boe_update.sh --dev  --admin  --no-install
./emu/boe_update.sh --prod --both   --no-install

# or Gradle directly, from frontend_stack/app/android
./gradlew assembleRelease \
  -PboeVariant=client \
  -PboeApplicationId=com.beonedge.app \
  -PboeVersionCode=<n> \
  -PboeVersionName=<label>
```

Then assert the hermeticity property the task was about:

```bash
git status --porcelain   # MUST be empty after a --both build
```

If that prints anything under `frontend_stack/app/android/app/src/main/res`, the
source-set route did not take and something is still copying branding into tracked
files.

Two more things to confirm on the built APKs:

- **The client APK carries client branding.** The bug T38 fixed was that the
  committed `values/ic_launcher_background.xml` was `#FF0000` — the *admin* red — so
  a clean checkout or a bare `gradlew` build shipped the client app with admin
  branding. Client is `#1800AD`. Check the launcher icon on the home screen for both
  variants.
- **`-PboeVariant` is validated.** `./gradlew assembleRelease -PboeVariant=nonsense`
  should fail with a clear message rather than build something.

### 2b. Device checks

None of these can be reduced to a test. Install both variants on a real device
(not only an emulator — insets and IME behaviour differ) and check:

| # | Check | What a failure looks like |
|---|---|---|
| 1 | Post-splash theme handoff | a white or black flash between the native splash and the first screen |
| 2 | Keyboard resize | the focused input hidden behind the IME, or the bottom nav riding up on top of the keyboard |
| 3 | System-bar icon colour | invisible status-bar icons (white on white) on either variant |
| 4 | Insets | content under the notch, or under the gesture bar |
| 5 | Recents blanking | account values visible in the app-switcher thumbnail |
| 6 | Pinch-zoom disabled | the whole WebView zooming as a document |
| 7 | OS font scaling at max | clipped or overlapping text, unreachable buttons |
| 8 | CORS preflight from the APK | requests failing only in the APK, where the origin is not an https site |
| 9 | Admin bottom-bar gesture clearance | the system back gesture stealing taps from the last nav item |
| 10 | Hub sheet + hardware Back | Back closing the app instead of the sheet, or the sheet's history entry stranding the user |
| 11 | `ConnectivityBanner` on a real network | flip wifi off, and separately join a captive-portal wifi that answers nothing — the second case must say "Cannot reach BeOnEdge", not "No connection" |
| 12 | Razorpay deferred load | tap Pay on a slow network: the submit lock must hold until the modal is actually open, and a failed script load must surface a message rather than nothing |
| 13 | Published app-config round trip | change copy in the admin App Builder, publish, and confirm a device picks it up |

Items 11–13 are the ones I would run first: they are the newest code paths and the
three whose failure modes are silent.

### 2c. Backend/VPS

Deployment is yours, via `release_manager/` on the VPS. Nothing here needs a
migration — no schema change was made in these 39 tasks, so ordering does not
apply to this release.

---

## 3. Final sweep findings (fixed in T39)

The last pass scanned every shipped `.jsx`/`.js` for the recurring defect families
this audit kept turning up. Four things were still live:

1. **`LumpsumSheet.jsx` — a failed fund read rendered a skeleton forever.**
   `.catch(() => setFund(null))` with `if (!fund) return <Skeleton>` above it. On the
   one-time investment screen: a dropped request left a permanent loading state with
   no retry and no message. Now has an `ErrorState` branch with a retry.
2. **`Support.jsx` — an outage rendered as "No tickets yet".** Both reads caught into
   empty arrays, on the screen an investor opens to check a request they already
   filed. Now one `Promise.all` with an `ErrorState` and a retry.
3. **`Profile.jsx` — a failed KYC read was indistinguishable from "KYC not started".**
   Both produced a bare row with no meta and no badge, on the row that gates
   investing. Now shows "Status unavailable — tap to check".
4. **16 `<button>` elements with no `type`** across `Blocked`, `Explore`, `FundDetail`,
   `Portfolio`, `Transactions` and `shared/ErrorBoundary`. A `<button>` without a type
   is `type="submit"`; none of these files contains a `<form>`, so this is latent
   rather than live — it becomes a real bug the moment one of those screens is wrapped
   in a form and a tap submits it.

`packages/design-tokens/src/interactionContract.test.js` now enforces all four, and
was confirmed to fail when a defect is reintroduced (verified by removing one
`type="button"` and watching it name the file and line).

Clean in this sweep: no clickable `<div onClick>` controls, no `role="button"`
substitutes, no `alert(` calls in shipped code. Every grep hit for those was a
comment describing a defect that had already been fixed. `packages/ui-kits/**` is
excluded from these scans — it is a standalone preview kit, not shipped in either
bundle.

---

## 4. Flagged for the maintainer

1. **`npm ci` would have failed on a clean checkout before T37.** T1 added the
   vitest/jsdom/testing-library devDependencies without updating the lockfile, so it
   had been out of sync for the whole audit. T37's dependency removal regenerated it
   (+2278 lines of test-harness tree, gsap removed). Worth a `rm -rf node_modules &&
   npm ci` on the VPS to confirm the regenerated lockfile installs.
2. **Client support tickets have no admin surface.** The client can file a ticket and
   it persists, but there is no admin screen that reads them (noted in T28). Tickets
   are currently written into a void from the operator's point of view.
3. **A stale APK on disk packages admin chunks.**
   `frontend_stack/app/android/app/build/outputs/apk/release/app-release.apk` is
   gitignored, dated before T16, and contains `admin-*.js`, `admin-*.css` and two
   `BrowserRoot-*` files alongside the client chunks. It is **not** a current
   regression — it predates the `main.jsx` single-import fix. I kept it because the
   new final-APK content check in `boe_update.sh` fires on it, which is the only
   proof available here that the check works. Delete it whenever you like.
4. **`res/layout/activity_main.xml` shows as an unstaged deletion from before this
   session.** Nothing in the Java sources or the manifest references it (the
   manifest's `@string/title_activity_main` is a different resource). Left as found.
5. **No product flavors, deliberately.** Variant selection is `-PboeVariant` plus
   `res.srcDirs`, not a product flavor and not an `applicationIdSuffix`. Flavors would
   rename the Gradle tasks (`assembleClientRelease`) and move the APK output path, and
   a suffix on top of the script's existing `.admin` append would produce
   `...admin.admin`. Application id and signing decide whether an update installs over
   an existing app, and that is not testable without a Gradle run.
6. **Financial writes are never auto-retried.** `fetchRead` retries GETs on transport
   errors twice (300 ms, 900 ms). Writes carry an `Idempotency-Key` so a *user* can
   retry, but the app never replays one — it cannot know whether the first attempt
   arrived, and a duplicated payment or redemption is the failure that costs real
   money. Please keep that asymmetry if you touch `_util.js`.

---

## 5. Nothing was committed or pushed

The work is in the working tree only. No commit, no tag, no `git push`, no
`deploy.sh`, no `export.sh`, no `rollback.sh`, and no connection to the VPS was made.
