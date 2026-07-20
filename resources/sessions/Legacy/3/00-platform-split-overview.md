# Session 3: Client Platform Split Overview

## Goal

Build a proper mobile/app-side platform layer for the BeOnEdge client without rewriting the whole client app or breaking the desktop/browser experience.

The target is:

- Keep the existing client screens, routes, state, and service calls shared.
- Add native Android-only capability for device biometric unlock through Capacitor.
- Keep desktop/browser behavior stable and independent from native Android plugins.
- Make Security & PIN work through a platform adapter so the same page can render correct controls on Android and desktop.

## Decision

Do not create a completely separate full client app for smartphone and desktop.

Instead, split the frontend into:

- `packages/client`: shared client application UI, routing, page logic, and API-facing business behavior.
- `packages/client-platform-web`: browser/desktop implementation of platform capabilities.
- `packages/client-platform-native`: Capacitor/Android implementation of platform capabilities.

The shared client should import one stable alias, for example:

```js
import { platformSecurity, platformStorage, platformInfo } from '@beonedge/client-platform';
```

The app build chooses which package backs that alias:

- Browser build maps `@beonedge/client-platform` to `packages/client-platform-web/src`.
- Android build maps `@beonedge/client-platform` to `packages/client-platform-native/src`.

This keeps desktop as-is while allowing Android to use guaranteed native APIs.

## Current Repo Context

Current workspace package layout:

- `frontend_stack/app`: Vite + Capacitor host app.
- `frontend_stack/packages/client`: shared client app package.
- `frontend_stack/packages/admin`: admin app package.
- `frontend_stack/packages/website`: website package.
- `frontend_stack/packages/shared`: shared utilities/types.
- `frontend_stack/packages/ui-kits`: shared UI package.
- `frontend_stack/packages/design-tokens`: design token package.

Current app alias wiring is in:

- `frontend_stack/app/vite.config.js`

Current Android script is in:

- `frontend_stack/app/package.json`
- `build:android`: `VITE_BEO_APP_TARGET=client vite build --mode android && node scripts/check-android-dist.mjs`

Current Security & PIN implementation exists in:

- `frontend_stack/packages/client/src/pages/Security.jsx`
- `frontend_stack/packages/client/src/components/AppLockGate.jsx`
- `frontend_stack/packages/client/src/services/securitySettings.js`

That implementation currently uses browser primitives directly:

- `localStorage` and `sessionStorage`
- Web Crypto
- WebAuthn through `navigator.credentials`
- `document.visibilityState`
- browser event listeners

Those direct browser assumptions should be moved behind the platform layer before native Android biometric support is added.

## Why This Architecture

Native Android fingerprint/face unlock cannot be guaranteed through normal browser APIs inside every WebView/browser environment. Capacitor can bridge into Android APIs such as BiometricPrompt and Android Keystore, but those APIs should not be imported from shared client pages directly.

If native imports are placed inside `packages/client`, desktop builds can become fragile because:

- Native plugins may be unavailable in the browser.
- Bundling can pull in Capacitor-only code where it is not needed.
- Security page behavior will need too many `if Android else browser` branches.
- Future mobile-only features will spread platform checks throughout the UI.

A platform adapter isolates that complexity.

## Desired User Experience

### Android App

The Android app should support:

- Set app PIN.
- Change app PIN.
- Remove app PIN.
- Auto-lock after inactivity.
- Lock when the app goes to background.
- Unlock with PIN.
- Enable device biometric unlock after PIN exists.
- Unlock with Android fingerprint/face through native prompt.
- Fall back to PIN if biometric fails, is cancelled, or is unavailable.
- Store sensitive security material in Android-backed secure storage where possible.

### Desktop/Browser

The desktop/browser client should keep working without native Android APIs:

- Set/change/remove app PIN.
- Auto-lock in browser session.
- Optional WebAuthn platform authenticator support where available.
- Clear disabled/unavailable biometric state where WebAuthn/native device unlock is not available.
- No dependency on Capacitor native biometric plugins.
- No visual redesign required solely because Android gets native biometrics.

## Non-Goals

This plan does not require:

- Rebuilding the full client app as Kotlin/Jetpack Compose.
- Duplicating all pages into a separate mobile-only app package.
- Removing the existing browser client.
- Making desktop use Android native biometrics.
- Changing backend auth/session contracts unless needed for device registration later.

## High-Level Outcome

After implementation, `packages/client` should not care whether it is running in:

- Chrome desktop
- Mobile browser
- Capacitor Android WebView

It should ask the platform layer:

- What platform am I on?
- Is biometric auth available?
- Can I securely store this value?
- Can I authenticate this user locally?
- Which app lifecycle events should trigger lock?

The platform layer answers differently per build target.

