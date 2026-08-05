# Handoff — Portfolio screen crash on APK 0.7.4 ("Minified React error #31")

Status: **RESOLVED** — root cause confirmed, fix applied and verified
Date: 2026-08-05
App under test: `com.beonedge.app.dev` versionName `0.7.4-dev.0.g08406b0.dirty`, versionCode `704`
(signed release build, `emu/out/boe.dev.client.0.7.4.json`, sha256 `57ed0d49…04e5`)

Fix summary (details in section 7):

| File | Change |
|---|---|
| `frontend_stack/packages/client/src/pages/Portfolio.jsx` | `icon={Wallet}` → `icon={<Wallet size={40} strokeWidth={1.5} />}` |
| `frontend_stack/packages/shared/src/components/EmptyState.jsx` | accepts an element *or* a component type, so the mistake cannot recur |
| `frontend_stack/packages/shared/src/components/ErrorBoundary.jsx` | TEMP-DEBUG patch reverted |

Verified with `frontend_stack/app/repro.tmp.cjs` against the vite dev server: Portfolio,
Transactions and Profile all report `crashed=false` (Portfolio was `crashed=true`).

---

## 1. Symptom

Logging into the client APK as the dev seed client and tapping **Portfolio** shows the
error-boundary card ("Something went wrong"). With the temporary debug patch applied
(section 6) the card prints:

```
Error: Minified React error #31; visit https://reactjs.org/docs/error-decoder.html
?invariant=31&args[]=object%20with%20keys%20%7B%24%24typeof%2C%20render%2C%20displayName%7D
```

Tapping **Refresh page** does not help: the reload lands back on `/app/portfolio` and
crashes again.

## 2. Root cause (confirmed, not inferred)

`frontend_stack/packages/client/src/pages/Portfolio.jsx:100` passes a **component
reference** where `EmptyState` renders a **node**:

```jsx
// Portfolio.jsx — empty-state branch
<EmptyState
  icon={Wallet}            // ← component reference, not an element
  title="No investments yet"
  ...
```

```jsx
// packages/shared/src/components/EmptyState.jsx
{icon && (
  <div className="be-empty-state__icon-wrap">
    {icon}                 // ← rendered directly as a child
  </div>
)}
```

`Wallet` from `lucide-react@0.439.0` is a `forwardRef` object, not a function. Verified
directly:

```
$ node -e "const L=require('lucide-react'); console.log(typeof L.Wallet, Object.keys(L.Wallet), String(L.Wallet.$$typeof))"
object [ '$$typeof', 'render' ] Symbol(react.forward_ref)
```

React 18.3.1 refuses to render that object as a child. Unminified, the same crash reads:

```
Error: Objects are not valid as a React child (found: object with keys {$$typeof, render}).
  at EmptyState (…/packages/shared/src/components/EmptyState.jsx:20:3)
  at Portfolio  (…/packages/client/src/pages/Portfolio.jsx:33:20)
```

`Objects are not valid as a React child` **is** minified error #31 — same bug, different
message.

## 3. Why it appears "always" on this build

The crashing branch is the zero-investment empty state:

```jsx
if (!portfolio || (portfolio.invested === 0 && portfolio.currentValue === 0)) { … }
```

The dev seed client (`Dev Seed Client`, id `a9049d06-2315-4689-96c6-df3839dd9f15`) has an
empty ledger, so the API legitimately returns zeros and the branch is taken on **every**
successful load. Verified against the live dev API with a fresh token:

```
GET https://dev-app.beonedge.in/api/v1/client/portfolio
{"ok":true,"data":{"currentValuePaise":"0","totalInvestmentPaise":"0","totalReturnPaise":"0",
 "returnPercent":null,"returnSince":null,"lastUpdated":null,
 "summary":{"sipInstallmentCount":0,…},"pools":[]}}
```

Second, independent way into the same branch: `getPortfolio()` rejecting for any
non-401 reason (`.catch(() => setPortfolio(null))`) — a 5xx or a network hiccup also
renders the empty state and crashes. A 401 does *not* crash: `_util.js:170` retries once
via the registered session refresher, then emits `boe:session-invalidated` and the app
redirects to login (verified — section 5, repro 2).

## 4. Minification is a red herring

The clue "the version before compressing/minifying did not have this error" does not hold
up. Evidence:

- The crash reproduces **unminified**, on the vite dev server, with the full React message
  (section 5, repro 1).
- `minifyEnabled true` / `shrinkResources true` were added to
  `frontend_stack/app/android/app/build.gradle` in commit `1927619` (2026-08-04, between
  v0.7.0 and v0.7.1). That is **R8 on Android bytecode** — it never touches the web
  bundle. The JS has been minified by `vite build` in every APK ever produced.
- `icon={Wallet}` was introduced earlier, in commit `04207b2` (2026-08-03), i.e. before
  minification was configured.

What actually changed at v0.7.4 is **reachability, not correctness**: the seed client
(commit `984f7f4`, "seeded client") is the first account with a zero-value portfolio, so
it is the first one to render that branch. Minification's only contribution was replacing
the readable message with `Minified React error #31`.

## 5. How this was verified

Live emulator (`emulator-5554`, app pid at the time `16954`), Android WebView is
debuggable in this build:

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.beonedge.app.dev)
curl -s http://127.0.0.1:9222/json/list          # → url https://localhost/app/portfolio
# then drive Runtime.evaluate over ws://127.0.0.1:9222/devtools/page/<id>
# (Playwright's connectOverCDP does NOT work here: "Browser context management is not supported")
adb forward --remove tcp:9222                    # clean up afterwards
```

That probe returned the minified #31 text above, `boundaryShown: true`, and showed the
stored access token had already expired (10-minute lifetime: `iat` 11:32:10Z,
`exp` 11:42:10Z, observed at 11:50Z) — which is why the in-app request 401'd, but is a
*separate* effect from the crash.

Unminified repro (dev server on port 5199, seed-client login, three pages):

```
== navigating: portfolio ==
[pageerror] Error: Objects are not valid as a React child (found: object with keys {$$typeof, render}).
   crashed=true
== navigating: transactions ==   crashed=false
== navigating: profile ==        crashed=false
```

Broken-session repro (valid login, then both tokens corrupted, all 8 client pages): every
page redirects to `/app/login?from=…`, **none** hit the error boundary. So there is no
second, session-related crash to chase.

Scripts used (untracked, in `frontend_stack/app/`): `repro.tmp.cjs`, `repro2.tmp.cjs`.

## 6. Working-tree state to clean up before shipping

| Item | Path | Status |
|---|---|---|
| TEMP-DEBUG patch: error details shown unconditionally | `frontend_stack/packages/shared/src/components/ErrorBoundary.jsx` | **reverted** |
| Repro scripts | `frontend_stack/app/repro.tmp.cjs`, `repro2.tmp.cjs` | still untracked — delete or keep out of git |
| Sidecars for 0.7.4 | `emu/out/boe.dev.{client,admin}.0.7.4.json` | untracked; commit with the release |
| Docs moved out of `release_manager/` | now under `release_manager/docs/Completed/` | stage the moves (git shows 3 deletions) |

## 7. The fix, as applied

1. `Portfolio.jsx:100` now passes an element, matching every other call site:
   ```jsx
   icon={<Wallet size={40} strokeWidth={1.5} />}
   ```
   Portfolio was the only offender — confirmed by grepping every `<EmptyState` usage.
   `WithdrawalRequests.jsx:45`, `Notifications.jsx:88`, `Explore.jsx:385`,
   `Dashboard.jsx:239` and `Transactions.jsx:100` were already correct.

2. `EmptyState` now accepts either form. If `icon` is not a valid element but is a
   component type, it is instantiated rather than rendered as a child:
   ```jsx
   const iconNode = React.isValidElement(icon)
     ? icon
     : typeof icon === 'function' || (icon && typeof icon === 'object' && icon.$$typeof)
       ? React.createElement(icon, { size: 40, strokeWidth: 1.5 })
       : icon;
   ```
   This is the part that matters long-term: the footgun is invisible at the call
   site, produces an unreadable error in release builds, and only fires on a
   branch that most testing never reaches.

3. The TEMP-DEBUG patch in `ErrorBoundary.jsx` was reverted to
   `this.props.showDetails && this.state.error`.

Still worth considering (not done): pass `showDetails` from a build flag so dev
APKs always surface the real message. The whole reason this took a round trip is
that the release boundary hid the error text.

## 8. Loose ends noticed while debugging

- `Dashboard` logs `Each child in a list should have a unique "key" prop`.
- Several client API calls return **403** on every page after a successful
  seed-client login, and one request 404s. The 404 was **identified and fixed**:
  the app calls `GET /v1/app-config`, which did not exist in the backend. It is
  now implemented — see `release_manager/docs/IN_APP_UPDATE_FEATURE.md`. The 403s
  remain unexplained.
- Access tokens live 10 minutes; the refresher path works, but expiry during a
  parked emulator session muddies manual testing. Log in fresh before each round.
- Correct native refresh endpoint is `POST /v1/auth/native/refresh` with
  `{ refreshToken, rotationId }` — `/v1/client/auth/refresh` does not exist (404).

## 9. Related documents

- `release_manager/docs/IN_APP_UPDATE_FEATURE.md` — the in-app APK updater built
  in the same session, including the public `/v1/app-config` route that fixes the
  404 above.
- `release_manager/docs/Completed/APK_EXPORT_SHIP_HANDOFF.md` — APK export/ship
  pipeline, keystore and signing setup, versioning, sidecar contract.
- `release_manager/docs/Completed/BeOnEdge Application Deployment.md`
- `release_manager/docs/Completed/BeOnEdge Secure Home VPS.md`
