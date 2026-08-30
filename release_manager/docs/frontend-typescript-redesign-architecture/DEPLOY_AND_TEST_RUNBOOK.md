# Deploy and test runbook

Written 2026-08-29 against `5bec7a6`. This is the handover for taking the stack to the
VPS and proving it works. Everything below was either verified on the development
machine (stated as such) or is a command for you to run because it needs the VPS, a
database, a device, or money.

## 0. What changed that affects deployment

**Two migrations, and they are ordered before code.**

| Migration | Adds | Why the order matters |
| --- | --- | --- |
| `046_client_web_sessions.sql` | `client_web` to `session_channel` | A client browser sign-in writes an `auth_login_events` row with that channel inside its transaction. Backend code that writes the label against a database at 045 fails the insert on an invalid enum value. |
| `047_admin_native_sessions.sql` | `admin_native` to `session_channel`; renames `auth_sessions_active_native_device_uk` to `auth_sessions_active_bearer_device_uk` on `(user_id, channel, device_id_hash)` | Same reason. Also restates two CHECK constraints so the CSRF rule is expressed against the two cookie channels rather than "not native". |

`043_hosted_checkout_dispatch_claim.sql` was already pending from an earlier release and
is still required before Phase 7 payments work. Confirm what your target database is at
before deploying.

**One env value to check.** `WEB_ORIGIN_ALLOWLIST` must contain the origins that serve
the client and admin web apps. Both cookie sessions call `validateWebOrigin`, and a
missing origin fails closed — sign-in returns an authorization error rather than a CORS
message, so it looks like bad credentials. `.env.example` carries `http://localhost:5174`
but not `:5175`; add the admin dev origin locally if you use it.

Nothing else changed shape. No new secret, no new service, no new worker, no new port.

## 1. Deploy

Yours to run — I do not run `deploy.sh`, `export.sh`, `rollback.sh`, or `git push`, and
I do not connect to the VPS.

```
# from the repo root, on the VPS side of your normal flow
./release_manager/status.sh        # Exports -> build images, then Ship + Deploy
```

Migrations first, then the image. If your flow applies migrations as part of deploy,
verify the order rather than assuming it:

```
psql "$DATABASE_URL" -c "select name from schema_migrations order by name desc limit 4"
psql "$DATABASE_URL" -c "select enum_range(null::session_channel)"
```

Expect `047_admin_native_sessions.sql` newest, and the enum to list
`native, web, client_web, admin_native`.

## 2. Prove the deploy is alive

```
curl -sS https://<host>/api/v1/health | jq
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/health      # nginx, client image
```

The container runs as `101:101` on a read-only root filesystem with `tmpfs /tmp`, and
answers `GET /health` from nginx. That is asserted by
`release_manager/tests/runtime_contract.test.sh`, which passes here but has never been
run against a live container.

## 3. The client web session — the change most likely to surprise you

This release moves the browser client from bearer tokens in `localStorage` to an
HttpOnly cookie session. Verified on the development stack by
`test_e2e/client-cookie-session.mjs` (all checks green). Re-run the same assertions
against the deployed origin by hand:

1. Sign in at `https://<client-host>/login`.
2. DevTools → Application → Local Storage. Expect **only** `boe.client.principal` and
   `boe.client.csrfToken`. If you see `boe.client.accessToken` or
   `boe.client.refreshToken`, the cookie path did not engage and you are on the old
   behaviour.
3. DevTools → Application → Cookies. Expect `boe_client_access` and
   `boe_client_refresh`, both HttpOnly. On HTTPS they will be `__Host-` prefixed.
4. Hard-reload. You must stay signed in. This is the exact behaviour an earlier attempt
   broke — see D-037.
5. Open a new tab to `/portfolio`. Still signed in.
6. Open a private window to `/dashboard`. Must redirect to `/login`.

Cross-scope isolation is the security claim behind this and the admin bearer channel.
It is asserted by 20 unit tests against a stubbed database; these four commands are the
first time it meets PostgreSQL. **Each must answer `SESSION_INVALID`, not
`AUTHORIZATION_DENIED`** — the latter means the channel check did not fire and only the
permission check stopped it, which is the pre-existing defect rather than the fix:

```
# admin cookie replayed under the client cookie name
curl -sS -o /dev/null -w '%{http_code}\n' -b 'boe_client_access=<ADMIN_ACCESS>' https://<host>/api/v1/client/portfolio
# client cookie replayed under the admin cookie name
curl -sS -b 'boe_access=<CLIENT_ACCESS>' https://<host>/api/v1/admin/session | jq '.error.code'
# a client bearer presented to an admin route
curl -sS -H "authorization: Bearer <CLIENT_ACCESS>" https://<host>/api/v1/admin/session | jq '.error.code'
# an admin bearer presented to a client route
curl -sS -H "authorization: Bearer <ADMIN_ACCESS>" https://<host>/api/v1/client/portfolio | jq '.error.code'
```

## 4. Cursor pagination — new, and never executed against PostgreSQL

Every list now pages. The keyset predicates have been read and typechecked but no
paginated route has touched a database, because the integration tests need
testcontainers. This is the highest-value thing for you to exercise.

```
# first page
curl -sS -b "$COOKIES" 'https://<host>/api/v1/client/transactions?limit=2' | jq '{n:(.data|length), next:.meta.page.nextCursor}'
# second page, using the cursor verbatim
curl -sS -b "$COOKIES" 'https://<host>/api/v1/client/transactions?limit=2&after=<NEXT_CURSOR>' | jq '{n:(.data|length), next:.meta.page.nextCursor}'
```

What to look for: page two must contain **different** rows from page one, and the
cursor must be an opaque two-part `base64url.base64url` string, never an id or an
offset. Then take a cursor minted under one filter and present it with a different
filter — it must be refused with `CURSOR_INVALID`, not silently accepted.

In the UI, on `/activity`, `/statements`, and the admin audit and payments queues:
press **Load more** and confirm rows append rather than replace, then change a filter
and confirm the list restarts from the top rather than appending to a stale chain.

## 5. The APKs

Both build. Debug 8,666,647 B each; release 2,312,387 B (client) and 2,319,059 B
(admin) after R8. Release APKs are **unsigned** — no keystore is configured — so nothing
has been installed from them and R8's runtime behaviour is unproven.

```
BOE_APK_VERSION=<x.y.z> ./emu/boe_update.sh --dev --no-install --both
```

`boe_update.sh` could not run at all before this release (it resolved the Android
project under a directory that no longer exists and exited on its own precondition
check). The paths are fixed and every one was verified to exist, but the script has
still never completed a run — this command is that first run.

### What was proven on a device, and what was not

Verified on `emulator-5554` over the Chrome DevTools Protocol (see
`test_e2e/apk-bridge-probe.mjs`), which matters because **the Capacitor bridge had never
been registered before this release** — `window.Capacitor.Plugins` was empty, so every
native wrapper silently resolved to `null`:

```
isNativePlatform()   true
getPlatform()        android
Capacitor.Plugins    App, AppUpdate, Browser, CapacitorCookies, CapacitorHttp,
                     LocalNotifications, NativeBiometric, SecureStorage, SystemBars,
                     SystemChrome, WebView
```

`SecureStorage` appearing there is the fix for a second defect: the wrapper had asked
for a plugin named `SecureStoragePlugin` with four method names the plugin does not
expose, so Android could never persist a session across a cold start.

Still unproven, and all of it is **first-run** because the bridge only started working
now. Re-run these on a device with a reachable backend:

1. **Sign in, force-stop, relaunch.** You must still be signed in. This proves Secure
   Storage actually persists — it never has.
2. **The five Back rules** in doc 08. `NativeBackCoordinator` has literally never
   executed; what looked correct before was Capacitor's default with no listener.
3. **The device lock.** Set a PIN, background the app for more than 120 s, resume — the
   lock must appear, and hardware Back must not dismiss it. Cold start with a PIN set
   must show no dashboard frame behind the lock.
4. **Biometric.** Enrol a fingerprint, toggle on, resume after 120 s, expect the prompt.
   Then remove all enrolments and confirm the toggle disables itself.
5. **The update digest refusal.** Publish an APK, corrupt the sidecar `sha256`, and
   confirm the download fails closed and **no installer opens**. This is the only check
   that proves the point of the update gate.
6. **Mandatory update.** Publish a `minimumSupportedVersion` above the installed build
   and confirm the block appears before any authenticated screen paints.
7. **Edge-to-edge.** This emulator runs WebView 133, so Capacitor takes its documented
   native-inset fallback and `--safe-area-inset-*` correctly reads `0px`. On a device
   with WebView ≥ 140 the passthrough path runs for the first time: confirm the page
   paints under the bars and that
   `getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top')`
   is non-zero.

To attach DevTools to a debug APK yourself:

```
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.beonedge.app)
node test_e2e/apk-bridge-probe.mjs
```

## 6. Money has still never moved

No PhonePe credentials exist outside the VPS, so `/pay` returns
`DEPENDENCY_UNAVAILABLE` locally and the following have never run end to end:

- a completed lump-sum payment producing one payment, one attempt, one allocation and
  one acknowledgement row
- AutoPay mandate authorisation
- the admin refund, mandate and support-ticket screens with real rows — they have only
  ever been audited empty

Set `PAYMENTS_SERVICE_URL`, `PAYMENTS_SERVICE_SECRET`, `PHONEPE_MERCHANT_ID`,
`PHONEPE_CALLBACK_USERNAME` and `PHONEPE_CALLBACK_PASSWORD` on the target and walk one
real payment. The PhonePe API credentials live on the payment service in `boe_landing`,
not here: this backend holds only the callback credentials. Two admin screens (`MandateListScreen`,
`MandateDetailScreen`) still format rupees with a local `Intl.NumberFormat` instead of
`MoneyValue`, so check they agree with the rest of the app once real amounts appear.

## 7. Gates, and what they do and do not cover

Green on the development machine at `5bec7a6`:

| Gate | Result |
| --- | --- |
| `frontend_stack_ts` `npm run check` | typecheck, lint, 19 files / 186 tests, both variant builds |
| `check-android-dist` | client 847,300 B, admin 867,267 B; no chunk cycle; cross-target contents clean |
| `check-bundle-boots` | 7 chunks, no error |
| `packages/contracts` `npm run check` | 101 operations, no bypass |
| `backend_controller` `npm run check` | 76 files / 744 tests, coverage 80.08% branches |
| `release_manager/verify.sh` | 108 passed, 0 failed, 1 skipped (remote) |
| `test_e2e/frontend-ts-smoke.mjs` | 71/71, money chain exactly `₹51,25,000` |
| `test_e2e/frontend-ts-audit.mjs` | 141 page audits, 0 errors, 0 warnings |
| `test_e2e/client-cookie-session.mjs` | all checks passed |

**Coverage headroom is about one branch.** The backend gate is 80% and it measures
80.08%. One new uncovered branch outside the excluded directories will fail
`npm run check`. The thin spots are `runtime/composition.ts` (72%) and
`providers/phonepe/gatewayFailure.ts` (69%).

**Backend integration tests were not run.** They need testcontainers, which I did not
start. They compile. Run them where Docker is available:

```
cd backend_controller && npx vitest run test/integration
```

That is the only thing standing between "the SQL reads correctly" and "the SQL works",
and it covers the new pagination predicates, the two session channels, and the fund
cache invalidation added for R24.

## 8. Known open items

Not defects in this release, but do not read the numbered blueprint documents without
these:

- `securityStore` hashes the device PIN with a plain unsalted SHA-256 in
  `localStorage`. A 4-digit space is trivially enumerable by anyone who can read
  storage. The product copy already says the PIN is a convenience and not a security
  boundary; it is not a KDF and should not be presented as one.
- Multi-tab admin writes still fail CSRF once after a rotation. Only the refresh path
  was made self-healing.
- `check-android-dist`'s chunk-acyclicity check now only sees cycles that cross a chunk
  boundary; because all application code is in one chunk, an application-level cycle is
  invisible to it. It did catch a real `app → vendor → app` cycle in this release, so it
  is not vacuous.
- Doc 04 is stale enough that `packages/contracts` is the safer read. Doc 10's Phase 13
  tables have four rows that are factually wrong — see D-046 to D-051.
