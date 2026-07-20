# Native Android Implementation Plan

## Objective

Add native Android biometric support to the Capacitor app while keeping the shared React client mostly unchanged.

## Required Native Capabilities

The native platform package should support:

- Biometric availability check.
- Biometric prompt for enrollment confirmation.
- Biometric prompt for unlock.
- Secure storage for security settings where possible.
- App pause/resume events.
- Device/platform label.

## Dependencies To Evaluate

Before implementation, verify current package support for Capacitor 8 and Android API behavior.

Potential dependency categories:

- Biometric prompt plugin.
- Secure storage plugin.
- Capacitor App plugin.

The repo already has:

- `@capacitor/android`
- `@capacitor/browser`
- `@capacitor/core`
- `@capacitor/cli`

Likely additional dependency:

```bash
npm --workspace app install @capacitor/app
```

Biometric and secure storage plugin names should be selected after checking current maintenance and API compatibility.

## Native Package Files

Create:

```text
frontend_stack/packages/client-platform-native/
  package.json
  src/
    index.js
    info.js
    security.js
    storage.js
    lifecycle.js
    errors.js
```

Suggested `package.json`:

```json
{
  "name": "@beonedge/client-platform-native",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js"
}
```

Dependencies can stay in `frontend_stack/app/package.json` if they are only consumed by the app build, or be declared in the native package if the workspace packaging should be explicit. Prefer explicit package dependencies if npm workspace resolution remains clean.

## Native `info.js`

Responsibilities:

- Detect Capacitor runtime.
- Detect Android platform.
- Return user-facing device label.

Contract:

```js
export const platformInfo = {
  target: 'native',
  runtime: 'capacitor',
  os: 'android',
  isNative: true,
  isAndroid: true,
  displayName: 'Android app'
};
```

If Capacitor reports a different platform during tests, return accurate data instead of hardcoding blindly.

## Native `storage.js`

Responsibilities:

- Provide compatible local/session/secure storage functions.
- Store sensitive security settings in secure storage if available.
- Fall back only when explicitly accepted.

Recommended behavior:

- `local`: use browser localStorage inside WebView for non-sensitive preferences.
- `session`: use browser sessionStorage or an in-memory map.
- `secure`: use selected secure storage plugin.

If secure storage fails:

- Return `available() === false`.
- Security service should either block native PIN setup with a clear error or use a documented fallback based on a feature flag.

For a financial app, prefer blocking native PIN setup if secure storage is unavailable instead of silently falling back to normal localStorage.

## Native `security.js`

Responsibilities:

- Random bytes.
- Digest.
- Device ID.
- Device label.
- Biometric availability/enroll/authenticate/disable.

Recommended shape:

```js
export const platformSecurity = {
  biometric: {
    availability,
    enroll,
    authenticate,
    disable
  },
  crypto: {
    randomBytes,
    digest
  },
  device: {
    id,
    label
  }
};
```

### Availability

Return:

```js
{
  available: true,
  enrolled: true,
  type: 'native-biometric',
  label: 'Fingerprint or face unlock',
  reason: 'ok'
}
```

Failure examples:

```js
{
  available: false,
  enrolled: false,
  type: 'native-biometric',
  label: 'Device unlock unavailable',
  reason: 'not-enrolled'
}
```

### Enroll

Enrollment should confirm biometric once before enabling the app setting.

Input:

```js
{
  userId,
  displayName,
  reason: 'Enable biometric unlock for BeOnEdge'
}
```

Output:

```js
{
  ok: true,
  credentialId: 'native-android-biometric'
}
```

The credential ID can be a stable marker if the plugin does not expose an actual credential ID. It must not be treated as a server-verifiable credential.

### Authenticate

Authentication should show the Android biometric prompt.

Input:

```js
{
  reason: 'Unlock BeOnEdge'
}
```

Output:

```js
{
  ok: true
}
```

Cancelled prompt should normalize to `BIOMETRIC_CANCELLED`.

Unavailable prompt should normalize to `BIOMETRIC_UNAVAILABLE`.

## Native `lifecycle.js`

Responsibilities:

- Subscribe to app pause/resume.
- Subscribe to WebView activity.
- Normalize cleanup functions.

Expected API:

```js
function onPause(callback) {}
function onResume(callback) {}
function onActivity(callback) {}
function onVisibilityChange(callback) {}
```

Use Capacitor App events for:

- `appStateChange`
- pause/resume equivalents exposed by the selected Capacitor version/plugin

Also keep DOM activity listeners for:

- `pointerdown`
- `keydown`
- `touchstart`

The lock gate should lock when the native app is backgrounded and require PIN/biometric on resume if the TTL has expired or if policy says background always locks.

## Android Manifest Considerations

Depending on the selected plugin, Android permissions may be required:

```xml
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
```

Some plugins may add this automatically. Verify generated Android manifest after `cap sync android`.

## Emulator Testing Notes

For biometric emulator testing:

- Use a Google APIs emulator image.
- Enroll fingerprint/biometric in Android settings if supported.
- Use emulator extended controls or ADB commands to simulate biometric events if supported.

PIN fallback must work even if emulator biometric simulation is not available.

## Failure Policy

Native Android behavior should fail closed for sensitive storage:

- If secure storage is unavailable, do not silently claim secure app lock.
- If biometric plugin is unavailable, keep PIN available and disable biometric.
- If biometric prompt is cancelled, remain locked and show PIN.
- If app resumes from background, re-check lock state before showing sensitive content.

