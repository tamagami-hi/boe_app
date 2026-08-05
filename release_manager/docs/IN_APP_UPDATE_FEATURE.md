# In-app APK updates

Status: **built and verified locally — two VPS operator steps outstanding (section 7)**
Date: 2026-08-05

BeOnEdge ships as a signed APK from the company VPS, not through the Play Store, so
nothing tells an installed app that a newer build exists. This adds that loop: the
app asks the backend on launch, and if a newer APK has been published it offers to
download and install it, showing progress while it does.

---

## 1. How it fits together

```
emu/boe_update.sh            builds boe.<target>.<variant>.<version>.apk
                             + sidecar .json (versionCode, sha256, sizeBytes, signing)
        │
release_manager/export.sh    stages both into $BUNDLE/apk/
release_manager/deploy.sh    rsyncs to $REMOTE_DIR/apk/
lib/apk_ship.sh              atomically publishes into the holder directory
        │
        ├─► nginx  /downloads/<variant>/<file>.apk        serves the bytes
        └─► backend  /srv/boe/apk/<variant>/  (mounted :ro)  reads the sidecars
                     │
                     GET /v1/app/update  ──►  app decides, downloads, installs
```

The filesystem the release tooling already treats as authoritative *is* the update
feed. **Publishing an APK is the only action needed to offer an update** — there is
no second place to bump, and nothing can advertise a version that was never
published.

The APK bytes are served by nginx rather than by the API, because streaming
multi-megabyte files through Fastify would tie up the backend for the duration of
every download.

## 2. Backend

`backend_controller/src/routes/publicAppRoutes.ts` (new, registered from
`runtime/composition.ts` next to the other public routes) adds two unauthenticated
endpoints. Both are called before login, so neither may require a session — a
build too old to authenticate must still be able to learn that it has to update.

### `GET /v1/app-config`

Returns the published app configuration, `{ version, config, publishedAt }`.

This route **did not exist**. `frontend_stack/packages/shared/src/appConfig.js:451`
has always called it, so every app launch was taking a 404 and falling back to its
bundled defaults. That is the mystery 404 recorded in
`PORTFOLIO_REACT31_CRASH_HANDOFF.md` section 8.

### `GET /v1/app/update`

Query (Zod, `.strict()` — an unknown parameter is a 400, not a silent ignore):

| Param | Meaning |
|---|---|
| `platform` | `android` (only value today) |
| `variant` | `client` \| `admin` — a closed set, because it becomes a path segment |
| `applicationId` | the caller's package name |
| `versionCode` | the running build's version code |
| `version` | the running build's dotted version, e.g. `0.7.4` |

Response:

```json
{ "ok": true, "data": {
  "platform": "android", "variant": "client",
  "updateAvailable": true, "mandatory": false,
  "current": { "version": "0.7.3", "versionCode": 703, "applicationId": "com.beonedge.app.dev" },
  "latest": {
    "version": "0.7.5", "versionName": "0.7.5", "versionCode": 705,
    "applicationId": "com.beonedge.app.dev", "sizeBytes": 2555925,
    "sha256": "4f5e5314…d348",
    "url": "https://dev-app.beonedge.in/downloads/client/boe.dev.client.0.7.5.apk",
    "publishedAt": "2026-08-05T10:47:24Z"
  },
  "minimumSupportedVersion": null, "maintenance": {}
} }
```

Rules, and why each exists:

- **Newest = highest `versionCode`.** That is the only ordering Android itself
  enforces. `versionName` carries a git label in dev builds and is not comparable.
- **`applicationId` must match.** Dev and prod APKs are signed with different
  certificates and carry different ids; offering a dev APK to a production install
  would produce a download that can only ever fail to install.
- **`signing` must be `release`.** A debug-signed APK cannot upgrade a
  release-signed install.
- **The `.apk` must exist on disk.** `apk_publish_remote_atomic` moves the APK and
  its sidecar as two separate renames, so there is a window where the sidecar for a
  new version exists but its APK does not. Advertising in that window would hand
  out a dead link.
- **`mandatory`** is true when the *running* version is below
  `minimumSupportedVersion.android` from the published app config — independent of
  whether a newer APK happens to be on disk, because "you are too old to use this"
  is a statement about the caller. An absent or unparseable floor is never
  mandatory: a config typo must not lock every user out. This finally makes
  `minimumSupportedVersion` live data; it was previously writable by an admin and
  read by nobody.
- **A missing mount is not an error.** With `APK_RELEASE_ROOT` unset the endpoint
  answers "no update available". An absent update feed must never break startup.
- Directory listings are memoised for 30 s: every app launch hits this endpoint
  while publishes happen a few times a day.

New environment variables (`runtime/environment.ts`, both optional):

| Variable | Purpose |
|---|---|
| `APK_RELEASE_ROOT` | directory holding one subdirectory per variant, mounted read-only |
| `APK_DOWNLOAD_BASE_URL` | public prefix nginx serves those directories at |

## 3. Infrastructure

**nginx** (`release_manager/nginx/dev-app.beonedge.in.conf`, `app.beonedge.in.conf`):

```nginx
location ~ "^/downloads/client/([A-Za-z0-9][A-Za-z0-9._-]*\.apk)$" {
    alias /srv/dev_stack/BOE_APP/dev_release/dev_apk/$1;
    auth_basic off;
    add_header Cache-Control "public, max-age=86400, immutable" always;
    add_header X-Robots-Tag "noindex, nofollow" always;
}
location /downloads/ { return 404; }
```

Deliberately a regex matching only a plain `.apk` filename under a known variant:
sidecar JSONs stay private, directory listings are impossible, and `..` cannot
match the filename character class. `auth_basic off` because if dev basic auth is
ever enabled the updater cannot supply credentials. On prod the admin variant is
additionally restricted to loopback — it is an internal tool.

**compose** (both stacks): the backend gained read-only mounts and the two env
vars.

```yaml
volumes:
  - ${APK_CLIENT_DIR:-…/dev_apk}:/srv/boe/apk/client:ro
  - ${APK_ADMIN_DIR:-…/dev_admin_apk}:/srv/boe/apk/admin:ro
```

Read-only because the backend must never be able to alter a released artifact.

`paths.json` needed no change: the holder directories there remain the single
source of truth and are referenced from `.env`, not duplicated.

## 4. Android

`frontend_stack/app/android/app/src/main/java/com/beonedge/app/AppUpdatePlugin.java`
(new, `@CapacitorPlugin(name = "AppUpdate")`, registered from `MainActivity.onCreate`
before `super.onCreate`).

| Method | Behaviour |
|---|---|
| `getInfo()` | `applicationId`, `versionName`, `versionCode`, `canInstall` |
| `canInstall()` | whether "install unknown apps" is allowed for this app |
| `requestInstallPermission()` | opens the system settings page for it |
| `downloadUpdate({url, sha256, sizeBytes})` | streams to app-private storage, emits `downloadProgress`, verifies the digest |
| `installUpdate({path})` | hands the verified file to the system package installer |

Design points:

- **Download and install are separate calls.** The user sees a progress dialog
  while bytes arrive and an explicit *Install* button when they are verified.
  Fusing them would fire the system installer without warning, which reads as a
  hijack and is easy to dismiss by accident — and a dismissed install would then
  need a fresh download.
- **The digest is checked on device, not trusted from TLS.** TLS protects the
  transfer; it says nothing about whether the bytes on the VPS are the bytes the
  release pipeline produced. A truncated publish, a half-replaced file or a
  tampered artifact fails closed before reaching the installer. A missing `sha256`
  is a hard rejection rather than a skipped check.
- **https only**, because the payload is an executable about to be installed.
- **The file lives in `getCacheDir()/updates/`.** App-private, so no storage
  permission is needed and no other app can substitute the file between
  verification and install. `installUpdate` re-checks the canonical path against
  that directory: `path` arrives from the web layer, and an arbitrary path would
  let a compromised WebView ask for any readable APK on the device to be installed.
- **Written to `.part`, renamed on success**, so a partial or mismatched download
  never appears at the path `installUpdate` uses.
- **`installUpdate` resolves as "installer launched", not "installed".** A
  successful install replaces the process; there is nobody left to hear a success
  callback.

Manifest changes: `REQUEST_INSTALL_PACKAGES`, and a `<cache-path name="app_updates"
path="updates/" />` entry in `file_paths.xml` so the existing
`${applicationId}.fileprovider` can hand the file to the installer. Scoped to that
one subdirectory rather than the whole cache.

## 5. App UI

`frontend_stack/packages/client/src/services/appUpdate.js` is the web-side contract
over the plugin plus the manifest fetch. It uses plain `fetch` rather than the
shared `apiRequest` so the launch-time check stays out of the 401-refresh /
session-invalidation machinery, and every function degrades to "no update" on the
web build or on any error — the updater must never break the splash screen.

`components/AppUpdateGate.jsx` renders the dialog. Phases:

```
prompt      "Update available" — Version X, Size Y   → Update now / Later
permission  Android needs "install unknown apps"     → Open settings
downloading small box, progress bar, N KB / M KB
ready       "Downloaded and verified"                → Install now
failed      what went wrong                          → Try again / Later
```

- Mounted in `ClientApp` **above** the routes, so a mandatory update is enforced on
  the login screen too: a build too old to talk to the API must not be dismissable
  by simply not logging in.
- The check runs immediately (overlapping the splash's own 1.6 s minimum, so launch
  latency is unchanged) but the dialog is withheld while the splash route is
  showing — interrupting the brand animation with a system dialog looks like a
  crash.
- The install permission is requested **before** the download: a download that
  ends at a permission wall is a wasted download. The permission is granted outside
  the app, so the gate re-reads it on `appStateChange → isActive` and starts the
  download automatically.
- *Later* is remembered per `versionCode` in `sessionStorage`, so declining does not
  nag for the session but a genuinely newer build asks again next launch. Mandatory
  updates ignore it and hide every dismiss button.

## 6. Verification performed

Backend — `src/routes/publicAppRoutes.test.ts`, 14 cases driving the route through
real files on disk: picks the highest `versionCode`; no update when already newest;
`applicationId` mismatch never offered; debug-signed ignored; sidecar-without-APK
ignored; unmounted root answers no-update; absent base URL yields a null URL;
mandatory only below the floor; never mandatory without a floor; `0.10.0 > 0.9.0`
(numeric, not lexicographic); git-suffixed labels tolerated; unknown query param
→ 400; `variant=../../etc` → 400; `/v1/app-config` serves the published config.
Full suite: **393 tests pass**, typecheck and lint clean.

Emulator — a throwaway package (`com.beonedge.app.updtest`, versionCode 700) built
against a local stub API, so the installed `com.beonedge.app.dev` 0.7.4 was never
touched. Confirmed by screenshot at each step: prompt after the splash over the
login screen → determinate progress → "Ready to install" → the **system package
installer launched**. The downloaded file landed at
`cache/updates/update.apk` at exactly the expected byte count, and the
`.part → update.apk` rename only happens after the digest matches, so real-HTTPS
streaming, hashing and atomic finalise are all proven.

Negative paths, driven directly against the plugin over CDP — all rejected:
wrong `sha256` ("does not match the expected checksum"), `http://` URL ("must use
https"), missing `sha256`, and `installUpdate` on a real file outside
`cache/updates` ("refusing to install a file from outside the update directory").

Two defects were found and fixed by this exercise:

1. `call.getLong("sizeBytes")` returned null — Capacitor types small JS numbers as
   `Integer` — so the progress bar silently fell back to indeterminate. Now read via
   `optLong()`. The manifest's size also now takes priority over `Content-Length`,
   because transport compression makes `Content-Length` the *compressed* count,
   which would drive progress past 100% and finish early.
2. `formatBytes(0)` returned `''`, so the progress row read `/ 271 KB`. It now
   returns `0 KB`, and the prompt's *Size* label is guarded on the number.

**Not yet verified end to end against the real VPS**, because that needs the two
operator steps below plus a deploy.

## 7. Operator steps still required

### 7.1 Let nginx read the APK directories (**blocking**)

nginx runs as `www-data`, but the holder directories sit behind two `750`
directories owned by `beonedge`:

```
$ namei -l /srv/dev_stack/BOE_APP/dev_release/dev_apk/
drwxr-xr-x root     root     /
drwxr-xr-x beonedge beonedge srv/dev_stack
drwxr-x--- beonedge beonedge BOE_APP        ← www-data cannot traverse
drwxr-x--- beonedge beonedge dev_release    ← www-data cannot traverse
drwxr-xr-x beonedge beonedge dev_apk
```

Until traverse is granted, `/downloads/...` returns **403**. The minimal fix grants
execute-only (traverse) to that one user, leaving the `750` posture otherwise
intact:

```bash
sudo setfacl -m u:www-data:x /srv/dev_stack/BOE_APP /srv/dev_stack/BOE_APP/dev_release
# prod stack:
sudo setfacl -m u:www-data:x /srv/dev_stack/BOE_APP /srv/dev_stack/BOE_APP/prod_release
```

`setfacl` is present on the VPS. This was **not** applied — it changes permissions
on a shared system and needs a deliberate decision. The backend container is
unaffected either way: a bind mount reads as root inside the container.

### 7.2 Add the new variables to the deployed `.env`

`/srv/dev_stack/BOE_APP/dev_release/.env` has no `APK_*` variables yet. Copy the
block from `release_manager/stacks/dev_release/.env.example`:

```
APK_CLIENT_DIR=/srv/dev_stack/BOE_APP/dev_release/dev_apk
APK_ADMIN_DIR=/srv/dev_stack/BOE_APP/dev_release/dev_admin_apk
APK_RELEASE_ROOT=/srv/boe/apk
APK_DOWNLOAD_BASE_URL=https://dev-app.beonedge.in/downloads
```

Leaving `APK_DOWNLOAD_BASE_URL` blank is a safe way to ship the code with the
feature dormant: the endpoint still answers, but without a URL the app treats the
result as "no update".

### 7.3 Deploy and smoke-test

1. Deploy the backend (new route + env) and reinstall the nginx vhosts, then
   `nginx -t && systemctl reload nginx`. Both edited vhosts pass `nginx -t` locally.
2. `curl -sI https://dev-app.beonedge.in/downloads/client/boe.dev.client.0.7.3.apk`
   → expect `200`, not `403`.
3. ```
   curl -s 'https://dev-app.beonedge.in/api/v1/app/update?platform=android&variant=client&applicationId=com.beonedge.app.dev&versionCode=700&version=0.7.0'
   ```
   → expect `updateAvailable: true` and a `latest.url` that matches step 2.
   (The holder directory currently has 0.7.0 – 0.7.3; 0.7.4 has not been shipped.)
4. Install an older client APK on the emulator and confirm the prompt appears after
   the splash, then let it download and install for real.

## 8. Notes for later

- Only the `client` variant is wired into the app. The endpoint already accepts
  `variant=admin`, and prod nginx restricts that path to loopback.
- The update check is one request per launch. If a long-lived session should also
  notice a release, add a periodic or `appStateChange`-triggered re-check.
- `minimumSupportedVersion.android` is now enforced but must still be published by
  an admin through the app-config screen. Nothing sets it automatically.
- `release_manager/lib/apk_ship.sh` prunes nothing, so the holder directory grows
  one APK per release. Only the highest `versionCode` is ever offered, but old
  builds stay publicly downloadable by exact filename.
- `CLIENT_APP_VERSION` in `services/authApi.js` is still the hardcoded `'1.0.0'`
  used for `device.appVersion` at login. The updater does not use it — it reads the
  real version from the package manager — but the login telemetry is still wrong.
