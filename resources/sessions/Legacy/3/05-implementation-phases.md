# Implementation Phases

## Phase 0: Baseline And Guardrails

Purpose: capture current working behavior before the split.

Tasks:

- Run `npm run build` from `frontend_stack`.
- Run `npm run build:android` from `frontend_stack`.
- If emulator is running, run `bash emu/boe_update.sh`.
- Record any existing failures before changing code.
- Confirm Security & PIN currently works in browser/mobile viewport.

Expected result:

- Known baseline for browser build.
- Known baseline for Android build.
- No platform split code yet.

## Phase 1: Define Platform Contract

Purpose: add stable interfaces before moving behavior.

Tasks:

- Create `packages/client-platform-web`.
- Create `packages/client-platform-native`.
- Add `index.js`, `info.js`, `storage.js`, `security.js`, `lifecycle.js`, and `errors.js` to both packages.
- Implement web package first using current browser behavior.
- Implement native package initially as safe stubs:
  - Native platform info works.
  - Storage has explicit secure-storage unavailable state until plugin is selected.
  - Biometric returns unavailable until plugin is selected.
  - Lifecycle uses safe DOM fallback.

Expected result:

- `@beonedge/client-platform` can point at web and build.
- Android build can point at native and still build with biometric disabled.

## Phase 2: Add Vite Alias Selection

Purpose: make build target select the correct platform package.

Tasks:

- Update `frontend_stack/app/vite.config.js`.
- Add alias for `@beonedge/client-platform`.
- Default alias to web.
- Use `VITE_BEO_PLATFORM=native` for Android build.
- Update `frontend_stack/app/package.json` Android script.

Recommended script:

```json
"build:android": "VITE_BEO_APP_TARGET=client VITE_BEO_PLATFORM=native vite build --mode android && node scripts/check-android-dist.mjs"
```

Expected result:

- `npm run build` resolves web platform.
- `npm run build:android` resolves native platform.
- No page imports need to know the concrete package path.

## Phase 3: Move Browser Logic Into Web Platform Package

Purpose: remove direct browser-only security behavior from shared client service.

Tasks:

- Move WebAuthn helpers from `securitySettings.js` into `client-platform-web/src/security.js`.
- Move device label and device ID helpers into platform security/device or info module.
- Move local/session storage access into `client-platform-web/src/storage.js`.
- Keep `securitySettings.js` public function names stable for UI callers:
  - `getSecurityState`
  - `getSecurityStateSync`
  - `setPin`
  - `verifyPin`
  - `clearPin`
  - `enableBiometric`
  - `disableBiometric`
  - `authenticateBiometric`
  - `markUnlocked`
  - `clearUnlock`
  - `hasFreshUnlock`
  - `currentSession`

Expected result:

- `Security.jsx` and `AppLockGate.jsx` need little or no change.
- Shared client no longer directly calls WebAuthn.
- Browser build behavior remains the same.

## Phase 4: Move Lifecycle Logic Behind Platform Lifecycle

Purpose: make auto-lock and background locking work correctly in browser and native app.

Tasks:

- Implement `platformLifecycle` in web package.
- Implement `platformLifecycle` in native package using Capacitor App events where available.
- Update `AppLockGate.jsx` to subscribe through `platformLifecycle`.
- Keep DOM activity listeners where appropriate.
- Ensure all subscriptions return cleanup functions.

Expected result:

- Browser auto-lock still works.
- Android app locks on background/resume correctly.
- No duplicate event subscriptions remain after route changes.

## Phase 5: Add Native Secure Storage

Purpose: use native-backed storage for sensitive app lock data.

Tasks:

- Select and install a Capacitor secure storage solution compatible with Capacitor 8.
- Implement `client-platform-native/src/storage.js` secure storage methods.
- Decide migration behavior for existing local browser-style keys in Android WebView.
- Version the settings payload if needed.
- Fail closed if secure storage is unavailable.

Expected result:

- Android app stores security settings in secure storage.
- Browser still uses browser storage.
- Shared client service does not know storage details.

## Phase 6: Add Native Biometric Plugin

Purpose: replace Android WebAuthn behavior with native biometric prompt.

Tasks:

- Select a maintained Capacitor biometric plugin compatible with Capacitor 8.
- Install dependency.
- Run Capacitor sync.
- Add any required Android permissions or plugin config.
- Implement native biometric availability.
- Implement native enroll confirmation.
- Implement native authenticate.
- Normalize plugin errors into shared error codes.

Expected result:

- Android Security page can enable biometric after PIN is set.
- Android lock screen can unlock via native fingerprint/face prompt.
- PIN fallback remains available.

## Phase 7: UI Capability Cleanup

Purpose: make the UI accurately reflect current platform capability.

Tasks:

- Update Security page to use structured availability labels.
- Replace browser-specific copy with capability-specific copy.
- Keep desktop UI unchanged except for clearer unavailable text.
- Ensure mobile screen layout remains smartphone-friendly.
- Ensure disabled states are obvious.

Expected result:

- Android says fingerprint/face unlock when native biometric is available.
- Desktop says browser/device authenticator or unavailable.
- No page leaks plugin names or internal implementation details.

## Phase 8: Emulator And Device Verification

Purpose: prove Android functionality end to end.

Tasks:

- Confirm emulator is booted.
- Confirm backend access works through `adb reverse`.
- Run `bash emu/boe_update.sh`.
- Open app on emulator.
- Test PIN set/change/remove.
- Test lock after background/resume.
- Test biometric availability with emulator settings.
- Test biometric success path if emulator image supports it.
- Test biometric cancel/failure path.
- Test PIN fallback after biometric failure.

Expected result:

- Android app is usable without desktop regressions.
- Lock and unlock behavior is deterministic.

## Phase 9: Desktop Regression Verification

Purpose: ensure the browser client was not harmed.

Tasks:

- Run `npm run build`.
- Run browser dev server.
- Test desktop Security & PIN page.
- Test app lock overlay.
- Test WebAuthn available browser if possible.
- Test browser where WebAuthn is unavailable.
- Confirm admin/website builds are not affected by platform alias.

Expected result:

- Desktop/browser remains as-is.
- Browser builds do not require Android or native plugin runtime.

