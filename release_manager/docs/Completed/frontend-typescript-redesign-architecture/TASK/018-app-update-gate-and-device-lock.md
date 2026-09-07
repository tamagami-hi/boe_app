# 018 — The app-update gate, a real device lock, and the plugin bridge that was never built

Closes known gaps 2 and 3 from `README.md`. Decisions: D-040, D-041, D-042. Log: Entry 022.

Scope was `frontend_stack_ts/` only. `backend_controller/` and `packages/contracts/` were not
touched: `GET /v1/app/update` and the `getAppUpdate` descriptor already existed and were read as
given.

## 0. The finding that had to be fixed first: nothing was ever registered on the bridge

`src/platform/capacitor.ts` reaches native through `window.Capacitor.Plugins[name]`. Nothing in
`src/` ever imported `@capacitor/core` or any plugin package, and `registerPlugin` is the *only*
thing that writes to that object:

```
node_modules/@capacitor/core/dist/index.js:174   Plugins[pluginName] = proxy;
```

`native-bridge.js`, injected by `@capacitor/android`, does not populate `Plugins` from
`PluginHeaders` — it only reads `cap.Plugins.App` where it needs it, and warns when absent. So on a
real device `Capacitor.Plugins` was `{}` and every wrapper in `src/platform/` was resolving to
`null`:

| Wrapper | Effect of the empty bridge |
| ------- | -------------------------- |
| `lifecycle.ts` | `onHardwareBack` / `onResume` / `onPause` / `onAppStateChange` never subscribed. `NativeBackCoordinator` was inert; Android Back fell through to Capacitor's own default. |
| `systemChrome.ts` | `applySystemChrome` was two silent `tryCallPlugin` no-ops. |
| `openExternal.ts` | Always took the `window.open` fallback, never the in-app Browser. |
| `secureStorage.ts` | `available()` returned false, so native token persistence fell back to nothing. |

This is why Entry 019's device run still looked correct: "Back on the root screen exits to the
launcher" is Capacitor's *default* behaviour when no JS `backButton` listener exists, and the status
bar seam was fixed in `colors.xml`, not through the `SystemBars` call.

Both gaps in this task are unimplementable on top of that. `AppUpdatePlugin` is registered on the
Java side in `MainActivity` but had no JS counterpart, and `@capgo/capacitor-native-biometric` only
self-registers when its module is imported. So `src/platform/plugins.ts` was added and is called
from `main.tsx` before the shell loads. See D-040 for why the three names are explicit rather than
"import every plugin package".

**Not fixed here, reported instead:** `secureStorage.ts` asks for `"SecureStoragePlugin"`, but
`@aparajita/capacitor-secure-storage` registers itself — and annotates its Java class — as
`"SecureStorage"`. The name has never matched. Fixing it changes where client bearer tokens live on
Android, which is an auth-path change that wants its own task and a device to prove it.

## 1. The app-update gate

Nothing consumed `getAppUpdate`. Four pieces now do.

`src/platform/appUpdate.ts` wraps the plugin in the established shape (`isNative()` guard,
`callPlugin`, `platformError`): `readInstalledApp`, `canInstallUpdates`,
`requestInstallPermission`, `downloadUpdate`, `installUpdate`, `onDownloadProgress`. It refuses to
call `downloadUpdate` without a 64-character lowercase hex digest and refuses a non-`https` URL, and
after the download it compares the digest the plugin echoes back against the digest it was asked
for. The Java plugin already refuses a missing `sha256`; this makes the web layer refuse first, so
the guarantee does not depend on one side alone.

`src/features/app-update/updateDecision.ts` holds the decision as a pure function over the
contracted `AppUpdateData`, so it is testable without a device:

- `installableRelease` returns a release only when `updateAvailable` is true, `latest` is present,
  `latest.url` is `https`, and `latest.sha256` matches `/^[a-f0-9]{64}$/`. Anything else is `null`,
  and `null` means no download is ever offered.
- `decideAppUpdate` returns `mandatory` whenever the feed says `mandatory`, **independent of
  `updateAvailable`** — because the backend computes the two separately: `mandatory` compares the
  *running* build against `minimumSupportedVersion`, while `updateAvailable` compares it against
  whatever APK is on the release mount. A build can be below the floor with nothing newer
  published. `mandatory` therefore carries `release: UpdateRelease | null`, and the blocking screen
  is honest about the case where there is nothing to download (D-042).
- Otherwise it is `optional` when there is an installable release, and `none` when there is not.

`src/app/native/AppUpdateGate.tsx` is mounted in both shell roots inside `ApiProvider` — it needs
the transport, and `AppProviders` is the parent of `ApiProvider`, not a descendant. `mandatory`
replaces the children entirely; `optional` renders the children plus a dismissible sheet keyed on
`versionCode`, so dismissing it does not suppress the *next* release.

The feed query is `enabled: canCheckForUpdates()` (native and plugin present) and `retry: false`.
A failed update check must never block the app: an unreachable server would otherwise be
indistinguishable from a mandatory update.

## 2. The device lock

`securityStore.ts` already hashed and verified a PIN. Nothing outside `DeviceSecurityScreen`
called it, and `@capgo/capacitor-native-biometric` was in both plugin allowlists but imported
nowhere, so the biometric switch wrote a flag and promised protection it did not provide.

`src/platform/biometric.ts` adds `readBiometricCapability()` and `verifyBiometric()`.
`readBiometricCapability` calls `isAvailable({ useFallback: false })`, so the device PIN/pattern
does **not** count as an enrolled biometric — the switch is only offered when a fingerprint or face
is actually enrolled, and `DeviceSecurityScreen` switches a stale `on` flag back off when the
device reports none. `verifyBiometric` maps the plugin's error codes to
`cancelled | unavailable | failed` so the lock screen can say which happened instead of "something
went wrong".

`src/features/device-security/lockDecision.ts` is the pure decision:

```
shouldLock({ native, enrolled, trigger, leftAt, now, idleThresholdMs })
```

Not native, or nothing enrolled → never. `cold-start` → always. `resume` → when the time away
reaches the threshold (120 s), and also when the time away cannot be established at all (`leftAt`
null, either value non-finite, or a clock that moved backwards). The unknown cases lock rather than
pass, which is the only safe direction for a lock.

`src/app/native/deviceLock.ts` holds the lock as a module-level store with subscribers, in the same
shape as `systemChrome.ts`. That is deliberate: `NativeBackCoordinator` has to consult the lock, and
a context would have forced a provider-order dependency between the two.

`src/app/native/DeviceLockGate.tsx` evaluates on mount and on `appStateChange`, and renders
`LockScreen` after its children. It sits **above** `ToastProvider` in `AppProviders` so its layer
is last in the DOM — `z-toast` is shared with the toast region, and DOM order breaks the tie.

`NativeBackCoordinator` now returns before anything else when `isDeviceLocked()`. Note the order:
the check is *before* `dismissTop()`, because the lock is deliberately not an overlay-stack entry.
Registering it would have made hardware Back dismiss it — the precise bypass this had to prevent.
For the same reason the "I have forgotten this PIN" confirmation is inline in the lock panel rather
than a `ConfirmDialog`: that portals to `document.body` at `z-overlay` (900) and would render
*behind* the lock layer at `z-toast` (1000).

The lock engages regardless of session status, so no authenticated frame is ever painted before it
appears. The escape hatch that makes that safe — and prevents a forgotten PIN from bricking the
install — removes the PIN and signs out locally. D-041 has the argument.

The existing honesty copy is unchanged, byte for byte, and now appears on the lock screen too. It
moved to `features/device-security/copy.ts` so both screens read one string rather than two copies.

## 3. Styling

Everything went through the recipe layer. The full-screen blocking layer is generic — two features
needed it — so `BLOCK_LAYER`, `BLOCK_PANEL`, `BLOCK_HEAD`, `BLOCK_MARK`, `BLOCK_PROGRESS_TRACK` and
`BLOCK_PROGRESS_FILL` were added to `src/ui/recipes/overlay.ts` rather than duplicated per feature.
`recipes.test.ts` would have failed on the duplicate anyway, which is the guard working as intended.
No hex literal, no `env(safe-area-inset-*)`, no breakpoint outside `sm/md/lg/xl`. The download
progress bar animates `transform: scaleX()`, not `width`.
