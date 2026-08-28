# capacitor.config.json — why each value is set

Capacitor's config has no comment syntax, so the reasoning lives here. Values were
checked against the installed Capacitor 8.3.4 source, not against documentation for
another version.

## `server.androidScheme: "https"`

Serves the WebView bundle from `https://localhost`. Two consequences that are easy
to forget:

- Every API request from the APK carries `Origin: https://localhost`. That exact
  string must appear in the backend's `WEB_ORIGIN_ALLOWLIST`, or CORS drops every
  reply and the app appears entirely offline against a healthy backend. See
  `DEPLOY.md` and `backend_controller/src/http/originExamples.test.ts`.
- Cookies cannot be shared with the real site origin, which is why native auth
  uses bearer tokens while browser admin uses same-site HttpOnly cookies.

## `server.cleartext: false` + `android.allowMixedContent: false`

**One network policy for every build. There is no development exception.**

Every backend the app talks to is HTTPS (`https://dev-app.beonedge.in/api`,
`https://app.beonedge.in/api`), and `emu/boe_update.sh` now refuses to build *any*
target — `--local` included — whose API origin is not `https://`.

Previously both flags were `true` and `network_security_config.xml` carried a
cleartext exception for `10.0.2.2`/`127.0.0.1`/`localhost` so an emulator could
reach a local HTTP backend. That capability shipped inside the production APK too.
A request carrying a bearer token must fail rather than silently downgrade to
unencrypted HTTP if DNS is poisoned, a captive portal intercepts, or a build is
repointed. A permission that exists only for workflow convenience is not worth
that, and two policies is the drift this repo keeps paying for.

To test against a local backend, give it TLS or point the build at the dev stack:

```
BOE_API_BASE_URL=https://dev-app.beonedge.in/api ./emu/boe_update.sh --local
```

`android/app/src/main/res/xml/network_security_config.xml` agrees with these two
flags on purpose — cleartext denied at the platform layer as well as the WebView.

## `android.zoomEnabled: false`

Set explicitly rather than relying on the framework default. Pinch-to-zoom on the
whole document is a webpage behaviour: it lets a user scale fixed chrome (bottom
nav, app bar, action bars) out of position, and it is one of the strongest "this is
a website" tells in the APK.

**This disables page zoom only. It must not be used to suppress OS text scaling.**
Android font-size and display-size settings, and TalkBack, must keep working — that
is an accessibility requirement and a separate mechanism from viewport/page zoom.
Validate at 100–200% OS font and display size before accepting this change.

If device testing shows page zoom still occurs, the next step is a fixed-scale
viewport for the native build only (`maximum-scale=1, minimum-scale=1,
user-scalable=no`, keeping `viewport-fit=cover`). A `MainActivity`
`WebSettings.setSupportZoom(false)` override is the last resort, not the first.

## `plugins.SystemBars.insetsHandling: "css"`

`css` is already the framework default; it is pinned here because the CSS now
*depends* on it. Verified in
`node_modules/@capacitor/android/.../plugin/SystemBars.java`:

- It sets `--safe-area-inset-top/right/bottom/left` on `document.documentElement`,
  in **dp**, and re-applies them on configuration and keyboard changes.
- It only does so when the viewport meta contains `viewport-fit=cover`
  (`hasViewportCover`) **and** on Android 15+ (`VANILLA_ICE_CREAM`), where it works
  around a Chromium bug that makes `env(safe-area-inset-*)` wrong.

So the two mechanisms cover different devices and the CSS must read Capacitor's
variable *with `env()` as the fallback*, never one alone:

```css
padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
```

`packages/design-tokens/src/tokens-core.css` owns that contract as `--be-safe-*`.
Do not remove `viewport-fit=cover` from `index.html`: it silently disables the
injection.

## `plugins.SystemBars.style: "LIGHT"`

BOE is a light-only product (ivory/white chrome, `color-scheme: light`, Android
force-dark disabled), so the system bars need **dark icons**.

The naming is counter-intuitive, so from the source: `setStyle` calls
`setAppearanceLightStatusBars(!style.equals("DARK"))`. `LIGHT` therefore means
"light appearance" = dark icons on a light background, which is what BOE wants.
`DARK` would give white icons and make them invisible against the ivory app bar.

## `loggingBehavior: "none"`

Capacitor's default (`debug`) prints every bridge call's arguments and return
value to logcat under the `Capacitor:V` tag. Those payloads include
secure-storage tokens and biometric credentials — see
`release_manager/docs/CAPACITOR_DEBUG_LOG_TOKEN_EXPOSURE.md` for the incident.

`none` disables bridge logging for every build, debug included; production
fails closed by construction rather than by a build-mode flag. The app ships no
logger of its own, so with the bridge silent nothing on the application side
can put session data into logcat.

Diagnostics do not use these tags: collect logcat only through
`emu/boe_logcat.sh` (explicit tag allowlist, bridge/WebView tags refused,
credential redaction at capture), and use `chrome://inspect` remote devtools
for WebView internals.

## Not set here

`hidden` is left at `false`: both bars stay visible. The app is edge-to-edge
(targetSdk 36) with insets reserved in CSS, not immersive.
