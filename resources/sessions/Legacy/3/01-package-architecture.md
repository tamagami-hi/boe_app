# Package Architecture Plan

## Target Package Layout

Add two new workspace packages:

```text
frontend_stack/
  packages/
    client/
      src/
        pages/
        components/
        services/
        platform/
    client-platform-web/
      package.json
      src/
        index.js
        info.js
        security.js
        storage.js
        lifecycle.js
    client-platform-native/
      package.json
      src/
        index.js
        info.js
        security.js
        storage.js
        lifecycle.js
```

`frontend_stack/package.json` already uses:

```json
"workspaces": [
  "app",
  "packages/*"
]
```

So both new packages will automatically be part of the npm workspace once their `package.json` files are created.

## Package Responsibilities

### `packages/client`

Owns shared client experience:

- Routes.
- Pages.
- Layout.
- API calls.
- Client business behavior.
- Security & PIN UI.
- Lock screen UI.
- Shared security state orchestration.

Must not directly import:

- Capacitor native plugins.
- Android-only biometric plugin APIs.
- `navigator.credentials` directly from page/component code.
- `localStorage` or `sessionStorage` directly for security state after migration.

Allowed imports:

- `@beonedge/client-platform`
- `@beonedge/shared`
- `@beonedge/ui-kits`
- local UI/data/services

### `packages/client-platform-web`

Owns browser/desktop platform behavior:

- Browser platform detection.
- WebAuthn availability and authentication.
- Browser storage adapter.
- Browser lifecycle events.
- Browser-safe no-op fallbacks for native-only features.

It can use:

- `window`
- `document`
- `localStorage`
- `sessionStorage`
- `navigator.credentials`
- `PublicKeyCredential`
- `crypto.subtle`

It must not import native Capacitor biometric plugins.

### `packages/client-platform-native`

Owns Capacitor Android behavior:

- Native platform detection.
- Android biometric availability and authentication.
- Native secure storage where available.
- Capacitor app lifecycle events.
- Native-friendly fallback behavior.

It can use:

- `@capacitor/core`
- `@capacitor/app`
- selected biometric plugin
- selected secure storage plugin

It should avoid direct DOM assumptions except where unavoidable inside the WebView.

## Alias Strategy

Add an alias to `frontend_stack/app/vite.config.js`.

Recommended Vite shape:

```js
export default defineConfig(({ mode }) => {
  const platformTarget = process.env.VITE_BEO_PLATFORM || (mode === 'android' ? 'native' : 'web');

  const clientPlatformPath = platformTarget === 'native'
    ? '../packages/client-platform-native/src'
    : '../packages/client-platform-web/src';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@beonedge/client-platform': resolve(__dirname, clientPlatformPath)
      }
    }
  };
});
```

The exact condition can be simpler in implementation:

- `npm run build` uses web.
- `npm run dev` uses web.
- `npm run build:android` sets `VITE_BEO_PLATFORM=native`.

Recommended script update:

```json
"build:android": "VITE_BEO_APP_TARGET=client VITE_BEO_PLATFORM=native vite build --mode android && node scripts/check-android-dist.mjs"
```

For local browser testing of the mobile UI without native APIs, keep:

```bash
npm run dev
```

For Android app testing:

```bash
npm run build:android
npm run android:sync
```

or:

```bash
bash emu/boe_update.sh
```

## Shared Contract Shape

The platform package should export stable objects:

```js
export { platformInfo } from './info.js';
export { platformSecurity } from './security.js';
export { platformStorage } from './storage.js';
export { platformLifecycle } from './lifecycle.js';
```

The shared client should not import individual native/browser files. It should only import from:

```js
@beonedge/client-platform
```

## Proposed Platform Info Contract

```js
platformInfo = {
  target: 'web' | 'native',
  os: 'android' | 'ios' | 'desktop' | 'unknown',
  runtime: 'browser' | 'capacitor',
  isNative: boolean,
  isAndroid: boolean,
  displayName: string
}
```

Examples:

- Desktop Chrome: `{ target: 'web', os: 'desktop', runtime: 'browser' }`
- Android Capacitor app: `{ target: 'native', os: 'android', runtime: 'capacitor' }`
- Android Chrome browser: `{ target: 'web', os: 'android', runtime: 'browser' }`

## Proposed Storage Contract

```js
platformStorage = {
  local: {
    get(key),
    set(key, value),
    remove(key)
  },
  session: {
    get(key),
    set(key, value),
    remove(key)
  },
  secure: {
    available(),
    get(key),
    set(key, value),
    remove(key)
  }
}
```

Behavior:

- Web `local` maps to browser `localStorage`.
- Web `session` maps to browser `sessionStorage`.
- Web `secure` can initially map to local storage with `available() === false`, or throw for sensitive writes until the caller chooses fallback behavior.
- Native `secure` maps to secure storage / Android-backed encrypted storage.
- Native `session` can stay in memory or WebView session storage depending on reliability.

## Proposed Lifecycle Contract

```js
platformLifecycle = {
  onActivity(callback),
  onPause(callback),
  onResume(callback),
  onVisibilityChange(callback)
}
```

Behavior:

- Web uses `pointerdown`, `keydown`, `touchstart`, and `visibilitychange`.
- Native uses Capacitor App state events when possible, plus WebView input activity events.
- `AppLockGate` should subscribe to this contract instead of directly wiring DOM events.

## Proposed Security Contract

```js
platformSecurity = {
  biometric: {
    availability(),
    enroll(options),
    authenticate(options),
    disable(options)
  },
  crypto: {
    randomBytes(length),
    digest(value)
  },
  device: {
    id(),
    label()
  }
}
```

`availability()` should return structured data, not just boolean:

```js
{
  available: boolean,
  enrolled: boolean | null,
  type: 'native-biometric' | 'webauthn-platform' | 'none',
  label: 'Fingerprint or face unlock' | 'Device unlock' | 'Not available',
  reason: 'ok' | 'not-secure-context' | 'not-supported' | 'not-enrolled' | 'plugin-error'
}
```

This allows the Security page to show accurate status without platform-specific UI branches.

## Import Migration Rule

Before:

```js
if (window.PublicKeyCredential) {
  // WebAuthn logic
}
```

After:

```js
const availability = await platformSecurity.biometric.availability();
```

Before:

```js
localStorage.setItem(key, JSON.stringify(payload));
```

After:

```js
await platformStorage.local.set(key, payload);
```

For sensitive values:

```js
await platformStorage.secure.set(key, payload);
```
