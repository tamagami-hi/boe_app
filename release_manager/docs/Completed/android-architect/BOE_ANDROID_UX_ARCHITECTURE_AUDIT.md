# BOE App — Android Mobile UX, Navigation, Performance & Architecture Audit

**Audit date:** 2026-08-13
**Mode:** repository audit and implementation plan only
**Repository:** `/home/nethunter07/PROJECTS/boe_app`
**Implementation status:** IMPLEMENTED — all 39 tasks in this plan were carried out in a later session. This document is preserved as written (the audit-only deliverable it was on 2026-08-13); what was actually verified, what is still unproven, and the Gradle/device commands needed to close the gap are in [`BOE_ANDROID_AUDIT_HANDOVER.md`](./BOE_ANDROID_AUDIT_HANDOVER.md).

## Audit boundary and confidence

This is a static repository and existing-artifact audit. It covers the frontend packages, router, state/data access, CSS, Capacitor configuration, generated Android project, backend origin/auth contracts, release scripts, and the currently present `dist`/APK artifacts. No build, package install, emulator run, API call, or source mutation was performed because those would violate the audit-only constraint.

Static conclusions such as route existence, broken paths, provider placement, API call ownership, WebView settings, and Android build configuration are high confidence. Runtime timings, memory, frame stalls, device-specific inset behavior, and deployed CORS values require Phase 0 measurement. The checked-in release environment examples are authoritative evidence of configuration drift, but deployed secrets may already override them.

### Product constraint retained

The React splash screen's **1.6-second minimum hold is intentional and must remain** for both Client and Admin. The plan does not shorten it. Bootstrap work should run concurrently beneath that hold so the handoff occurs at 1.6 seconds whenever dependencies are ready, rather than at 1.6 seconds plus serial session/reachability work.

---

# A. Executive Diagnosis

The APK does not suffer from wholesale full-document navigation: most internal links already use React Router, and persistent Client/Admin shells already exist. The website-like feeling is produced by a more specific combination: invalid routes silently restart at splash, guards render blank, route content fades in from zero on every pathname, pages own and repeat their API loading, and the Admin shell compresses a desktop console into a 13-destination horizontal phone bar.

| Rank | Cause | Severity | Impact on perceived native quality |
|---:|---|---|---|
| 1 | Broken and unvalidated routes fall through to splash/overview | **CRITICAL** | A bad tap looks like an app restart; errors are hidden rather than explained |
| 2 | No shared client query cache; admin eagerly loads six unrelated collections | **CRITICAL** | Revisiting screens repeats work and produces spinner/blank-to-page transitions |
| 3 | Blank auth/eligibility gates and route-wide GSAP reveal animation | **HIGH** | Shell/content disappears or reconstructs like a webpage |
| 4 | Android back is delegated to WebView history | **HIGH** | Bottom tabs, completed flows, sheets and admin overlays follow browser history |
| 5 | Safe-area implementation ignores Capacitor 8's Android fallback variables | **HIGH** | Top/bottom controls can collide with cutouts/system UI on affected WebViews |
| 6 | Admin mobile IA puts 13 destinations in a horizontal fixed strip | **HIGH** | Desktop navigation is compressed rather than restructured for a phone |
| 7 | Client has a shell but no coherent persistent top-bar/header contract | **HIGH** | Primary pages recreate identity, actions and headings inconsistently |
| 8 | Per-page loading/error ownership and broad admin context invalidation | **HIGH** | Full regions vanish, failures become empty lists, and unrelated screens rerender |
| 9 | Mixed-content enabled, native tokens in localStorage, release CORS drift | **HIGH / SECURITY** | Network failures can resemble broken pages; credential/WebView policy is too permissive |
| 10 | Zoom policy is implicit and contradicted by observed pinch behavior | **HIGH** | APK exposes webpage-like page zoom despite Capacitor's nominal default |
| 11 | Desktop/admin tables, dense forms, ad-hoc modals and small targets | **MEDIUM-HIGH** | Mouse-oriented precision and horizontal scrolling remain common |
| 12 | Broad chunks, eagerly imported route code/CSS, all-script font subsets | **MEDIUM** | Startup parse/style/font payload is larger than the target needs |
| 13 | Client/Admin CSS generations and overlay patterns coexist | **MEDIUM** | Visual rhythm, safe areas, z-index and modal behavior drift |
| 14 | Native splash/WebView/React handoff is not one explicit contract | **MEDIUM** | White/blank intervals remain possible around an otherwise intentional splash |

### Audit scorecard

| Area | Current assessment | Why |
|---|---:|---|
| Persistent shell | 6/10 | Client `ClientLayout` and Admin `AdminShell` persist, but top-level client chrome is page-owned and admin mobile IA is unsuitable |
| Route correctness | 4/10 | Most canonical routes exist, but three concrete user-facing defects and unvalidated remote destinations are masked by wildcards |
| Android integration | 4/10 | Capacitor plugins/build path are mature; back, bars, insets, IME and zoom are not coordinated at app level |
| Data/navigation performance | 3/10 | No client cache; broad admin preload/context; eager route modules and CSS |
| Mobile interaction | 5/10 | Mobile tokens and `dvh` exist, but tables, click-divs, target sizes and manual dialogs remain |
| Loading/failure UX | 3/10 | Root boundaries exist, but guards return `null`, failures collapse to empty arrays, and retained content is rare |
| Security-sensitive mobile architecture | 4/10 | Native bearer contract and Secure Storage plugin exist, but tokens bypass it; mixed content and backup are permissive |
| Release engineering | 7/10 | Both APK variants, signing, minification, hashes and distinct IDs exist; resource mutation, stale docs and weak bundle checks remain |

---

# B. Current Architecture

## Frontend and packages

```text
frontend_stack/
├── package.json                         npm workspaces
├── package-lock.json                    resolved dependency authority
├── app/                                 shared Vite + Capacitor entry/build shell
│   ├── index.html                       viewport, global Razorpay script, root node
│   ├── src/
│   │   ├── main.jsx                     build-target selection + BrowserRouter
│   │   ├── ClientRoot.jsx               client root/session/lazy app
│   │   ├── BrowserRoot.jsx              admin root/client+admin session providers
│   │   ├── index.css                    root/safe-area variables
│   │   └── components/                  root loader/error boundary
│   ├── vite.config.js                   broad vendor/client/admin chunks
│   ├── capacitor.config.json            WebView/server/Android policy
│   ├── scripts/check-android-dist.mjs    client-only filename guard
│   ├── resources/launcher/              client/admin launcher + splash assets
│   └── android/                          generated/native Capacitor project
└── packages/
    ├── client/                           Client routes, pages, auth, API, platform adapters, mobile CSS
    ├── admin/                            Admin routes, shell, legacy/new screens, CSS
    ├── shared/                           API config, error/motion/shared hooks/assets
    ├── design-tokens/                    colors, type, spacing, radii, shadows, z-index
    └── ui-kits/                          older website/APK kit surfaces
```

Resolved versions from `frontend_stack/package-lock.json`:

- React 18.3.1; React DOM 18.3.1.
- React Router DOM 6.30.3.
- Vite 5.4.21 with React plugin 4.3.1 and Lightning CSS 1.33.0.
- Capacitor Core/Android/CLI 8.3.4.
- Capacitor App 8.1.0; Browser 8.0.3; Local Notifications 8.2.1; Secure Storage 8.0.0; Native Biometric 8.4.5.
- GSAP 3.15.0; Lucide React 0.439.0.

There is no PWA/service-worker implementation and no WebSocket implementation. The backend is HTTP/JSON. Do not add offline service-worker or WebSocket architecture speculatively.

## Build-target and routing architecture

```text
app/src/main.jsx
└── BrowserRouter
    ├── VITE_BEO_APP_TARGET=client
    │   └── ClientRoot
    │       └── SessionProvider
    │           └── /app/* → ClientApp
    │               └── ClientLayout (persistent after auth)
    │                   ├── AppLockGate
    │                   ├── main → PageTransition → Outlet
    │                   └── BottomNav on paths classified as primary
    └── other/admin target
        └── BrowserRoot
            ├── SessionProvider (client; unnecessary here)
            └── AdminSessionProvider
                └── RequireAdmin → /admin/* → Admin
                    └── AdminShell (persistent)
                        ├── Sidebar + mobile nav transformation
                        ├── TopBar
                        ├── ToastProvider
                        ├── LegacyAdminDataProvider
                        └── Outlet
```

Client and Admin are separate build-time products from one Vite shell. The authoritative APK builder, `emu/boe_update.sh`, supports `--client`, `--admin`, and `--both`, injects distinct application IDs, builds the selected Vite target, runs `cap sync`, then Gradle. `release_manager/FACTS_VS_PLAN.md` still claims Admin APK support/application-ID separation are absent; that statement is stale.

## Capacitor and Android

```text
frontend_stack/app/capacitor.config.json
└── webDir=dist, androidScheme=https, cleartext=true, allowMixedContent=true

frontend_stack/app/android/
├── app/build.gradle                     injected ID/version, signing, R8, shrinkResources
├── variables.gradle                     min 24, compile/target 36
└── app/src/main/
    ├── AndroidManifest.xml               singleTask launcher, network policy, updater/notification permissions
    ├── java/.../MainActivity.java        registers AppUpdatePlugin only
    ├── res/values/styles.xml             native splash/AppCompat themes
    ├── res/xml/network_security_config.xml
    └── assets/                           synced Capacitor config/web bundle/plugin registry
```

Installed native plugins: Secure Storage, App, Browser, Local Notifications, Native Biometric, and the repository-local App Update plugin. Capacitor 8's SystemBars core capability is available without adding a package. Keyboard, Network, Haptics, Preferences, legacy StatusBar, and legacy SplashScreen plugins are not installed.

Android versions: min SDK 24, compile/target SDK 36, AGP 8.13.0, Gradle 8.14.3, Java 21 expectation. Release builds use R8 and resource shrinking and are signed when the keystore is configured; the builder otherwise falls back loudly to debug. Existing inspected release artifacts contain no source maps and are non-debuggable, but final artifact isolation is weak.

## CSS/design architecture

- Shared tokens define a coherent BOE palette, Instrument Sans/Fraunces/JetBrains Mono, spacing, radii, shadows, semantic colors, motion timings and a semantic z-index scale.
- Client imports one mobile CSS barrel that eagerly includes every page stylesheet.
- Admin simultaneously imports redesigned `styles/desktop/*`, legacy `styles/admin/*`, and screen-specific shared CSS. `.ash-*` and `.adm-*` generations intentionally coexist, but now create duplication.
- Current product is explicitly light-only (`color-scheme: light`, Android force-dark disabled). Dark mode is not a broken feature; it is outside this plan unless product scope changes.

## Authentication and API

- Client `SessionProvider` initializes once at root. An existing access token plus cached user can restore without a status probe; refresh occurs when needed.
- Admin `AdminSessionProvider` calls `/v1/admin/session` to restore live roles/permissions. `BrowserRoot` also mounts an unused client `SessionProvider`.
- `apiRequest` has a 20-second timeout, typed transport errors, single-flight refresh, and one retry after refresh.
- Native Client and Admin use bearer tokens because the WebView origin is `https://localhost`; browser Admin uses stronger same-site HttpOnly cookies.
- Native access/refresh tokens and cached users are currently kept in `window.localStorage`, even though a Secure Storage adapter is installed.
- Client pages own most request state; there is no shared query cache. Admin mixes one broad legacy provider with newer screen-local list hooks.

## Production path

```text
Frontend sources/workspaces
  ↓ VITE_BEO_APP_TARGET + exact API/onboarding origin
Vite production build (minified JS/CSS)
  ↓ client target guard only
Capacitor sync/copy (`webDir: dist`)
  ↓
Android Gradle
  ↓ assembleRelease + R8 + resource shrink + signing
  ↓ or explicit debug fallback when no keystore
Versioned client/admin APK + SHA-256/provenance sidecar
  ↓ release-manager validation/publishing
```

`emu/boe_update.sh` currently copies variant launcher/splash files into committed `src/main/res` before each build. A `--both` build leaves Admin resources last, so a later bare Gradle build can inherit the wrong branding. The build should become hermetic through source sets/flavors or generated resource directories.

---

# C. Route Reachability Matrix

“Reachable” means reachable through current UI under the stated role/state, not merely resolvable if a URL is typed. Data-driven reachability is marked conditional because production notification/config payloads were unavailable.

## Client

| App | Route | Page exists | Navigation entry | Reachable | Guard | Problem |
|---|---|---:|---:|---:|---|---|
| Client | `/` | Redirect | Launch/root | Yes | Public | Redirects to splash |
| Client | `/login` | Redirect | Compatibility URL | Yes | Public | Redirects to `/app/login` |
| Client | `/app` | Redirect | Direct URL | Yes | Public | Redirects to splash |
| Client | `/app/splash` | Yes | Launch | Yes | Public/session bootstrap | Intentional 1.6s minimum; client reachability begins after session settles |
| Client | `/app/login` | Yes | Splash/auth redirect | Yes | Public | `from` is bounded; normal entry works |
| Client | `/app/verify-email` | Yes | Dashboard/KYC/eligibility redirect | Yes | Client auth | Secondary verification flow |
| Client | `/app/start` | Redirect | None | Compatibility only | Client auth | Obsolete alias → dashboard; retain temporarily with tests |
| Client | `/app/dashboard` | Yes | Bottom nav/splash | Yes | Client auth | Primary Home; five requests per mount |
| Client | `/app/explore` | Yes | Bottom nav/quick action | Yes | Client auth | Primary; refetches funds/research |
| Client | `/app/funds/:fundId` | Yes | Dashboard/Explore/Portfolio | Yes | Client auth | Dynamic IDs should use route builders/encoding |
| Client | `/app/invest/sip/:fundId` | Yes | Fund detail | Yes | Auth + eligibility | Guard returns blank during fresh eligibility request |
| Client | `/app/invest/lumpsum/:fundId` | Yes | Fund detail | Yes | Auth + eligibility | Same blank/fresh gate |
| Client | `/app/payment/:paymentId` | Yes | Investment/transaction flow | Yes | Auth + eligibility | Completion pushes rather than pruning transaction history |
| Client | `/app/mandates/:mandateId/authorize` | Yes | Payment/mandate flow | Yes | Auth + eligibility | Completion pushes Dashboard; Back can reopen flow |
| Client | `/app/mandates/:mandateId` | Yes | No static entry | Conditional | Client auth | Backend deep-link/manual URL only |
| Client | `/app/portfolio` | Yes | Bottom nav/Dashboard | Yes | Client auth | Primary; repeat portfolio fetch |
| Client | `/app/withdrawals` | Yes | None | **No** | Client auth | Orphan route/page; link from Portfolio or explicitly retire |
| Client | `/app/transactions` | Yes | Bottom nav/Dashboard/Portfolio | Yes | Client auth | Primary; query tab is not robustly synchronized |
| Client | `/app/statements` | Yes | Profile | Yes | Client auth | Secondary; bottom nav hidden |
| Client | `/app/notifications` | Yes | Profile | Yes | Client auth | Secondary; remote `deepLink` navigated without validation |
| Client | `/app/profile` | Yes | Bottom nav | Yes | Client auth | Primary |
| Client | `/app/profile/kyc` | Yes | Profile | Yes | Client auth | Current prefix rule incorrectly keeps bottom nav on this secondary page |
| Client | `/app/profile/security` | Yes | Profile | Yes | Client auth | Current prefix rule keeps bottom nav; modal duplication |
| Client | `/app/profile/support` | Yes | Profile/Blocked/grievance | Usually; **No for terminal account** | Client auth/account | `ClientLayout` intercepts terminal users and renders Blocked again |
| Client | `/app/profile/legal` | Yes | Profile | Yes | Client auth | Current prefix rule keeps bottom nav |
| Client | `/app/investor-charter` | Yes | Fund disclosure intended | **No via current default** | Client auth | Default link is `/investor-charter`, which falls to splash |
| Client | `/app/grievance` | Yes | Fund disclosure intended | **No via current default** | Client auth | Default link is `/grievance`, which falls to splash |
| Client | `/app/orders` | No | Mandate unavailable button | **Broken** | — | No route; inner wildcard sends user to splash |
| Client | unknown `/app/*` | No | Stale/invalid dynamic link | Wrong destination | — | Silently redirects to splash instead of Not Found |
| Client build | `/admin` | No | Defensive admin-user branch | Broken branch | Role check | Client APK does not mount Admin root; catch-all returns to client splash |

Current Client bottom navigation is shown for exact primary paths **and every descendant**. Thus Profile's KYC/Security/Support/Legal children keep the bottom bar, while Statements and Notifications (also Profile destinations) do not. The proposal makes shell visibility explicit per route rather than prefix-based.

## Admin

All Admin routes are protected by `RequireAdmin`. Backend routes enforce live fine-grained permissions, but the sidebar renders all destinations without checking `user.permissions`, so limited Admin roles can be shown destinations that reliably return 403.

| App | Route | Page exists | Navigation entry | Reachable | Guard | Problem |
|---|---|---:|---:|---:|---|---|
| Admin | `/` | Redirect | Launch/root | Yes | Public | Admin target redirects to splash |
| Admin | `/admin/splash` | Yes | Launch | Yes | Public/session bootstrap | Intentional 1.6s minimum |
| Admin | `/admin/login` | Yes | Auth/logout | Yes | Public | Restore/login path works |
| Admin | `/admin` | Redirect resolver | Splash/login | Yes | Admin | Resolves legacy `?tab=` or overview |
| Admin | `/admin/overview` | Yes | Sidebar | Yes | Admin + API permissions | Canonical |
| Admin | `/admin/users/approvals` | Yes | Sidebar/overview | Yes if permitted | Admin + applications permissions | UI not permission-filtered |
| Admin | `/admin/users/subscriptions` | Yes | Sidebar | Yes if permitted | Admin + read/finance permissions | Canonical |
| Admin | `/admin/users/payments` | Yes | Sidebar/overview | Yes if permitted | Admin + finance permissions | Canonical |
| Admin | `/admin/users/directory` | Yes | Sidebar/overview | Yes if permitted | Admin + users.read | Canonical |
| Admin | `/admin/users/directory/:userId` | Yes | No routed UI entry | Deep-link only | Admin + users.read | UI instead opens provider-state overlay with unchanged URL |
| Admin | `/admin/site/faqs` | Yes | Sidebar/overview | Yes if permitted | Admin + content permissions | Canonical |
| Admin | `/admin/app/builder` | Yes | Sidebar | Yes if permitted | Admin + config permissions | Accepts arbitrary client route strings |
| Admin | `/admin/ops/funds` | Yes | Sidebar/overview | Yes if permitted | Admin + finance/content | Canonical; 1,304-line monolith |
| Admin | `/admin/ops/holdings` | Yes | Sidebar | Yes if permitted | Admin + finance/read | Canonical |
| Admin | `/admin/ops/transactions` | Yes | Sidebar | Yes if permitted | Admin + finance/read | Canonical |
| Admin | `/admin/system/audit-log` | Yes | Sidebar/overview | Yes if permitted | Admin + audit/read | Canonical |
| Admin | `/admin/system/emails` | Yes | Sidebar | Yes if permitted | Admin + email/read | Canonical |
| Admin | `/admin/system/environment` | Yes | Sidebar | Yes if permitted | Admin + config/read | Canonical |
| Admin | `/admin/users/kyc` | Redirect only | None | Compatibility | Admin | Intentionally retired → approvals |
| Admin | `/admin/users/risk-profiles` | Redirect only | Legacy tab | Compatibility | Admin | Intentionally retired → approvals |
| Admin | `/admin/ops/ledger` | Redirect only | Legacy tab | Compatibility | Admin | Intentionally retired → transactions |
| Admin | `/admin/ops/sip-control` | Redirect only | Legacy tab | Compatibility | Admin | Intentionally retired → transactions |
| Admin | `/admin/system/support` | Redirect only | Legacy tab | Compatibility | Admin | Postponed feature → audit log |
| Admin | unknown `/admin/*` | No | Stale/invalid link | Wrong destination | Admin | Silently redirects to overview |

Admin APK support is present in the authoritative builder. Package.json's `build:android*` convenience scripts remain Client-only; they must not be mistaken for the release pipeline.

## Navigation trace examples

```text
Mandate unavailable button
  → navigate('/app/orders')
  → no matching Client route
  → ClientApp wildcard
  → /app/splash
  → visible symptom: apparent app restart

Fund disclosure link
  → API/default '/investor-charter'
  → outer ClientRoot wildcard (actual route is /app/investor-charter)
  → /app/splash
  → visible symptom: apparent app restart

Admin directory View
  → openUserDetail(id)
  → LegacyAdminDataProvider state
  → overlay mounted over unchanged URL
  → Android Back navigates underlying history instead of closing detail
```

---

# D. Root Cause Analysis

## Navigation

### D-N1 — Invalid routes are masked as relaunches

**Problem:** Unknown Client paths redirect to splash; unknown Admin paths redirect to overview.
**Evidence:** `frontend_stack/app/src/ClientRoot.jsx`, `frontend_stack/packages/client/src/ClientApp.jsx`, `frontend_stack/packages/admin/src/pages/Admin.jsx`; concrete broken targets in `MandateDetail.jsx` and `disclosureApi.js`.
**Likely root cause:** catch-alls were designed as recovery shortcuts instead of explicit route-error boundaries; route strings are duplicated across code and remote configuration.
**Affected files:** `ClientRoot.jsx`, `ClientApp.jsx`, `Admin.jsx`, `MandateDetail.jsx`, `FundDetail.jsx`, `disclosureApi.js`.
**Recommended solution:** introduce canonical route builders/metadata; validate remote target IDs; fix known targets; render a recoverable Not Found screen with Home/Back and telemetry rather than re-running splash.
**Risk:** medium—compatibility aliases must remain deliberate and tested.

### D-N2 — Valid routes are orphaned or intercepted

**Problem:** Withdrawals has no UI entry; mandate detail is data-only; terminal users cannot reach the support page advertised by Blocked.
**Evidence:** route/search trace across `ClientApp.jsx`, `Portfolio.jsx`, `Blocked.jsx`, and `ClientLayout.jsx`.
**Likely root cause:** route creation and navigation IA evolved independently; account-level layout interception has no exception list.
**Affected files:** `ClientApp.jsx`, `Portfolio.jsx`, `MandateDetail.jsx`, `Blocked.jsx`, `ClientLayout.jsx`.
**Recommended solution:** add Portfolio/transaction entries for legitimate history routes; define terminal-account allowed routes (Support and logout); retire any page that has no product workflow.
**Risk:** low-medium; support must not expose protected financial content.

### D-N3 — Dynamic destinations cross a trust boundary without validation

**Problem:** notification deep links, disclosure URLs, and Admin-published quick-action route strings are passed directly to React Router.
**Evidence:** `notificationsApi.js`, `Notifications.jsx`, `disclosureApi.js`, `FundDetail.jsx`, `AppBuilderScreen.jsx`, `Dashboard.jsx`, `shared/src/appConfig.js`.
**Likely root cause:** remote content models store raw paths instead of stable destination identifiers.
**Affected files:** all listed above plus backend app-config validation routes/schemas during implementation.
**Recommended solution:** publish stable destination IDs; resolve locally through an allowlisted route manifest; validate dynamic IDs and encode path parameters; distinguish internal, external, system-action and file destinations.
**Risk:** high if migration invalidates already published configuration; support old values through a bounded normalization layer.

### D-N4 — Admin role gate and permission-aware UI are misaligned

**Problem:** Admin session returns live `permissions`, backend endpoints enforce them, but navigation exposes every destination to every Admin-role principal.
**Evidence:** `authApi.js` retains permissions; `navigation/nav.js` has no permission metadata; `Sidebar.jsx` maps all domains; backend `adminAccess.ts`/routes require specific codes.
**Likely root cause:** frontend routing uses role-only admission while fine-grained RBAC landed only in the API.
**Affected files:** `BrowserRoot.jsx`, `navigation/nav.js`, `Sidebar.jsx`, `AdminShell.jsx`, page error states.
**Recommended solution:** keep backend enforcement; add route metadata with required-any permissions; hide/disable unauthorized nav entries and render an explicit 403 state for direct URLs.
**Risk:** high—frontend checks are presentation only and must never replace server authorization.

## Performance

### D-P1 — Client pages repeat reads on every mount

**Problem:** primary navigation remounts pages; Dashboard triggers five reads, Explore two, Portfolio another portfolio read, and `useAppConfig` is independently instantiated by multiple pages.
**Evidence:** `Dashboard.jsx`, `Explore.jsx`, `Portfolio.jsx`, `shared/src/useAppConfig.js`/`appConfig.js`; no query-cache dependency/provider exists.
**Likely root cause:** page-local `useEffect` state was simple initially but now duplicates domain data and in-flight work.
**Affected files:** Client root/layout, the listed pages, fund/portfolio/research/order services.
**Recommended solution:** shell-level domain query cache with immutable snapshots, in-flight de-duplication, explicit stale times, retained previous data, mutation invalidation and background refresh. Prefetch the next likely secondary route; do not cache live financial values without `asOf`/stale presentation.
**Risk:** high—incorrect invalidation can show stale balances as current.

### D-P2 — Admin preloads and refreshes unrelated domains

**Problem:** `LegacyAdminDataProvider` fetches six collections for every Admin route and broad mutations often reload all six. New screens also use local list hooks. Its context value is not memoized.
**Evidence:** `LegacyAdminDataContext.jsx` parallel load and provider value; newer FAQs/transactions/email/user screens.
**Likely root cause:** a dashboard-era global provider became a general repository and overlay controller.
**Affected files:** `LegacyAdminDataContext.jsx`, `AdminShell.jsx`, legacy route wrappers and screen hooks.
**Recommended solution:** split by domain; Overview fetches lightweight counts, screens fetch their own paginated datasets through a shared cache, mutations invalidate only affected keys, approval polling runs only while relevant/visible. Remove provider-global user-detail overlay.
**Risk:** high—Admin operations and optimistic updates need route-by-route regression coverage.

### D-P3 — Bundle/chunk boundaries do not match routes

**Problem:** `ClientApp.jsx` and `Admin.jsx` eagerly import every page; Vite groups whole packages; Client/Admin CSS barrels import all pages; global Razorpay loads every boot.
**Evidence:** `ClientApp.jsx`, `Admin.jsx`, `vite.config.js`, client `styles/mobile/index.css`, admin CSS imports, `index.html`. Existing `dist` is about 1.1 MB raw, including ~206 KB Admin JS, ~195 KB vendor JS, ~106 KB Client CSS, ~87 KB Admin CSS, and multiple unused-script font subsets.
**Likely root cause:** manual chunks are package-based rather than route-based; fonts import all character sets/formats; payment script is global.
**Affected files:** `vite.config.js`, route roots, CSS imports, `design-tokens/src/tokens.css`, `index.html`.
**Recommended solution:** lazy-load secondary/admin domain routes; preserve shell/primary critical code; make component/page CSS follow route imports; subset/load only necessary font weights/scripts/formats; load Razorpay at payment initiation with typed failure state.
**Risk:** medium—over-splitting can add request overhead; measure compressed chunks and first-use latency.

## Mobile Responsiveness

### D-R1 — Admin is desktop IA compressed to phone width

**Problem:** 13 routes become a horizontally scrolling fixed bottom strip with 40px target compromises; dense tables/forms retain desktop mental models.
**Evidence:** `navigation/nav.js`, `Sidebar.jsx`, `styles/desktop/shell.css` mobile block, `admin-responsive.css`, DataTable and AUM/AppBuilder screens.
**Likely root cause:** CSS adaptation was applied before a distinct mobile Admin information architecture.
**Affected files:** Admin shell/navigation/CSS and all dense operational screens.
**Recommended solution:** persistent compact top bar plus 4–5 domain entry points and a More/drawer/domain hub; use list-summary-detail, responsive field groups and bottom sheets/drawers rather than horizontally squeezing every control.
**Risk:** medium-high; high-frequency Admin workflows need operator validation.

### D-R2 — Responsive primitives exist but page patterns still drift

**Problem:** page-owned headings, raw cards, duplicated sheets/modals, arbitrary targets and serif task headings make screens feel like styled web pages rather than one application.
**Evidence:** client mobile CSS and click-div patterns in Dashboard, Explore, Profile, Support and StartSip; `.ash-*`/`.adm-*` coexistence.
**Likely root cause:** tokens landed without enforcing a small set of structural primitives.
**Affected files:** design tokens, Client layout/components/page CSS, Admin shell/screen CSS.
**Recommended solution:** consolidate existing styles into Page, AppBar/PageHeader, Section, List/Card, ActionBar, FormField, BottomSheet/Dialog, Skeleton, Empty/Error patterns. Keep Fraunces for selective brand/hero use; use Instrument Sans for task/navigation/data UI and JetBrains Mono only for identifiers.
**Risk:** low-medium; BOE identity must not be flattened into generic Material styling.

## Safe Areas

### D-S1 — Android inset fallback is defined by Capacitor but not consumed

**Problem:** viewport-fit is correct and BOE uses `env(safe-area-inset-*)`, but Capacitor 8 injects `--safe-area-inset-*` to fix Android WebViews where `env()` is wrong. BOE ignores it and duplicates variable names.
**Evidence:** `index.html`, `app/src/index.css`, client `base.css`, Admin `shell.css`/responsive CSS; Capacitor 8 local SystemBars documentation/implementation.
**Likely root cause:** CSS predates/currently bypasses Capacitor 8 SystemBars CSS inset handling.
**Affected files:** `capacitor.config.json`, global CSS, client shell/app bar/bottom nav/sheets, Admin top/bottom/drawer/toast CSS.
**Recommended solution:** one global token per edge: `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`; explicitly set SystemBars `insetsHandling: css`; apply insets to structural chrome and overlay footers, including landscape left/right.
**Risk:** medium—avoid double application from parent and child.

### D-S2 — Admin and overlays have local gaps

**Problem:** Admin mobile identity/top controls, toast positions and drawers do not consistently reserve top/bottom insets; Client toast/action values also contain hard-coded offsets.
**Evidence:** Admin shell/admin responsive/overlay CSS and Client components/layout CSS.
**Likely root cause:** safe areas are implemented page/component-by-component.
**Affected files:** `AdminShell.jsx`, `Sidebar.jsx`, `TopBar.jsx`, `Drawer.jsx`, corresponding CSS, Client `components.css`/`layout.css`.
**Recommended solution:** shell-owned safe regions and semantic chrome measurements; overlays use the same tokens; page code never reads raw `env()`.
**Risk:** low once global contract is in place.

## Pinch Zoom

### D-Z1 — No explicit end-to-end zoom contract

**Problem:** current viewport allows scaling and Capacitor config omits `android.zoomEnabled`; observed runtime still pinches despite Capacitor 8's nominal non-zoom default.
**Evidence:** `app/index.html`, `capacitor.config.json`; generated Capacitor config; Capacitor Bridge/WebSettings implementation.
**Likely root cause:** relying on an implicit native default while HTML remains zoomable and/or a tested WebView path honors viewport gesture scaling.
**Affected files:** `index.html`, `capacitor.config.json`, conditionally `MainActivity.java`.
**Recommended solution:** explicitly set Android `zoomEnabled: false`. For the APK build, use a fixed-scale viewport (`maximum-scale=1`, `minimum-scale=1`, `user-scalable=no`) while retaining `viewport-fit=cover`; if web accessibility must retain pinch, inject that viewport only for native target. Add MainActivity `WebSettings` defense only if device tests show config+viewport is insufficient. Never set Android font scale/text zoom to 100 or suppress all touch gestures.
**Risk:** accessibility trade-off. Validate 100–200% OS font/display size, TalkBack and reflow; page zoom suppression must not suppress text scaling.

## Global Layout

### D-G1 — Shells exist but responsibilities are incomplete

**Problem:** Client keeps bottom navigation mounted but primary headers/identity/actions are page-owned; secondary bottom-nav visibility is inferred by path prefix. Admin persists chrome but provider/data/overlay responsibilities are entangled.
**Evidence:** `ClientLayout.jsx`, Client primary pages; `AdminShell.jsx`, `LegacyAdminDataContext.jsx`.
**Likely root cause:** shells were introduced as visual wrappers rather than explicit navigation/bootstrap/data boundaries.
**Affected files:** both shell/layouts and route metadata.
**Recommended solution:** retain both shells; add route metadata for header mode, parent, bottom-nav visibility and permissions; keep system bars/network/toasts/overlay registry above target shells; move page data out of shell-global providers.
**Risk:** medium; route migration must preserve public/auth/lock/account states.

## Android Back Behavior

### D-B1 — WebView history is the only back stack

**Problem:** no `App.addListener('backButton')`; BottomNav pushes ordinary entries; AppBar defaults to `navigate(-1)`; completed flows push Home; React overlays are invisible to native Back.
**Evidence:** `platform/lifecycle.js`, `BottomNav.jsx`, `AppBar.jsx`, payment/mandate pages, `MainActivity.java`; no listener in repository.
**Likely root cause:** Capacitor App is used only for lifecycle.
**Affected files:** `main.jsx`, roots/shells, AppBar/BottomNav, BottomSheet/Drawer, transaction screens.
**Recommended solution:** one shared LIFO back coordinator: close top overlay → transactional cancel policy → pop secondary route with logical parent → non-Home primary replaces to Home → root minimizes/exits by product policy. Use explicit fallback parents and prune successful transaction history.
**Risk:** high—register once, remove listeners, test process resume and predictive Back.

## Loading

### D-L1 — Blank and global loading states replace stable structure

**Problem:** `RequireAdmin`, `ClientLayout`, and `RequireApproved` return `null`; root Suspense uses a 100dvh spinner; pages often replace content rather than retain it.
**Evidence:** `BrowserRoot.jsx`, `ClientLayout.jsx`, `ClientApp.jsx`, `PageLoader.jsx`, page loading branches.
**Likely root cause:** auth/data states are boolean rather than typed bootstrap/query states.
**Affected files:** roots/providers/guards, PageLoader, major pages.
**Recommended solution:** branded shell/bootstrap placeholder during first restore; skeletons matching final geometry; retained previous content during background refresh; widget-level loading/errors; no shell disappearance.
**Risk:** low-medium; financial stale states must show `asOf` and refreshing indicators.

### D-L2 — API failures are frequently presented as empty data

**Problem:** many catches set `[]`/`null`, making timeout/403/backend outage look like “no transactions/funds/FAQs.”
**Evidence:** Support, Notifications, Admin provider and screen-local hooks.
**Likely root cause:** loading/data/error are conflated.
**Affected files:** all data-bearing pages/providers and shared API error mapping.
**Recommended solution:** standardized query state `{status,data,error,isRefreshing,updatedAt}`; empty state only after successful empty response; timeout/offline/permission errors remain distinct with bounded retry.
**Risk:** low; copy and compliance review needed for stale financial data wording.

## API/Data Fetching

### D-A1 — Release-native origin may be rejected by committed allowlists

**Problem:** APK content origin is `https://localhost`, but committed dev/prod `WEB_ORIGIN_ALLOWLIST` examples omit it. CORS reflects only explicitly allowed origins.
**Evidence:** `capacitor.config.json`, backend `http/cors.ts`, `release_manager/stacks/*/.env.example`; local backend env/comments/tests know about the native origin.
**Likely root cause:** release examples drifted from the native bearer/CORS contract.
**Affected files:** dev/prod env examples, backend production example, `DEPLOY.md`, CORS integration/deploy validation tests.
**Recommended solution:** explicitly include exact `https://localhost` only for backends serving APKs; keep browser Admin cookies same-site and native Admin bearer; validate actual release WebView Origin/preflight. Never use `*`.
**Risk:** high—omission freezes the APK; overbroad allowlisting weakens web auth.

### D-A2 — No centralized connectivity/staleness contract

**Problem:** transport timeout exists, but screens independently decide retry/empty behavior; there is no global offline/reconnect state.
**Evidence:** `_util.js`, page catches, absence of Capacitor Network plugin/provider.
**Likely root cause:** API transport was centralized before product-level failure behavior.
**Affected files:** app root/native layer, query cache, error/empty components.
**Recommended solution:** shared connectivity provider using browser online/offline plus a backend probe, or Capacitor Network only if device tests justify it; exponential bounded retries for idempotent reads; no automatic retry of financial writes without idempotency; label cached values with timestamp and offline state.
**Risk:** high for writes; never pretend cached financial data is live.

## UI/UX

### D-U1 — Mouse semantics and small targets remain

**Problem:** clickable `div`s, anchor without `href`, non-keyboard toggles, 36–40px controls and cramped admin actions are present. BottomNav uses tab roles for route links.
**Evidence:** Dashboard, Explore, Profile, Support, StartSip, Admin CSS/components.
**Likely root cause:** visual interactivity was added without semantic component enforcement.
**Affected files:** those pages plus shared Button/ListRow/Card/Nav primitives.
**Recommended solution:** semantic button/link elements, at least 48dp comfortable Android targets (WCAG absolute minimum remains lower), visible focus, no hover-only affordance, correct link semantics and labels. Suppress tap highlight/text dragging only on controls/ornament, not content.
**Risk:** low.

### D-U2 — Dialog/modal implementations are duplicated

**Problem:** shared BottomSheet and Admin Drawer trap focus, but Transactions, Statements, MandateDetail, Security and Portfolio implement manual overlays with inconsistent focus/body-lock/Back behavior.
**Evidence:** listed page modal blocks and shared layout components.
**Likely root cause:** page-specific flows predate shared modal primitives.
**Affected files:** `BottomSheet.jsx`, `Drawer.jsx`, listed pages and overlay CSS.
**Recommended solution:** one adaptive overlay contract (dialog on large layouts, bottom sheet/full-height flow on phone), portal, focus trap/restore, body lock, Back registration, safe areas and destructive confirmation variants.
**Risk:** medium; form state and confirmation semantics must persist.

### D-U3 — Financial hierarchy needs consistency, not generic Material styling

**Problem:** nested cards, warm decorative serif headings, repeated page headers, inconsistent data/status layouts and table compression reduce precision.
**Evidence:** Client Dashboard/Explore/FundDetail, Admin operational screens and CSS coexistence.
**Likely root cause:** BOE web brand treatments were applied to task UI without a mobile financial information hierarchy.
**Affected files:** tokens and page styles/components.
**Recommended solution:** preserve BOE blue/red/ivory and selective Fraunces brand moments; use stable sans task hierarchy, tabular monetary values, explicit sign/currency/percentage/as-of rules, grouped lists instead of card-on-card, and restrained elevation.
**Risk:** low if tokens and business meaning remain unchanged.

## Capacitor/Android Integration

### D-C1 — WebView security policy is globally permissive

**Problem:** `allowMixedContent: true` and `server.cleartext: true` are global even though distributed endpoints must be HTTPS and native network config otherwise defaults closed.
**Evidence:** `capacitor.config.json`, copied generated config, `network_security_config.xml`, build target validation.
**Likely root cause:** local emulator HTTP support leaked into the common config.
**Affected files:** Capacitor config, Android network config, Android env modes, builder/artifact validation.
**Recommended solution:** distributed configs disable mixed content; isolate emulator HTTP through target-specific config or local HTTPS proxy; assert final APK policy.
**Risk:** high for local workflow; security improvement for release.

### D-C2 — Native system bars, launch theme and IME are implicit

**Problem:** SystemBars style is never set; launch theme lacks an explicit post-splash contract; WebView/HTML first background is not synchronized; manifest has no explicit `adjustResize`.
**Evidence:** `styles.xml`, `AndroidManifest.xml`, `main.jsx`, `index.html`, absence of SystemBars calls/Keyboard plugin.
**Likely root cause:** native theme and web shell evolved separately.
**Affected files:** native theme/manifest, Capacitor config, native integration root, splash/CSS.
**Recommended solution:** explicit visible bars/icon style, Android 12+ splash/post theme, pixel-matched initial background, SystemBars CSS insets, measured `adjustResize`, IME-aware bottom chrome. Keep the 1.6s React hold.
**Risk:** medium—validate pre/post Android 12 and target SDK 36 edge-to-edge.

### D-C3 — Native credentials bypass installed Secure Storage

**Problem:** `_util.js` stores Client/Admin access and refresh tokens in WebView localStorage; Android backup is enabled.
**Evidence:** `_util.js`, `authApi.js`, `platform/storage.js`, manifest.
**Likely root cause:** synchronous request token access predates secure async bootstrap.
**Affected files:** auth utility/API, storage adapter, session providers, manifest and a new vault module.
**Recommended solution:** restore native tokens once from Secure Storage into memory; atomically persist rotations; fail closed on native secure-store failure; bounded one-time migration/removal of old localStorage tokens; disable/exclude backups.
**Risk:** **critical**—refresh-token rotation/session migration requires dedicated security review and rollback plan.

### D-C4 — Build variants are functional but non-hermetic

**Problem:** launcher/splash assets are copied into `src/main/res`, final branding depends on build order, and bundle isolation checks filenames rather than final APK contents.
**Evidence:** `emu/boe_update.sh`, `check-android-dist.mjs`, existing Admin artifact containing both broad Client/Admin assets.
**Likely root cause:** variants were added at script level before Gradle flavor/source-set architecture.
**Affected files:** `build.gradle`, launcher resources/generator, builder, guard/release tests, Vite config.
**Recommended solution:** Gradle product flavors/source sets or generated resource dirs preserving exact installed IDs/signing lineage; manifest-driven module graph and final-APK byte/target checks; clean-worktree build gate.
**Risk:** high—application IDs and signing certificates determine update compatibility.

---
# E. Targeted File List

Every path in this table exists in the repository. “Modify” means a future implementation task; this audit did not edit it.

| Priority | File | Purpose | Proposed change | Scope |
|---|---|---|---|---|
| P0 | `frontend_stack/app/capacitor.config.json` | WebView/native policy | Explicit zoom disabled; SystemBars CSS insets; release-safe mixed-content/cleartext policy | Shared Android |
| P0 | `frontend_stack/app/index.html` | Viewport/first paint/scripts | Native no-page-zoom viewport strategy; remove duplicate main landmark; pixel-match launch background; defer Razorpay | Shared/target-aware |
| P0 | `frontend_stack/app/src/index.css` | Global viewport/safe areas | One Capacitor-fallback inset contract and stable root background | Shared |
| P0 | `frontend_stack/app/src/main.jsx` | Bootstrap root | Mount target-neutral native/bootstrap/network/back/session foundations once | Shared |
| P0 | `frontend_stack/app/src/ClientRoot.jsx` | Client root routes | Stable bootstrap, explicit Not Found, provider placement, no splash catch-all | Client |
| P0 | `frontend_stack/app/src/BrowserRoot.jsx` | Admin root routes | Remove unused Client session provider, visible bootstrap, permission-aware root, explicit Not Found | Admin |
| P0 | `frontend_stack/packages/client/src/ClientApp.jsx` | Client route map/eligibility | Canonical metadata, route lazy loading later, cached eligibility, non-blank guard | Client |
| P0 | `frontend_stack/packages/client/src/layout/ClientLayout.jsx` | Authenticated shell | Terminal support exception, explicit chrome policy, stable shell, native Back/IME hooks | Client |
| P0 | `frontend_stack/packages/client/src/pages/Blocked.jsx` | Terminal account UX | Make Support/logout actually reachable | Client |
| P0 | `frontend_stack/packages/client/src/pages/MandateDetail.jsx` | Mandate route/flow | Remove dead `/app/orders`, parallelize reads, canonical dialog/back parent | Client |
| P0 | `frontend_stack/packages/client/src/services/disclosureApi.js` | Disclosure targets | Correct `/app/...` fallbacks and normalize internal/external destination type | Client |
| P0 | `frontend_stack/packages/client/src/pages/FundDetail.jsx` | Fund details/links | Route through validated resolver; canonical Back/share; simplify dense mobile layout | Client |
| P0 | `frontend_stack/packages/client/src/services/notificationsApi.js` | Notification boundary | Validate/normalize route-family payloads | Client |
| P0 | `frontend_stack/packages/client/src/pages/Notifications.jsx` | Dynamic navigation | Resolve allowlisted targets; typed error/retained state | Client |
| P0 | `frontend_stack/packages/admin/src/screens/AppBuilderScreen.jsx` | Published mobile config | Replace free-text paths with valid destination IDs and schema validation | Admin→Client |
| P0 | `frontend_stack/packages/shared/src/appConfig.js` | Shared config/defaults | Stable target IDs, single cache/background refresh, validated published config | Shared |
| P0 | `frontend_stack/packages/client/src/services/_util.js` | Transport/tokens | In-memory native token reads backed by Secure Storage; instrumentation/dedup hooks | Shared auth/API |
| P0 | `frontend_stack/packages/client/src/services/authApi.js` | Client/Admin auth | Async secure bootstrap/migration while preserving native bearer and web cookie contracts | Shared auth |
| P0 | `frontend_stack/packages/client/src/platform/storage.js` | Native storage adapter | Fail-closed credential API and migration helpers, separate preferences from secrets | Shared native |
| P0 | `frontend_stack/packages/client/src/store/SessionContext.jsx` | Client restore | Typed, memoized bootstrap/session state; start work beneath splash | Client |
| P0 | `frontend_stack/packages/client/src/store/AdminSessionContext.jsx` | Admin restore | Same bootstrap contract with live permissions | Admin/shared auth |
| P0 | `frontend_stack/app/android/app/src/main/AndroidManifest.xml` | Native task/security/IME | Backup policy, explicit IME resize, later verified deep links, task-preview decision | Shared Android |
| P0 | `frontend_stack/app/android/app/src/main/java/com/beonedge/app/MainActivity.java` | Native bridge | Conditional zoom WebSettings defense and selected privacy/task behavior only when required | Shared Android |
| P0 | `release_manager/stacks/dev_release/.env.example` | Dev backend origins | Add exact APK origin `https://localhost` to explicit allowlist | Dev release |
| P0 | `release_manager/stacks/prod_release/.env.example` | Prod backend origins | Add exact APK origin to explicit allowlist | Prod release |
| P0 | `backend_controller/.env.production.example` | Backend contract example | Align documented exact native origin | Backend/release |
| P0 | `backend_controller/src/http/cors.test.ts` | Origin regression tests | APK Origin/preflight allow/deny coverage | Backend |
| P1 | `frontend_stack/packages/client/src/layout/BottomNav.jsx` | Primary nav | Correct link semantics, tab history replace/reset, 48dp/safe-area/IME behavior | Client |
| P1 | `frontend_stack/packages/client/src/layout/AppBar.jsx` | Secondary nav | Logical fallback parent instead of unconditional `navigate(-1)` | Client |
| P1 | `frontend_stack/packages/client/src/layout/BottomSheet.jsx` | Overlay primitive | Portal/panel semantics/body lock/safe areas/back registry | Shared candidate |
| P1 | `frontend_stack/packages/admin/src/layout/Drawer.jsx` | Admin overlay | Participate in common overlay/back stack; keep strong focus/body lock | Admin |
| P1 | `frontend_stack/packages/admin/src/layout/AdminShell.jsx` | Admin persistent shell | Grouped phone nav, permission/context hosts, safe areas | Admin |
| P1 | `frontend_stack/packages/admin/src/layout/Sidebar.jsx` | Admin navigation | Desktop sidebar + mobile grouped drawer, permission-filtered entries | Admin |
| P1 | `frontend_stack/packages/admin/src/layout/TopBar.jsx` | Admin app bar | Safe-area-aware identity/menu/context/action header | Admin |
| P1 | `frontend_stack/packages/admin/src/navigation/nav.js` | Admin route metadata | Permissions, priority, parent, mobile visibility and route metadata | Admin |
| P1 | `frontend_stack/packages/admin/src/pages/Admin.jsx` | Admin routes | Lazy domain screens, routed detail, explicit Not Found/Forbidden | Admin |
| P1 | `frontend_stack/packages/admin/src/context/LegacyAdminDataContext.jsx` | Legacy global data | Split domain queries; remove global detail overlay and six-resource bootstrap | Admin |
| P1 | `frontend_stack/packages/admin/src/screens/UserDetailsListScreen.jsx` | Directory | Navigate to routed detail; mobile list/detail pattern | Admin |
| P1 | `frontend_stack/packages/admin/src/screens/UserDetailScreen.jsx` | User detail | Canonical route/detail sections and phone-safe actions | Admin |
| P1 | `frontend_stack/packages/shared/src/motion/PageTransition.jsx` | Route motion | Remove whole-route hide/translate; narrow or eliminate on primary tabs | Shared |
| P1 | `frontend_stack/packages/shared/src/motion/FadeIn.jsx` | Reveal motion | Stop mass staged reveals/persistent `will-change` | Shared |
| P1 | `frontend_stack/app/src/components/PageLoader.jsx` | Root loading | Branded bootstrap only; no routine full-app spinner | Shared |
| P1 | `frontend_stack/app/src/components/RootErrorBoundary.jsx` | Global errors | App-oriented recovery, offline/session paths, no default “Refresh page” reload | Shared |
| P1 | `frontend_stack/packages/shared/src/components/ErrorBoundary.jsx` | Error primitive | Recoverable route/widget boundaries without browser-oriented full reload | Shared |
| P1 | `frontend_stack/packages/admin/src/hooks/useAdminCollection.js` | Admin query hook | Retained data, common error/stale timestamps/cache keys | Admin |
| P1 | `frontend_stack/packages/admin/src/hooks/useAdminList.js` | Admin paginated query | Same contract while preserving cursor/stale-response handling | Admin |
| P1 | `frontend_stack/packages/client/src/hooks/useAppConfig.js` | Config fetch | Become provider/cache consumer rather than per-use fetch | Client |
| P1 | `frontend_stack/packages/client/src/pages/Splash.jsx` | Client launch | Keep 1600ms; overlap session/reachability/update/preload; typed offline recovery | Client |
| P1 | `frontend_stack/packages/admin/src/pages/AdminSplash.jsx` | Admin launch | Keep 1600ms; overlap restore/preload; extract target-specific splash CSS | Admin |
| P1 | `frontend_stack/packages/client/src/components/AppUpdateGate.jsx` | Update bootstrap | Run beneath splash without blocking unrelated shell after decision | Client/native |
| P1 | `frontend_stack/app/android/app/src/main/res/values/styles.xml` | Native splash/bars | Android 12+ splash and post-splash theme; WebView handoff continuity | Shared Android |
| P1 | `frontend_stack/packages/client/src/styles/mobile/base.css` | Client shell CSS | Consume global insets; remove duplicate safe variables | Client |
| P1 | `frontend_stack/packages/client/src/styles/mobile/components.css` | Fixed controls/toast | Safe-area/48dp/IME/overlay positioning | Client |
| P1 | `frontend_stack/packages/client/src/styles/mobile/layout.css` | Page/sheet/action layout | Consolidate primitives, safe footer/sheet geometry | Client |
| P1 | `frontend_stack/packages/client/src/styles/mobile/auth.css` | Auth/splash | Global inset variables and launch continuity | Client |
| P1 | `frontend_stack/packages/admin/src/styles/desktop/shell.css` | Admin responsive shell | Replace 13-item scroll strip; semantic layers/targets/insets | Admin |
| P1 | `frontend_stack/packages/admin/src/styles/admin/admin-base.css` | Legacy Admin base | Consume shared insets/tokens; remove competing root assumptions | Admin |
| P1 | `frontend_stack/packages/admin/src/styles/admin/admin-responsive.css` | Legacy phone rules | Migrate from horizontal/table compression to responsive patterns | Admin |
| P1 | `frontend_stack/packages/admin/src/styles/admin/admin-overlays.css` | Legacy overlays | Safe-area/keyboard/overlay hierarchy | Admin |
| P1 | `frontend_stack/packages/design-tokens/src/tokens-core.css` | Design system | Canonical 48dp targets, chrome sizes, type/data rules, semantic z levels | Shared |
| P1 | `frontend_stack/app/vite.config.js` | Production chunks | Route/target-aware splitting and byte budgets | Shared build |
| P1 | `frontend_stack/app/scripts/check-android-dist.mjs` | Artifact guard | Manifest/module graph and final target-policy assertions | Shared build |
| P1 | `frontend_stack/app/android/app/build.gradle` | Native variants | Source sets/flavors/generated resources while preserving exact IDs/signing | Android build |
| P1 | `emu/boe_update.sh` | APK orchestrator | Stop mutating tracked resources; pass explicit policy/variant; validate final APK | Release build |
| P1 | `frontend_stack/app/android/app/src/main/res/xml/network_security_config.xml` | Cleartext trust | Keep default deny; align only measured emulator exception strategy | Android network |
| P1 | `release_manager/FACTS_VS_PLAN.md` | Architecture facts | Correct stale Admin APK/application-ID statements | Release docs |
| P1 | `release_manager/lib/apk_ship.sh` | Release errors | Correct stale message claiming only debug APK output | Release |
| P2 | `frontend_stack/packages/client/src/pages/Dashboard.jsx` | Client Home | Use cache, semantic actions, stable skeleton, less card nesting | Client |
| P2 | `frontend_stack/packages/client/src/pages/Explore.jsx` | Product discovery | Cached data, semantic cards, simplified hierarchy/filters | Client |
| P2 | `frontend_stack/packages/client/src/pages/Portfolio.jsx` | Holdings/redemption | Cache/as-of state, withdrawal entry, canonical redemption overlay | Client |
| P2 | `frontend_stack/packages/client/src/pages/Transactions.jsx` | Activity | Cached filter keys, URL sync, accessible tabs, canonical detail overlay | Client |
| P2 | `frontend_stack/packages/client/src/pages/Statements.jsx` | Statements | Canonical overlay and retained/error state | Client |
| P2 | `frontend_stack/packages/client/src/pages/Security.jsx` | Security | Canonical protected overlay/keyboard and lifecycle behavior | Client |
| P2 | `frontend_stack/packages/client/src/pages/Support.jsx` | Help/forms | Semantic accordion/labels, caught submit errors, native email action | Client |
| P2 | `frontend_stack/packages/client/src/pages/Profile.jsx` | Account hub | Semantic route rows; consistent secondary chrome | Client |
| P2 | `frontend_stack/packages/client/src/pages/StartSipSheet.jsx` | SIP flow | Durable flow state, keyboard-safe steps, semantic controls | Client |
| P2 | `frontend_stack/packages/client/src/pages/LumpsumSheet.jsx` | One-time flow | Same transaction-flow architecture | Client |
| P2 | `frontend_stack/packages/client/src/pages/PaymentStatus.jsx` | Payment state | Explicit timeout/retry and completed-history pruning | Client |
| P2 | `frontend_stack/packages/client/src/pages/MandateAuth.jsx` | Mandate auth | Completed-history pruning and native lifecycle/back contract | Client |
| P2 | `frontend_stack/packages/client/src/pages/GrievanceRedressal.jsx` | External/system actions | Central native browser/email handling and failed-load state | Client |
| P2 | `frontend_stack/packages/client/src/components/Charts.jsx` | Financial charts | Remove 3D filters; responsive, accessible, lower-cost charts | Client |
| P2 | `frontend_stack/packages/admin/src/components/DataTable.jsx` | Admin tables | Explicit row actions and list/card alternative on phone | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/ApprovalsScreen.jsx` | Admin workflow | Retained state, 48dp actions, phone decision detail | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/PaymentsScreen.jsx` | Admin finance | Mobile master-detail and guarded actions | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/MandatesScreen.jsx` | Admin subscriptions | Mobile master-detail pattern | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/TransactionsScreen.jsx` | Admin operations | Responsive event list/detail | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/HoldingsScreen.jsx` | Admin holdings | Compact summary/list hierarchy | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/AuditLogScreen.jsx` | Audit | Responsive event stream/filter sheet | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/EmailDeliveriesScreen.jsx` | Email logs | Responsive list/status detail | Admin |
| P2 | `frontend_stack/packages/admin/src/screens/AumScreen.jsx` | Fund operations | Split 1,304-line workflow into routed/domain mobile tasks | Admin |

---

# F. New Files That May Be Needed

These are proposed paths, not existing files, and were not created.

| Proposed new file | Why needed / why an existing file is not a clean owner | Imported by | Sharing |
|---|---|---|---|
| `frontend_stack/app/src/platform/NativeAppRoot.jsx` | Native integration must mount exactly once above either target; neither ClientLayout nor AdminShell should own the other target's system behavior | `main.jsx` | Client/Admin |
| `frontend_stack/app/src/platform/NativeBackCoordinator.jsx` | Back is a cross-cutting LIFO state machine, not lifecycle.js's pause/resume concern | NativeAppRoot, shells/overlay registry | Client/Admin |
| `frontend_stack/app/src/platform/SystemBarsController.jsx` | Owns SystemBars visibility/style and reapplication across resume/surface changes | NativeAppRoot | Client/Admin |
| `frontend_stack/app/src/platform/NetworkStatusProvider.jsx` | Centralizes offline/probe/reconnect and stale-data wording; transport utility should remain request-focused | NativeAppRoot/query status UI | Client/Admin |
| `frontend_stack/app/src/platform/OverlayStackContext.jsx` | Page-state overlays need a common LIFO Back/escape contract without moving every dialog into router state | BottomSheet, Drawer, manual overlays during migration | Client/Admin |
| `frontend_stack/packages/shared/src/auth/NativeSessionVault.js` | Async secure credential persistence plus synchronous in-memory request access is a distinct security boundary | authApi, `_util`, session providers | Client/Admin native |
| `frontend_stack/packages/shared/src/data/ResourceCacheProvider.jsx` | Query ownership/in-flight de-dup/stale timestamps/invalidation should not live in pages or the Admin legacy provider | target roots and domain hooks | Client/Admin foundation |
| `frontend_stack/packages/client/src/navigation/routes.js` | Client paths currently drift across JSX, notifications, disclosures and published config; one manifest supplies builders, parents, shell mode and validation | ClientApp, nav, resolvers, Admin builder schema | Client + Admin publisher |
| `frontend_stack/packages/admin/src/navigation/routes.js` | Only if existing `nav.js` cannot cleanly expand to canonical route/permission metadata; avoid creating both permanently | Admin route/shell | Admin |
| `frontend_stack/packages/shared/src/components/AsyncState.jsx` | Standard first-load skeleton, retained refresh, empty/error/offline states without copying branches per page | Client/Admin pages | Shared |
| `frontend_stack/packages/shared/src/components/AdaptiveDialog.jsx` | Existing BottomSheet/Drawer can be consolidated behind one accessible contract; page manual modals should not each implement focus/body/back logic | Transactional pages/Admin editors | Shared behavior, target variants |
| `frontend_stack/packages/client/src/pages/NotFound.jsx` | Unknown Client paths need recoverable UI rather than splash; RootErrorBoundary is for crashes, not route misses | Client routes | Client |
| `frontend_stack/packages/admin/src/pages/NotFound.jsx` | Admin unknown paths need an Admin-shell-aware state | Admin routes | Admin |
| `frontend_stack/packages/admin/src/pages/Forbidden.jsx` | Direct URLs without permission require explicit 403 distinct from missing/empty content | Admin routes | Admin |
| `frontend_stack/app/src/platform/__tests__/NativeBackCoordinator.test.jsx` | Back priority/history is high-risk and has no current tests | Test runner | Shared |
| `frontend_stack/packages/client/src/navigation/routes.test.js` | Locks every Client route, alias, dynamic target and parent | Test runner | Client |
| `frontend_stack/packages/admin/src/navigation/routes.test.js` | Locks Admin canonical/legacy/permission metadata | Test runner | Admin |

Do not add all files mechanically. During implementation, keep `nav.js` if it can become the canonical Admin manifest; keep Network on web events/probe unless device evidence justifies adding `@capacitor/network`; keep MainActivity unchanged if config+viewport reliably disable zoom.

---

# G. Files That Should Be Consolidated or Removed Later

Nothing should be removed before import, route, behavior and screenshot tests prove the replacement.

| Candidate | Later disposition | Prerequisite |
|---|---|---|
| `frontend_stack/packages/admin/src/context/LegacyAdminDataContext.jsx` | Remove after its six datasets, mutations and user-detail overlay move to domain resources/routes | All legacy consumers migrated |
| `frontend_stack/packages/admin/src/pages/legacy/legacyRoutes.jsx` | Fold wrappers into domain route modules | Admin route tests and each screen migrated |
| Manual modal blocks in Portfolio, Transactions, Statements, MandateDetail, Security | Replace with AdaptiveDialog/BottomSheet | Overlay behavior tests and form-state tests |
| `frontend_stack/packages/shared/src/motion/PageTransition.jsx` as a whole-route wrapper | Remove or reduce to non-hiding content transition | Perceived-latency/reduced-motion comparison |
| Broad `FadeIn` call sites | Remove staged reveal chains; keep rare purposeful reveals | Visual regression |
| Client duplicate safe variables in `styles/mobile/base.css` | Consume authoritative global variables | SystemBars/safe-area contract complete |
| Duplicate Client `.be-page-header/.be-section/.be-card` and Admin layout primitives | Consolidate behavior/tokens, retain branded variants | Design-system migration |
| Admin `.adm-*` and `.ash-*` parallel shell/layout rules | Retire legacy rules by domain | All referenced legacy screens migrated |
| Full Client CSS import from `AdminLogin.jsx` and `AdminSplash.jsx` | Extract only auth/splash styles | Target CSS split |
| Global Razorpay tag in `app/index.html` | Replace with payment-entry loader | Payment failure/CSP tests |
| Unneeded Fontsource subsets/formats | Stop emitting after language support is confirmed | Product language decision and font payload baseline |
| Stale claims in `release_manager/FACTS_VS_PLAN.md` and `apk_ship.sh` message | Correct documentation/error copy | None; safe quick win |
| `frontend_stack/app/android/app/src/main/res/layout/activity_main.xml` | Do not target for WebView fixes; consider removal only if confirmed unused by every build | Android resource/reference check |

---

# H. Global App Shell Proposal

Retain distinct Client/Admin shells. Add a thin target-neutral layer above them and remove data fetching from the visual shell.

```text
main.jsx
└── NativeAppRoot (no-op adapters on web)
    ├── SystemBarsController
    ├── NativeLifecycleController
    ├── NativeBackCoordinator
    ├── OverlayStackProvider
    ├── NetworkStatusProvider
    ├── SecureSessionBootstrap
    ├── RootErrorBoundary
    └── TargetRoot selected at build time
        ├── ClientRoot
        │   ├── SessionProvider
        │   ├── AppConfigProvider
        │   ├── ResourceCacheProvider
        │   ├── Public/Auth/SplashLayout
        │   └── ClientAuthenticatedShell
        │       ├── SafeAreaSurface
        │       ├── ClientTopBar (persistent on primary destinations)
        │       ├── MainContent → CurrentRoute
        │       ├── ClientBottomNavigation (primary routes only)
        │       └── Toast/OverlayHost
        └── AdminRoot
            ├── AdminSessionProvider
            ├── ResourceCacheProvider
            └── AdminAuthenticatedShell
                ├── AdminTopBar
                ├── AdminNavigation
                │   ├── Desktop grouped sidebar
                │   └── Phone grouped drawer/domain hub
                ├── MainContent → CurrentRoute
                └── Toast/OverlayHost
```

Responsibilities:

- NativeAppRoot: device integration only; no Client/Admin business logic.
- Session providers: authenticated principal, permissions and typed restore state; no page layout.
- Resource cache: request/query state with invalidation and timestamps; no navigation.
- Shell: chrome, safe areas, route metadata, focus target, scroll container and persistent hosts; no broad domain preload.
- Pages: workflow-specific rendering and mutations, composed from shared primitives.

Route metadata should declare, rather than infer:

```text
path, destinationId, parent, appBarMode, primaryNavItem,
showsBottomNav, permissions, isTransactional, backPolicy
```

---

# I. Navigation Proposal

## Client App

```text
Primary — persistent bottom navigation
├── Home                 /app/dashboard
├── Explore              /app/explore
├── Portfolio            /app/portfolio
├── Activity             /app/transactions
└── Profile              /app/profile

Secondary — pushed with logical parent, bottom bar hidden
├── Home
│   └── Notifications    /app/notifications
├── Explore
│   └── Fund detail      /app/funds/:fundId
├── Portfolio
│   ├── Withdrawal history /app/withdrawals
│   └── Mandate detail   /app/mandates/:mandateId
└── Profile
    ├── Verification/KYC /app/profile/kyc and /app/verify-email
    ├── Security         /app/profile/security
    ├── Statements       /app/statements
    ├── Support          /app/profile/support
    ├── Legal            /app/profile/legal
    ├── Investor Charter /app/investor-charter
    └── Grievance        /app/grievance

Transactional — explicit cancel/completion stack rules
├── Start SIP            /app/invest/sip/:fundId
├── One-time investment  /app/invest/lumpsum/:fundId
├── Payment              /app/payment/:paymentId
└── Mandate authorization /app/mandates/:mandateId/authorize
```

Keep the current five primary destinations. Use replace/reset semantics for switching top-level tabs, push once for secondary screens, and prune completed transactional routes. A secondary screen always has a logical parent fallback even when launched directly. Persist per-tab scroll and cached data, not a long chronological WebView history.

The Client persistent top bar should show BOE identity and primary-context actions (notifications/profile as appropriate). Secondary screens use one AppBar with Back/title/contextual actions. Do not render both a global Back and a page-owned “Back to…” control.

## Admin App

The existing domain grouping is good; the phone presentation is not. Thirteen destinations should not be a bottom bar.

```text
Persistent phone chrome
├── Compact Admin top bar
│   ├── Menu/domain switcher
│   ├── Current title
│   └── Account/global action
└── Optional 4-domain quick rail (only after operator testing)
    ├── Overview
    ├── Users
    ├── Operations
    └── More

Grouped drawer/domain hub
├── Overview
├── Users
│   ├── Approvals
│   ├── Subscriptions
│   ├── Payments
│   └── Directory → routed user detail
├── Support Content
│   └── FAQs
├── App Management
│   └── App builder
├── Operations
│   ├── AUM pools
│   ├── Holdings
│   └── Transactions
└── System
    ├── Audit log
    ├── Email log
    └── Environment
```

Desktop retains the grouped persistent sidebar. Mobile uses a drawer or domain hub; active domain and route remain visible in the top bar. Navigation entries are filtered/disabled using session permissions for UX while the backend remains authoritative. User detail becomes URL-backed; overlays may use a background-location pattern, but Android Back must close detail before changing the underlying domain.

## Destination classification

| Type | Policy |
|---|---|
| Internal app route | React Router through allowlisted destination manifest |
| Published/configured route | Stable destination ID resolved locally; no arbitrary path strings |
| External HTTPS | Capacitor Browser on native; intentional new tab on web |
| Phone/email/system action | Central helper with failure feedback |
| Share | Canonical public HTTPS URL, never `https://localhost/...` |
| Download/file | Explicit MIME/permission/share/download strategy |
| Unknown/unsafe | Recoverable error; never splash/overview fallback |

---

# J. Performance Plan

No optimization is accepted without Phase 0 before/after measurements from release-like APKs. Existing `dist` sizes are a static reference, not a performance baseline.

## Phase 1 — navigation latency

| Action | Files | Measurement / acceptance |
|---|---|---|
| Fix invalid destinations and stop wildcard-to-splash recovery | ClientRoot, ClientApp, Admin, route manifest/new NotFound | 100% route matrix passes; invalid route never triggers splash |
| Replace blank auth/eligibility returns with stable shell/bootstrap/skeleton | BrowserRoot, ClientLayout, ClientApp, session providers | No white/empty frame in video/frame trace |
| Stop hiding/translating whole route content | PageTransition, ClientLayout, FadeIn call sites | Tap feedback in first frame; content starts rendering within target budget |
| Define primary/secondary/transaction history and Back | BottomNav, AppBar, shells, completion pages, native coordinator | Deterministic Back scenarios; no completed flow reopened |
| Prefetch likely route code/data on intent/idle | Route roots, Dashboard/Explore/Portfolio links, cache | Warm transition p95 target ≤150ms to stable shell/content response; cold secondary begins skeleton ≤100ms |

## Phase 2 — network/data

| Action | Files | Measurement / acceptance |
|---|---|---|
| Add in-flight de-dup/query cache/timestamps | new ResourceCache, `_util.js`, domain hooks | Revisiting a fresh route causes zero duplicate reads |
| Migrate Dashboard first, then Explore/Portfolio/transactions | corresponding pages/services | Dashboard cold request count documented; warm return performs background refresh only when stale |
| Cache app config and eligibility centrally | useAppConfig, appConfig, ClientApp/Session bootstrap | One config request per stale window; eligibility not refetched per guarded mount, server writes remain authoritative |
| Split Admin legacy preload by route/domain | LegacyAdminDataContext, AdminShell, Admin hooks/screens | Overview does not fetch six full datasets; screen transition fetches only its keys |
| Retain previous data and distinguish error/empty/offline | page hooks, AsyncState, Network provider | No failed request becomes a valid empty financial state |
| Instrument request name/count/duration/cache status | `_util.js`, build-safe telemetry adapter | Per-navigation request waterfall report with no sensitive payload logging |

Staleness policy must be domain-specific. Static FAQs/app copy can have a long stale window. Fund catalog/research can use stale-while-revalidate. Portfolio, payment, mandates and transaction state require short windows, foreground refresh, explicit `updatedAt/asOf`, and mutation-driven invalidation. Financial writes are never retried blindly; preserve idempotency keys and confirmation status.

## Phase 3 — rendering

| Action | Files | Measurement / acceptance |
|---|---|---|
| Memoize/split broad Admin contexts | LegacyAdminDataContext, domain providers | React Profiler shows unrelated shell/screens do not rerender on polling |
| Replace mass FadeIn/3D chart effects | PageTransition, FadeIn, Charts, Dashboard/Explore/FundDetail | Fewer long tasks and layer promotions; reduced-motion path remains instant |
| Virtualize/paginate only measured large lists | Admin DataTable/list screens, Client transactions | No speculative virtualization; stable scroll at production-like row counts |
| Split oversized modules | AumScreen, FundDetail, AppBuilderScreen | Feature modules under repository cohesion limits; no behavior rewrite in one step |
| Stabilize geometry with skeleton primitives | AsyncState and pages | Layout shift near zero during first content load |

## Phase 4 — bundle/assets

| Action | Files | Measurement / acceptance |
|---|---|---|
| Route-lazy secondary and Admin domain screens | ClientApp, Admin, Vite config | Per-route gzip/Brotli budget recorded; shell/primary code remains coherent |
| Remove cross-target CSS imports and page CSS barrel loading | AdminLogin/AdminSplash, Client/Admin style imports | Client APK has no Admin screen assets; Admin APK has no Client page CSS beyond explicitly shared auth/splash |
| Subset fonts intentionally | design-tokens `tokens.css`, package imports | Only supported scripts, WOFF2 and used weights; no readability/locale regression |
| Lazy-load Razorpay at payment entry | index.html, payment service/flows | Zero Razorpay request on non-payment startup; explicit provider failure UI |
| Replace filename-only target guard | Vite config, check script, builder | Final APK module/assets inspected against target manifest and byte budgets |

## Phase 5 — startup/APK

| Action | Files | Measurement / acceptance |
|---|---|---|
| Preserve 1600ms hold and overlap bootstrap tasks | Splash pages, session providers, AppUpdateGate, main | On healthy warm restore, navigation occurs at ~1600ms, not 1600ms + reachability |
| Pixel-match native → HTML → React surfaces | styles.xml, manifest, index.html/index.css, splash styles/assets | No white/black flash in 60fps launch recording |
| Secure async session restore under splash | NativeSessionVault, auth/session files | Valid existing session restores without token in localStorage and without post-hold delay |
| Hermetic Gradle variants/source sets | build.gradle, resources, builder | Building both variants leaves worktree unchanged; IDs/certs/branding correct |
| Enforce release policies | check script/release tests | non-debuggable, no maps/dev URLs, mixed content false, exact API origin, wrong-target assets absent |

## Measurement protocol

Capture before and after for Client and Admin release APKs:

- Native process start → first WebView/React splash paint.
- React splash start → first usable authenticated screen, while retaining minimum 1600ms.
- Tap timestamp → immediate pressed/selected feedback → stable next-screen content/skeleton; p50/p95.
- API calls, duplicate/in-flight dedup status, bytes and latency per navigation.
- JS/CSS/font compressed and uncompressed bytes per target and route.
- Chrome DevTools performance traces: parse/evaluate, long tasks, layout/paint, layout shift.
- React Profiler commits and context-driven rerenders.
- WebView memory/PSS and frame stalls with production-like data.
- APK compressed/uncompressed size and startup using `adb am start -W`, Perfetto/Macrobenchmark where feasible.
- Cold, warm, hot start; current and an older supported Android System WebView.

Initial budgets should be set after baseline, then enforced in CI. Do not invent absolute bundle budgets before measuring network/device distribution; the route response goals above are product targets to validate.

---

# K. Mobile UI Refactor Plan

## Already reasonably mobile

| App | Pages/files | Why / remaining work |
|---|---|---|
| Client | `Login.jsx` | Clear phone form and native input attributes; restore keyboard access to password visibility |
| Client | `KycVerify.jsx` | OTP/autocomplete foundation; validate large fonts/keyboard |
| Client | `Notifications.jsx` | Compact list foundation; add route validation/cache/error |
| Client | `KycDetail.jsx` | Suitable information hierarchy; standardize state |
| Client | `WithdrawalRequests.jsx` | Simple list; make reachable and use common query state |
| Client | `Legal.jsx`, `InvestorCharter.jsx`, `GrievanceRedressal.jsx` | Long-copy phone layouts; add load failures and native external actions |
| Admin | `OverviewPage.jsx` | Reasonable summary surface after removing six-domain preload |
| Admin | `FaqsPage.jsx` + `FaqEditorDrawer.jsx` | Existing Drawer is strong; improve row semantics/responsive targets |
| Admin | `EnvironmentScreen.jsx` | Simple diagnostic surface; handle long values/actions |

## Needs minor adaptation

| App | Pages/files | Why |
|---|---|---|
| Client | `Splash.jsx`, Admin `AdminSplash.jsx` | Keep 1.6s; overlap bootstrap and align handoff |
| Client | `PaymentStatus.jsx`, `MandateAuth.jsx` | Timeout/lifecycle/back and completed-stack rules |
| Client | `LumpsumSheet.jsx` | Shared overlay/IME/action-bar contract |
| Client | `Support.jsx` | Semantic accordion/labels, caught submit errors |
| Client | `Profile.jsx` | Semantic link rows and explicit secondary chrome |
| Client | `Statements.jsx`, `Security.jsx` | Replace manual modal with canonical overlay |
| Client | `Transactions.jsx`, `Portfolio.jsx` | Cache/retained state and canonical dialogs; layout base is usable |
| Client | `Blocked.jsx` | Route policy repair, not visual redesign |
| Admin | `ApprovalsScreen.jsx` | Existing narrow cards help; targets/loading/decision detail need work |
| Admin | `EmailDeliveriesScreen.jsx` | Responsive list fallback and state conventions |
| Admin | `UserDetailScreen.jsx` | Better section/action hierarchy; canonical routed detail |

## Needs substantial redesign

| App | Pages/files | Why |
|---|---|---|
| Client | `Dashboard.jsx` | Five reads, card/metric density, click semantics, ambiguous loading, no persistent top-bar contract |
| Client | `Explore.jsx` | Duplicate product presentations, filters/research density, inaccessible cards |
| Client | `FundDetail.jsx` | 676 lines, 14 staged reveals, 3D chart, duplicate Back/disclosure ambiguity |
| Client | `StartSipSheet.jsx` | 302-line staged financial form needs durable flow/keyboard/semantic controls |
| Client | `MandateDetail.jsx` | Sequential waterfall, dead route, manual confirmation |
| Admin | `UserDetailsListScreen.jsx`, `AuditLogScreen.jsx` | Wide tables/row behavior need phone list-detail/event-stream patterns |
| Admin | `TransactionsScreen.jsx`, `HoldingsScreen.jsx` | Dense data grids/filters need summaries and detail routes/sheets |
| Admin | `PaymentsScreen.jsx`, `MandatesScreen.jsx` | Action-heavy tables require master-detail and protected decision UI |

## Should be structurally rebuilt

| Area | Files | Reason |
|---|---|---|
| Admin mobile navigation | AdminShell, Sidebar, TopBar, `nav.js`, `shell.css` | Thirteen-destination horizontal strip cannot be fixed cosmetically |
| Admin AUM/fund operations | `AumScreen.jsx` and its Fund/AUM/investor/stock/redemption/allocation subpanels | 1,304-line nested desktop workflow; split into domain routes/tasks before mobile layout |
| Admin App Builder | `AppBuilderScreen.jsx` | 506-line desktop editor; needs staged section editor and destination validation |
| Admin data ownership | `LegacyAdminDataContext.jsx` | Broad preload/mutation/overlay controller must be split before screen redesign |

Principle: first repair data ownership, shell, navigation and overlay contracts; then migrate page visuals. Do not repaint repeated fetches and broken history.

---

# L. Implementation Phases

## Phase 0 — Baseline and contracts

- Record release APK start, route latency, requests/navigation, rerenders, memory and asset sizes.
- Freeze the route matrices and current application IDs/signing certificates.
- Define route destination IDs, staleness/as-of rules, Android Back policy, screenshot/backup policy, orientation support and dev HTTP strategy.
- Add route/auth/origin/artifact tests before implementation.

## Phase 1 — Critical navigation and release-origin fixes

- Repair disclosures, `/app/orders`, terminal Support and orphan-route decisions.
- Replace wildcard redirects with Not Found.
- Validate notification/config/disclosure targets.
- Align `https://localhost` release allowlists and tests.
- Correct stale release documentation; do not alter business flow yet.

## Phase 2 — Global native/mobile foundation

- Mount target-neutral native root.
- Establish SystemBars CSS inset variables and system icon styles.
- Explicitly disable page zoom while retaining OS font scaling.
- Separate release mixed-content policy from emulator development.
- Define backup/task-preview policy and initial IME behavior.

## Phase 3 — Persistent shells and loading

- Retain current shells but make headers/chrome/route metadata explicit.
- Replace blank guards/root spinner with stable bootstrap shell/skeleton.
- Preserve exactly the 1.6s splash hold and overlap restore/reachability/update/preload.
- Add global overlay/toast/network hosts.

## Phase 4 — Routing, Back and overlay stack

- Implement canonical route manifests and parent/history policy.
- Implement native Back LIFO coordinator.
- Correct primary-tab replace/reset and completed transaction pruning.
- Migrate shared BottomSheet/Drawer, then manual dialogs.
- Route Admin user detail.

## Phase 5 — Security/session and data fetching

- Security-reviewed Secure Storage → in-memory vault migration.
- Add ResourceCache with in-flight de-dup, timestamps, invalidation and retained data.
- Centralize app config/eligibility.
- Migrate Dashboard, Explore, Portfolio/Activity.
- Split Admin provider by domain and permission-filter navigation.

## Phase 6 — Shared mobile design system

- Consolidate safe areas, chrome sizes, 48dp targets, type/data/spacing and z-index tokens.
- Standardize Page/AppBar/Section/List/Card/ActionBar/FormField/AdaptiveDialog/Skeleton/Empty/Error.
- Replace click-divs and incorrect tab roles.
- Preserve BOE identity; reduce nested cards/serif task labels/3D charts.

## Phase 7 — Client UI migration

- Dashboard → Explore → Fund detail.
- Portfolio/Activity/Profile/Support.
- SIP/Lump-sum/Payment/Mandate flows.
- Remaining secondary/legal/notification pages.
- Validate financial formatting, as-of/stale, keyboard and form persistence at every slice.

## Phase 8 — Admin UI migration

- Mobile Admin navigation first.
- Approvals/directory/detail, then payments/subscriptions.
- Transactions/holdings/audit/email.
- AUM operations split/rebuild.
- App Builder staged editor last because it publishes Client navigation/content.

## Phase 9 — Failure/offline/error states

- Central offline/slow/backend/session-expired messages.
- Local retry and background refresh; never blanket-retry writes.
- Route/widget error boundaries and recoverable global error UI.
- Timestamp stale financial information.

## Phase 10 — Bundle, build and release validation

- Route chunks/CSS, defer Razorpay, intentional font subsets.
- Hermetic Gradle variants/resources and final APK target isolation.
- Full device/accessibility/back/keyboard/network matrix.
- Enforce performance/security/artifact budgets in release checks.

Each phase should ship in vertical, reversible slices with tests. Do not start Phase 7/8 page polishing before Phases 1–6 foundations for that surface are complete.

---

# M. Dependency Graph

```text
Baseline + product/security decisions
├── Route manifest + destination validation
│   ├── Known link fixes
│   ├── Not Found / Forbidden
│   ├── Android Back parent policies
│   └── Deep links (only later, if approved)
├── Native WebView policy
│   ├── Zoom contract
│   ├── Mixed-content/dev networking split
│   └── SystemBars inset/style contract
│       └── Global safe-area tokens
│           ├── Client shell/header/nav
│           ├── Admin shell/navigation
│           └── Overlay/keyboard geometry
├── Secure session bootstrap
│   └── Stable auth shell/loading
│       └── Splash work overlapped beneath retained 1.6s hold
└── Resource cache/query contract
    ├── Client primary-page migration
    └── Admin legacy-provider split
        └── Admin operational-page migration

Route manifest + Native Back + Overlay registry
        ↓
Canonical BottomSheet/Dialog/Drawer
        ↓
Transactional flow migration

Shell + safe areas + data/loading + overlays
        ↓
Shared mobile design primitives
        ↓
Client/Admin visual migrations
        ↓
Route chunk/CSS/font optimization
        ↓
Hermetic final APK validation
```

Secure token work should not be bundled casually with visual shell changes; it is a separately reviewed prerequisite to final native security acceptance. Deep links depend on the route allowlist and role restoration and are not a prerequisite for core navigation.

---

# N. Risk Assessment

| Risk | Level | Failure mode | Mitigation |
|---|---|---|---|
| Native token migration | **Critical** | Lost/duplicated rotating refresh tokens, logout loops, insecure fallback | Security review; atomic vault; one-time bounded migration; rollback; never log tokens |
| Application IDs/signing/flavors | **Critical** | Existing installs cannot update or Client/Admin overwrite each other | Freeze IDs/certs; artifact tests; install-over-existing validation for all four target/variant IDs |
| CORS/native origin | **High** | Entire APK API appears offline or allowlist becomes too broad | Exact `https://localhost`, integration/preflight tests, no wildcard |
| Mixed-content/dev split | **High** | Emulator breaks or production accepts HTTP subresources | Target-specific config and final APK assertions |
| Auth/route guard refactor | **High** | Auth bypass, redirect loops, protected screen flash | Preserve backend enforcement; route-state tests for all principal/session states |
| Admin permission UI | **High** | Hidden legitimate workflow or false sense of authorization | UI is advisory only; route metadata tests; backend remains authority |
| Eligibility caching | **High** | Ineligible action appears enabled | Short-lived UX cache; revalidate on action; backend write enforcement unchanged |
| Financial cache | **High** | Stale balance/status shown as live | Domain TTLs, `updatedAt/asOf`, foreground refresh, mutation invalidation, explicit stale state |
| Android Back coordinator | **High** | Back disabled, listener leak, accidental exit, completed flow reopened | Single mount/LIFO tests; per-route policies; lifecycle/predictive-back tests |
| Overlay consolidation | **High** | Form state lost, confirmation skipped, focus/scroll broken | Migrate one overlay at a time with behavior/a11y tests |
| Admin provider split | **High** | Mutations/polling/counts drift | Domain integration tests; preserve optimistic rollback and visibility polling |
| Safe-area/SystemBars | **Medium-High** | Double padding or controls under system bars | One token source; WebView/device/cutout matrix |
| Keyboard adjustResize | **Medium-High** | Double resize, bottom blank bands, hidden actions | Measure default first; add plugin only if needed; IME matrix |
| Route chunking | **Medium** | Waterfalls or stale-chunk failures after release | Meaningful domain splits, preload critical chunks, version/update policy tests |
| CSS consolidation | **High** | Web/Admin desktop visual regressions | Screenshot matrix across target/breakpoint; migrate by feature |
| Admin mobile IA | **Medium-High** | Operator efficiency decreases | Workflow frequency study and Admin operator testing |
| Pinch zoom suppression | **Medium / a11y** | Users lose magnification without adequate text reflow | Keep OS text/display scaling; large-font/TalkBack tests; target native viewport only if web must differ |
| Screenshot/task privacy | **Medium / product** | Sensitive preview exposed or legitimate support screenshot blocked | Explicit product decision; consider screen-specific policy |
| External/deep links | **High security** | Cross-scope navigation or arbitrary URL launch | Verified links, exact hosts, allowlisted route parser, role/session checks |
| Desktop/browser compatibility | **High** | Mobile shell refactor harms Admin desktop or web Client | Target-aware layout adapters and desktop E2E regression |

---

# O. Validation/Test Matrix

## Devices and system UI

| Class | Required cases |
|---|---|
| Small phone | 320–360dp width, short height, large text |
| Standard phone | ~412dp portrait |
| Tall phone | 20:9 and 21:9 |
| Large Android | fold/tablet/large-window behavior or explicit unsupported policy |
| Cutouts | centered notch, corner/hole-punch, curved edges, landscape cutout |
| Navigation mode | gesture navigation and 3-button navigation |
| Orientation | portrait; landscape every route if supported, otherwise verify explicit lock |
| WebView | current stable plus older supported System WebView below Capacitor's inset workaround threshold |

## Startup/session

- Fresh install, first launch, Client and Admin branding.
- Cold/warm/hot launch.
- Native splash → HTML background → React splash without flash.
- React splash visible for minimum 1600ms in Client and Admin.
- Valid restored session, expired access with valid refresh, expired/revoked refresh, no session.
- Offline cold launch and offline restored cached shell.
- App update available/not available/update installer return.
- Process death and recreation; activity `singleTask` warm intent.

## Route tests — Client

- Every row in Client matrix for unauthenticated, active Client, terminal Client and wrong-role principal.
- Primary tab switching repeated in arbitrary order; scroll/data state retained.
- Every secondary direct URL has correct fallback parent.
- Known regressions: `/app/orders`, root disclosure paths, terminal Support, unknown route.
- Invalid/missing fund/payment/mandate IDs.
- Invalid notification target and invalid Admin-published quick action.
- Payment/SIP/lump-sum/mandate success, cancel, timeout and Back.
- Withdrawal and mandate-detail discoverability.

## Route tests — Admin

- Every canonical and intentional compatibility route.
- Each permission set: visible destinations, direct 403, backend denial preserved.
- Directory → routed user detail → Back/direct launch.
- Unknown route → Not Found, never silent overview.
- Legacy `?tab=` aliases.
- Client/Admin cross-scope route rejection.

## Back/overlay/lifecycle

- Back with drawer, BottomSheet, manual/adapted dialog, toast action, update gate, app lock and biometric prompt.
- Nested overlay LIFO behavior.
- Secondary → parent; non-Home primary → Home; Home → chosen minimize/exit behavior.
- Predictive Back preview/cancel/complete on supported Android.
- Background while financial form/dialog open; recent-app snapshot policy.
- Browser Back/Forward remains correct without native exit behavior.

## Insets, keyboard, forms and scrolling

- Every top-level/secondary screen with status bar/cutout and both nav modes.
- Fixed top bar, bottom nav, action bar, toast, dialog, drawer and sheet.
- Text/email/password/OTP/numeric/decimal/date/select/textarea inputs.
- First/last field, modal form, focused input behind bottom chrome, IME Next/Done.
- OS font 100/130/160/200%, display-size changes.
- No body+child double scroll, background scroll under modal, horizontal page overflow or lost scroll after tab switch.
- Dynamic viewport resize and orientation/keyboard transition.

## Accessibility/touch

- TalkBack traversal/labels/live regions, Switch Access, keyboard navigation on web.
- Contrast and status not conveyed only by color.
- 48dp comfortable critical targets; spacing prevents accidental taps.
- Visible focus; semantic buttons/links; correct tabs with arrow keys or ordinary route links.
- Reduced motion; no mandatory staged reveal.
- Pinch/double-tap does not zoom page in APK, while OS text/display scaling and TalkBack remain functional.
- Text selection/copy remains available for legitimate financial/legal content; dragging/selection suppression only on controls/ornament.

## Network/failure/security

- Fast, high latency, 20s timeout, TLS failure, backend 5xx, offline→online, captive portal-like failure.
- Read retry/backoff; writes with idempotency and no blind retry.
- Cached value displays timestamp/stale/offline status.
- WebView Origin/preflight exact allow/deny for Client/Admin dev/prod.
- LocalStorage credential migration and secure-store failure.
- Backup/restore attempt; screenshot/task-preview policy.
- External URL, mailto/system action, canonical share URL, malformed/hostile link.

## Release/artifact/performance

- Signed release update installs over matching existing app; all application IDs/labels/icons correct.
- `debuggable=false`, no source maps, dev endpoints, secrets, sensitive logs or remote server URL.
- Mixed content disabled in distributed assets; exact API origin.
- Client APK contains no Admin screens; Admin APK contains no Client pages beyond intentional shared modules.
- Build both variants from clean tree and verify it remains clean.
- Compare startup, route p50/p95, request count/bytes, long tasks, rerenders, memory and bundle/APK sizes to Phase 0 baseline.

The existing Android unit test package is stock `com.getcapacitor.myapp` and frontend has only `chartMath.test.js`; route, shell, a11y and native-back coverage must be created before structural implementation. Target at least the repository's mandated 80% coverage in changed/new logic, plus E2E coverage for critical financial/auth flows.

---

# P. Recommended Implementation Order by File

1. `frontend_stack/packages/client/src/navigation/routes.js` *(new)*
   **Reason:** make route/path/parent/shell/destination validation authoritative.
   **Depends on:** Phase 0 route/IA decisions.
   **Unlocks:** known link fixes, Not Found, remote target validation, Back.

2. `frontend_stack/packages/client/src/ClientApp.jsx`
   **Reason:** adopt the manifest and remove route-level blank eligibility behavior.
   **Depends on:** 1 and eligibility cache contract.
   **Unlocks:** Client route correctness/lazy migration.

3. `frontend_stack/app/src/ClientRoot.jsx` and `frontend_stack/packages/admin/src/pages/Admin.jsx`
   **Reason:** replace wildcard redirects with recoverable route states.
   **Depends on:** route manifests/Not Found.
   **Unlocks:** visible diagnosis instead of splash/overview masking.

4. `frontend_stack/packages/client/src/services/disclosureApi.js`, `frontend_stack/packages/client/src/pages/FundDetail.jsx`, `frontend_stack/packages/client/src/pages/MandateDetail.jsx`, `frontend_stack/packages/client/src/layout/ClientLayout.jsx`, `frontend_stack/packages/client/src/pages/Blocked.jsx`
   **Reason:** close concrete P0 navigation defects.
   **Depends on:** 1–3.
   **Unlocks:** reliable significant routes.

5. `release_manager/stacks/dev_release/.env.example`, `release_manager/stacks/prod_release/.env.example`, `backend_controller/.env.production.example`, `backend_controller/src/http/cors.test.ts`
   **Reason:** make APK API origin explicit and tested.
   **Depends on:** confirmed `https://localhost` scheme.
   **Unlocks:** reliable Client/Admin network in release.

6. `frontend_stack/app/capacitor.config.json`
   **Reason:** authoritative zoom, SystemBars and WebView security policy.
   **Depends on:** dev HTTP decision.
   **Unlocks:** global native behavior.

7. `frontend_stack/app/index.html` and `frontend_stack/app/src/index.css`
   **Reason:** viewport/first paint/global inset contract.
   **Depends on:** 6 and web-vs-native zoom decision.
   **Unlocks:** safe shells and launch continuity.

8. `frontend_stack/app/src/platform/NativeAppRoot.jsx`, `frontend_stack/app/src/platform/NativeBackCoordinator.jsx`, `frontend_stack/app/src/platform/SystemBarsController.jsx`, `frontend_stack/app/src/platform/OverlayStackContext.jsx` *(new)*
   **Reason:** mount device behavior once above target roots.
   **Depends on:** route and native contracts.
   **Unlocks:** Back, bars, overlays, lifecycle integration.

9. `frontend_stack/app/src/main.jsx`
   **Reason:** install the shared native/bootstrap composition.
   **Depends on:** 8.
   **Unlocks:** both target shells.

10. `frontend_stack/packages/client/src/layout/ClientLayout.jsx`, `frontend_stack/packages/client/src/layout/BottomNav.jsx`, `frontend_stack/packages/client/src/layout/AppBar.jsx`, `frontend_stack/packages/client/src/layout/BottomSheet.jsx`
    **Reason:** apply route metadata, stable chrome, Back and safe areas.
    **Depends on:** 1, 7–9.
    **Unlocks:** Client page migrations.

11. `frontend_stack/packages/admin/src/navigation/nav.js`, `frontend_stack/packages/admin/src/layout/AdminShell.jsx`, `frontend_stack/packages/admin/src/layout/Sidebar.jsx`, `frontend_stack/packages/admin/src/layout/TopBar.jsx`, `frontend_stack/packages/admin/src/layout/Drawer.jsx`
    **Reason:** permission-aware mobile Admin shell and overlay behavior.
    **Depends on:** 7–9.
    **Unlocks:** Admin route/screen migrations.

12. `frontend_stack/packages/client/src/services/_util.js`, `frontend_stack/packages/client/src/services/authApi.js`, `frontend_stack/packages/client/src/platform/storage.js`, `frontend_stack/packages/client/src/store/SessionContext.jsx`, `frontend_stack/packages/client/src/store/AdminSessionContext.jsx`
    **Reason:** secure, typed session bootstrap and request access.
    **Depends on:** security-reviewed NativeSessionVault design.
    **Unlocks:** safe retained shell/startup; must ship separately from visual refactor.

13. `frontend_stack/packages/client/src/pages/Splash.jsx`, `frontend_stack/packages/admin/src/pages/AdminSplash.jsx`, `frontend_stack/packages/client/src/components/AppUpdateGate.jsx`
    **Reason:** overlap work beneath retained 1600ms hold.
    **Depends on:** 9 and 12.
    **Unlocks:** clean first usable screen.

14. `frontend_stack/packages/shared/src/data/ResourceCacheProvider.jsx` *(new)*, `frontend_stack/packages/shared/src/appConfig.js`, `frontend_stack/packages/client/src/hooks/useAppConfig.js`
    **Reason:** shared request/stale/invalidation foundation.
    **Depends on:** typed session/network states.
    **Unlocks:** page data migration.

15. `frontend_stack/packages/client/src/pages/Dashboard.jsx`, `frontend_stack/packages/client/src/pages/Explore.jsx`, `frontend_stack/packages/client/src/pages/Portfolio.jsx`, `frontend_stack/packages/client/src/pages/Transactions.jsx`
    **Reason:** largest Client navigation/data duplication.
    **Depends on:** 10 and 14.
    **Unlocks:** instant-feeling primary tabs.

16. `frontend_stack/packages/admin/src/context/LegacyAdminDataContext.jsx`, `frontend_stack/packages/admin/src/hooks/useAdminCollection.js`, `frontend_stack/packages/admin/src/hooks/useAdminList.js`
    **Reason:** remove six-domain bootstrap/broad invalidation.
    **Depends on:** 11 and 14.
    **Unlocks:** Admin performance and screen redesign.

17. `frontend_stack/packages/design-tokens/src/tokens-core.css`, `frontend_stack/packages/client/src/styles/mobile/base.css`, `frontend_stack/packages/client/src/styles/mobile/layout.css`, `frontend_stack/packages/client/src/styles/mobile/components.css`, `frontend_stack/packages/admin/src/styles/desktop/shell.css`, `frontend_stack/packages/admin/src/styles/admin/admin-base.css`, `frontend_stack/packages/admin/src/styles/admin/admin-responsive.css`, `frontend_stack/packages/admin/src/styles/admin/admin-overlays.css`
    **Reason:** consolidate targets, insets, chrome, type and overlay levels.
    **Depends on:** shell geometry agreed.
    **Unlocks:** systematic page UI migration.

18. `frontend_stack/packages/shared/src/motion/PageTransition.jsx`, `frontend_stack/packages/shared/src/motion/FadeIn.jsx`, `frontend_stack/packages/client/src/components/Charts.jsx`
    **Reason:** remove webpage reveal/performance treatment.
    **Depends on:** stable shell/loading.
    **Unlocks:** immediate visual response.

19. `frontend_stack/packages/client/src/pages/Statements.jsx`, `frontend_stack/packages/client/src/pages/Security.jsx`, `frontend_stack/packages/client/src/pages/Support.jsx`, `frontend_stack/packages/client/src/pages/Profile.jsx`, `frontend_stack/packages/client/src/pages/Notifications.jsx`
    **Reason:** migrate secondary overlays, semantics and failure states after foundations.
    **Depends on:** 10, 14, 17–18.
    **Unlocks:** consistent Client secondary navigation.

20. `frontend_stack/packages/client/src/pages/StartSipSheet.jsx`, `frontend_stack/packages/client/src/pages/LumpsumSheet.jsx`, `frontend_stack/packages/client/src/pages/PaymentStatus.jsx`, `frontend_stack/packages/client/src/pages/MandateAuth.jsx`
    **Reason:** migrate keyboard/back/cache and completion-stack rules for financial execution.
    **Depends on:** 10, 12, 14, 17–18.
    **Unlocks:** complete Client transaction-flow behavior.

21. `frontend_stack/packages/admin/src/components/DataTable.jsx`, `frontend_stack/packages/admin/src/screens/ApprovalsScreen.jsx`, `frontend_stack/packages/admin/src/screens/UserDetailsListScreen.jsx`, `frontend_stack/packages/admin/src/screens/UserDetailScreen.jsx`, `frontend_stack/packages/admin/src/screens/PaymentsScreen.jsx`, `frontend_stack/packages/admin/src/screens/MandatesScreen.jsx`, `frontend_stack/packages/admin/src/screens/TransactionsScreen.jsx`, `frontend_stack/packages/admin/src/screens/HoldingsScreen.jsx`, `frontend_stack/packages/admin/src/screens/AuditLogScreen.jsx`, `frontend_stack/packages/admin/src/screens/EmailDeliveriesScreen.jsx`
    **Reason:** migrate Admin list/action workflows before complex editors.
    **Depends on:** 11, 16–17.
    **Unlocks:** core mobile Admin operations.

22. `frontend_stack/packages/admin/src/screens/AumScreen.jsx`, `frontend_stack/packages/admin/src/screens/FundAumPanel.jsx`, `frontend_stack/packages/admin/src/screens/FundInvestorsPanel.jsx`, `frontend_stack/packages/admin/src/screens/FundStockListPanel.jsx`, `frontend_stack/packages/admin/src/screens/AumDisplayFields.jsx`, `frontend_stack/packages/admin/src/screens/AumRedemptionsTab.jsx`, `frontend_stack/packages/admin/src/screens/GainAllocationForm.jsx`
    **Reason:** split and rebuild the largest operational workflow after domain data is stable.
    **Depends on:** 16–17 and 21.
    **Unlocks:** phone-safe fund operations.

23. `frontend_stack/packages/admin/src/screens/AppBuilderScreen.jsx`
    **Reason:** rebuild the staged editor after the canonical Client destination schema exists.
    **Depends on:** 1, 11, 16–17.
    **Unlocks:** safe mobile content/navigation publishing.

24. `frontend_stack/app/vite.config.js`, `frontend_stack/app/scripts/check-android-dist.mjs`, `frontend_stack/packages/client/src/styles/mobile/index.css`, `frontend_stack/packages/design-tokens/src/tokens.css`, `frontend_stack/app/index.html`
    **Reason:** optimize measured bundle after architecture stops churn.
    **Depends on:** route/module boundaries.
    **Unlocks:** enforceable asset budgets.

25. `frontend_stack/app/android/app/build.gradle`, `frontend_stack/app/resources/launcher/generate-android-assets.mjs`, `emu/boe_update.sh`
    **Reason:** hermetic final variant build.
    **Depends on:** frozen IDs/signing/branding.
    **Unlocks:** reproducible Client/Admin APK validation.

26. `frontend_stack/app/android/app/src/main/AndroidManifest.xml`, `frontend_stack/app/android/app/src/main/res/values/styles.xml`, conditionally `frontend_stack/app/android/app/src/main/java/com/beonedge/app/MainActivity.java`
    **Reason:** finalize IME, launch, backup/privacy, deep-link and zoom fallback after WebView tests.
    **Depends on:** product/security decisions and config-level device validation.
    **Unlocks:** production APK sign-off.

---

# Q. Quick Wins vs Structural Fixes

## Quick Wins

- Correct `/app/orders` and disclosure fallback routes.
- Permit terminal-account Support or change the action to a reachable support mechanism.
- Replace wildcard-to-splash/overview with explicit Not Found.
- Add exact `https://localhost` to controlled release allowlists and tests.
- Explicitly set `android.zoomEnabled: false`; validate before native fallback.
- Correct root duplicate main landmark and obvious semantic click-div/anchor issues.
- Give secondary routes explicit bottom-nav visibility instead of prefix matching.
- Correct stale release documentation/messages about Admin APK/build type.
- Use existing semantic z tokens instead of literal 20/60 when touching shell CSS.
- Catch Support/content promise failures so submit/skeletons cannot remain indefinitely.

Quick does not mean untested: route/CORS/viewport changes affect every install.

## Structural Fixes

- Canonical route manifests and validated remote destination IDs.
- Native Back/overlay/history coordinator.
- SystemBars/safe-area/keyboard shell contract.
- Secure Storage/in-memory session vault migration.
- Client query cache and Admin legacy-provider split.
- Stable bootstrap/loading/network/error architecture.
- Permission-aware Admin navigation and routed details.
- Admin phone IA and AUM/App Builder decomposition.
- Canonical adaptive dialog/sheet/drawer.
- Gradle source-set/flavor and final-APK isolation architecture.

## Cosmetic Improvements — only after foundations

- Reduce nested cards/shadows and tiny uppercase eyebrow labels.
- Restrict Fraunces to selective brand/hero moments.
- Simplify charts and remove 3D effects.
- Standardize monetary/status/as-of presentation.
- Refine motion to short, local and interruption-safe transitions.
- Tune radii, elevation, icon sizes and whitespace.
- Polish Client/Admin splash visuals while keeping the timing unchanged.

---

# R. Final Priority Summary

1. **P0 — Fix and centralize routing:** disclosures, dead orders path, terminal Support, unknown-route handling and validated dynamic destinations.
2. **P0 — Reconcile the APK API origin:** explicitly allow and test exact `https://localhost`; keep wildcard CORS forbidden.
3. **P0 — Define native WebView policy:** explicit no-page-zoom, SystemBars CSS insets and release-safe mixed-content behavior while retaining Android text scaling.
4. **P0 — Implement stable shell bootstrap:** no blank auth/eligibility gates; keep chrome/content geometry visible.
5. **P0 — Security-review native sessions:** move bearer/refresh tokens from localStorage to Secure Storage plus memory; address backup policy.
6. **P0 — Implement Android Back and overlay priority:** deterministic primary, secondary, transactional and modal behavior.
7. **P1 — Keep the intentional 1.6-second splash hold:** overlap session, reachability, update and preloading so no serial delay is added.
8. **P1 — Add shared data reuse:** Client query cache/app-config/eligibility and domain-specific financial staleness rules.
9. **P1 — Split Admin global data ownership:** stop six-collection bootstrap and broad refresh/context rerenders.
10. **P1 — Replace Admin's horizontal mobile route strip:** grouped drawer/domain navigation with permission-aware entries.
11. **P1 — Consolidate safe areas, overlays, loading/errors, touch targets and route metadata in shared foundations.**
12. **P1 — Remove whole-route reveal behavior and migrate Client primary screens before secondary cosmetic work.**
13. **P2 — Rebuild dense Admin list/AUM/App Builder workflows for mobile master-detail/staged editing.**
14. **P2 — Route-split code/CSS, subset fonts deliberately and defer Razorpay after architecture is stable.**
15. **P2 — Make APK variants hermetic and enforce final Client/Admin artifact/security/performance budgets.**

The target is not a native rewrite. It is a persistent, stateful, inset-aware BOE application with Android task semantics and efficient data reuse, delivered through the existing React + Capacitor + Gradle pipeline.

---

## Primary repository evidence index

- Routing/roots: `frontend_stack/app/src/main.jsx`, `ClientRoot.jsx`, `BrowserRoot.jsx`, `frontend_stack/packages/client/src/ClientApp.jsx`, `frontend_stack/packages/admin/src/pages/Admin.jsx`.
- Shells/navigation: Client `layout/ClientLayout.jsx`, `BottomNav.jsx`, `AppBar.jsx`; Admin `layout/AdminShell.jsx`, `Sidebar.jsx`, `TopBar.jsx`, `navigation/nav.js`.
- Data/auth: Client services `_util.js`, `authApi.js`, session contexts, page effects; Admin `LegacyAdminDataContext.jsx`, `useAdminCollection.js`, `useAdminList.js`.
- Styling: design tokens; Client mobile CSS; Admin desktop/admin CSS generations.
- Capacitor/Android: `capacitor.config.json`, Android manifest/MainActivity/build.gradle/styles/network config/generated plugin/config assets.
- Release: `emu/boe_update.sh`, `release_manager/export.sh`, `status.sh`, stack env examples, artifact guards and release facts.
- Backend native boundary: `backend_controller/src/http/cors.ts`, `domain/admin/adminAccess.ts`, Admin session route and release environment parsing/tests.

Relevant implementation references should be rechecked against the installed version during execution: [Capacitor App](https://capacitorjs.com/docs/apis/app), [Capacitor System Bars](https://capacitorjs.com/docs/apis/system-bars), [Capacitor configuration](https://capacitorjs.com/docs/config), [Android WebSettings](https://developer.android.com/reference/android/webkit/WebSettings), and [Android edge-to-edge guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge).
