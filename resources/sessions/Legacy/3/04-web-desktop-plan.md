# Web And Desktop Behavior Plan

## Objective

Keep the browser/desktop client stable while native Android receives its own platform implementation.

Desktop should not become a second-class path. It should keep a clean browser-native implementation with the same shared UI.

## Web Package Files

Create:

```text
frontend_stack/packages/client-platform-web/
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
  "name": "@beonedge/client-platform-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.js"
}
```

## Browser Platform Info

Return structured platform details:

```js
{
  target: 'web',
  runtime: 'browser',
  os: 'desktop' | 'android' | 'ios' | 'unknown',
  isNative: false,
  isAndroid: boolean,
  displayName: 'Chrome browser' | 'Firefox browser' | 'Safari browser' | 'Android browser' | 'This browser'
}
```

The current `deviceLabel()` logic in `securitySettings.js` can move here.

## Browser Storage

Web implementation can keep current behavior:

- `local` uses `window.localStorage`.
- `session` uses `window.sessionStorage`.
- `secure.available()` returns `false`.

Do not advertise browser local storage as secure storage.

If shared security settings need storage for PIN hashes:

- Continue storing salt/hash in local storage for browser compatibility.
- Mark the storage mode as `browser-local`.
- Keep copy precise: `App PIN settings are stored locally in this browser.`

## Browser Biometric

Web implementation should use WebAuthn platform authenticator when available.

Availability requires:

- `window.isSecureContext === true`
- `window.PublicKeyCredential`
- `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`
- available platform authenticator response

Return examples:

```js
{
  available: true,
  enrolled: null,
  type: 'webauthn-platform',
  label: 'Device unlock',
  reason: 'ok'
}
```

```js
{
  available: false,
  enrolled: null,
  type: 'none',
  label: 'Not available in this browser',
  reason: 'not-supported'
}
```

## WebAuthn Enrollment

Existing behavior can be moved from `securitySettings.js` into `client-platform-web/src/security.js`:

- Generate challenge.
- Create public key credential.
- Request `userVerification: 'required'`.
- Request `authenticatorAttachment: 'platform'`.
- Store credential ID in shared settings.

The shared security service should pass:

```js
{
  userId,
  name,
  displayName
}
```

The web adapter returns:

```js
{
  ok: true,
  credentialId
}
```

## WebAuthn Authentication

Move existing `navigator.credentials.get` logic into web adapter:

```js
await platformSecurity.biometric.authenticate({
  credentialId,
  reason: 'Unlock BeOnEdge'
});
```

The web adapter maps `credentialId` back to bytes and calls WebAuthn.

## Desktop UI Behavior

The desktop Security page should stay usable:

- App PIN row works.
- Auto-lock row works.
- Active session row works.
- Biometric row appears but may be disabled if unavailable.
- No Android-specific terms are shown on desktop.

Recommended label mapping:

- WebAuthn available: `Use this device's browser authenticator`.
- WebAuthn unavailable: `Not available in this browser`.
- PIN not set: `Set an app PIN first`.

## Browser Lifecycle

Move current lock gate event logic behind `platformLifecycle`:

- `onActivity`: pointer, keyboard, touch.
- `onPause`: document hidden.
- `onResume`: document visible.
- `onVisibilityChange`: direct visibility signal if needed.

The lock policy should stay the same:

- If app becomes hidden, clear unlock.
- When visible again, show lock if PIN is set.
- Auto-lock after configured inactivity.

## Browser Compatibility Risks

WebAuthn availability depends on:

- HTTPS or localhost secure context.
- Browser support.
- OS authenticator setup.
- Browser profile policies.

The browser path should always fall back to PIN.

## What Does Not Change On Desktop

No desktop redesign is required for native Android biometric support.

No desktop route split is required.

No desktop package should import native plugins.

No desktop build should require Android SDK, emulator, or Capacitor sync.

