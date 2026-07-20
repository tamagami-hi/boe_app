# Security And Biometric Contract Plan

## Existing Security Behavior To Preserve

The current Security & PIN implementation already covers the correct user flows:

- Set app PIN.
- Change app PIN.
- Remove app PIN.
- Enable biometric unlock only after PIN exists.
- Test biometric unlock.
- Auto-lock after inactivity.
- Lock after app visibility/background changes.
- Unlock with PIN.
- Unlock with biometric where available.
- Sign out from lock screen.

Those flows should be preserved. The implementation should be refactored, not replaced from scratch.

## Problem To Fix

Current security code mixes these responsibilities in one browser-oriented service:

- PIN validation.
- PIN hashing.
- Device ID creation.
- Device label detection.
- Browser storage.
- Browser WebAuthn.
- Unlock session TTL.
- App lock event dispatching.

That is acceptable for a browser-only app, but it becomes fragile for native Android because Android biometric unlock should go through a native plugin and sensitive storage should prefer Android-backed secure storage.

## Target Internal Structure

Recommended shared client security service split:

```text
packages/client/src/services/
  securitySettings.js
  securityEvents.js
  securityPin.js

packages/client/src/platform/
  clientPlatform.js
```

`securitySettings.js` remains the UI-facing service so existing imports can be migrated gradually.

It should delegate platform-specific work to:

```js
import { platformSecurity, platformStorage, platformLifecycle } from '@beonedge/client-platform';
```

## PIN Storage Strategy

### Web

Initial behavior can remain compatible with the existing browser implementation:

- Store PIN salt and hash in local browser storage.
- Store unlock TTL in session storage.
- Use Web Crypto `crypto.subtle.digest('SHA-256')` where available.

This is not equivalent to native secure storage, so the UI should avoid claiming desktop browser storage is hardware-backed.

### Native Android

Preferred behavior:

- Store PIN metadata and biometric enrollment state in encrypted/secure storage.
- Avoid storing raw PIN.
- Store only salt and derived hash.
- Use native secure storage for any local secret that gates biometric unlock.
- Keep unlock TTL short and session-only.

Recommended PIN data shape:

```js
{
  version: 2,
  pinHash: string,
  pinSalt: string,
  pinSetAt: string,
  biometricEnabled: boolean,
  biometricCredentialId: string,
  biometricSetAt: string,
  autoLockMs: number,
  deviceId: string,
  deviceLabel: string,
  updatedAt: string
}
```

The version number allows migration from the current browser-only format.

## Biometric Enrollment Strategy

Biometric should remain dependent on app PIN:

1. User sets a valid 4 to 6 digit PIN.
2. User enables biometric unlock.
3. Platform adapter checks availability.
4. Platform adapter runs enrollment/authentication ceremony.
5. Shared security service records `biometricEnabled: true`.
6. Unlock screen offers biometric only if both app settings and platform availability allow it.

This prevents biometric toggle from becoming the only local unlock method. PIN remains the recovery path.

## Native Android Biometric Behavior

Native Android should use a Capacitor biometric plugin that calls Android biometric APIs.

Plugin selection must be verified at implementation time for:

- Capacitor 8 compatibility.
- Android API level support.
- Maintenance status.
- License.
- Whether it supports BiometricPrompt.
- Whether it supports device credential fallback if desired.
- Whether it integrates with secure storage or only prompts for auth.

Candidate plugin categories:

- Capacitor native biometric plugin.
- Capacitor biometric auth plugin.
- Capacitor secure storage plugin plus biometric prompt plugin.

Do not lock the implementation to a plugin until the current package health is checked.

Native adapter expected flow:

```js
async function availability() {
  // Call native plugin availability API.
  // Return structured availability object.
}

async function enroll({ userId, displayName }) {
  // Prompt the user once to confirm local biometric auth.
  // Store native enrollment marker after success.
}

async function authenticate({ reason }) {
  // Show Android biometric prompt.
  // Return { ok: true } only after native success.
}
```

## Desktop/Web Biometric Behavior

Desktop/web should use WebAuthn only where it is available:

- Secure context required.
- `PublicKeyCredential` required.
- Platform authenticator must be available.
- User verification required.

If WebAuthn is unavailable:

- The biometric row should be disabled.
- The explanation should say device unlock is unavailable in this browser.
- PIN and auto-lock should still work.

Desktop should not import or initialize Capacitor biometric plugins.

## Security Page UI Behavior

The Security page should render from capabilities:

```js
const capabilities = await platformSecurity.biometric.availability();
```

Recommended labels:

- Native Android available: `Use fingerprint or face unlock on this device`.
- WebAuthn available: `Use this device's browser authenticator`.
- Not available: `Not available on this device`.
- PIN missing: `Set an app PIN first`.

The toggle should be disabled when:

- PIN is not set.
- Platform biometric is unavailable.
- The operation is busy.

The lock screen biometric button should be visible only when:

- PIN is set.
- Biometric is enabled in app settings.
- Current platform reports biometric available.

## Error Handling

Normalize platform errors into shared error codes:

```js
BIOMETRIC_UNAVAILABLE
BIOMETRIC_NOT_ENROLLED
BIOMETRIC_CANCELLED
BIOMETRIC_FAILED
PIN_REQUIRED
BAD_PIN
INVALID_PIN
STORAGE_UNAVAILABLE
```

The UI should not display raw plugin errors. It should map errors to user-safe messages.

## Backend Implications

No backend changes are required for local app lock.

Backend changes may be needed later if the product wants:

- Server-side trusted device list.
- Remote device revoke.
- Step-up authentication for withdrawals or mandate changes.
- Device registration audit trail.

For now, app PIN and biometric unlock should be treated as local device protection, not backend login replacement.

## Important Security Boundary

Native biometric unlock should unlock the local app session. It should not be treated as proof that the backend user re-authenticated unless the backend issues a fresh challenge and verifies a server-bound credential.

For the current app:

- Biometric unlock can open the locally locked UI.
- Backend session validity still depends on the existing auth/session API.
- If backend session expires, the user must log in normally.

