# File Change Map

## New Files

Create these packages:

```text
frontend_stack/packages/client-platform-web/package.json
frontend_stack/packages/client-platform-web/src/index.js
frontend_stack/packages/client-platform-web/src/info.js
frontend_stack/packages/client-platform-web/src/storage.js
frontend_stack/packages/client-platform-web/src/security.js
frontend_stack/packages/client-platform-web/src/lifecycle.js
frontend_stack/packages/client-platform-web/src/errors.js

frontend_stack/packages/client-platform-native/package.json
frontend_stack/packages/client-platform-native/src/index.js
frontend_stack/packages/client-platform-native/src/info.js
frontend_stack/packages/client-platform-native/src/storage.js
frontend_stack/packages/client-platform-native/src/security.js
frontend_stack/packages/client-platform-native/src/lifecycle.js
frontend_stack/packages/client-platform-native/src/errors.js
```

Optional shared facade:

```text
frontend_stack/packages/client/src/platform/clientPlatform.js
```

This facade can re-export from `@beonedge/client-platform` if you want one local import point inside `packages/client`.

## Files To Modify

### `frontend_stack/app/vite.config.js`

Add alias selection:

```js
'@beonedge/client-platform': resolve(__dirname, selectedPlatformPath)
```

Default to web.

Use native for Android build through `VITE_BEO_PLATFORM=native`.

### `frontend_stack/app/package.json`

Update Android build script:

```json
"build:android": "VITE_BEO_APP_TARGET=client VITE_BEO_PLATFORM=native vite build --mode android && node scripts/check-android-dist.mjs"
```

Install selected native dependencies after plugin choice.

### `frontend_stack/packages/client/src/services/securitySettings.js`

Refactor without changing public UI-facing function names.

Move these responsibilities out:

- Browser storage access.
- WebAuthn availability and prompt logic.
- Device label detection.
- Random bytes and digest if platform crypto owns it.

Keep these responsibilities:

- Security state shape.
- PIN policy.
- Settings migration/versioning.
- App unlock TTL semantics.
- Error normalization for UI callers.

### `frontend_stack/packages/client/src/components/AppLockGate.jsx`

Replace direct DOM lifecycle wiring with `platformLifecycle`.

Keep:

- Existing overlay UI.
- PIN unlock flow.
- Biometric unlock flow.
- Sign out action.

### `frontend_stack/packages/client/src/pages/Security.jsx`

Update only where required for structured platform capability:

- Capability-specific biometric labels.
- Disabled state reasons.
- Native/web safe messages.

Avoid a page fork.

### `frontend_stack/emu/boe_update.sh`

Review after alias/script changes.

It should:

- Detect running emulator.
- Build Android target.
- Sync Capacitor.
- Ensure `adb reverse` mapping exists.
- Install/reinstall app.
- Launch app if it already does so.

Potential change:

- Make sure it calls the updated `npm run build:android` or root `npm run android:sync` from the correct working directory.

## Files Not Expected To Change

These should not need changes for the platform split:

- Most page components outside Security.
- Admin app pages.
- Website pages.
- Backend code.
- Desktop CSS except minor Security page label/layout adjustments if required.

## Import Rules After Migration

Allowed inside `packages/client`:

```js
import { platformSecurity } from '@beonedge/client-platform';
import { platformStorage } from '@beonedge/client-platform';
import { platformLifecycle } from '@beonedge/client-platform';
```

Avoid inside `packages/client`:

```js
import { Capacitor } from '@capacitor/core';
import { SomeBiometricPlugin } from 'some-native-plugin';
window.PublicKeyCredential
navigator.credentials
localStorage
sessionStorage
```

Exceptions:

- Non-security generic UI behavior can still use normal DOM APIs where appropriate.
- Platform packages can use these APIs directly.

## Suggested Commit Sequence

1. Add platform packages and web implementation.
2. Add Vite alias and script update.
3. Refactor security service to use platform package.
4. Refactor lock lifecycle to platform lifecycle.
5. Add native secure storage.
6. Add native biometric.
7. Update emulator script if needed.
8. Add docs/README updates.
9. Run builds and emulator verification.

