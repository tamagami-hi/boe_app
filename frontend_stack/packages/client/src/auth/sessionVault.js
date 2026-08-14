import { Capacitor } from '@capacitor/core';
import { platformStorage } from '../platform/storage.js';

/**
 * The session vault: where access tokens, refresh tokens, the cached principal and
 * the admin CSRF token live.
 *
 * Two problems it solves.
 *
 * 1. **Native credentials were in WebView localStorage.** Bearer and rotating
 *    refresh tokens for an investing account sat in `window.localStorage`, which is
 *    readable by anything that achieves script execution in the WebView, is
 *    included in an Android backup, and survives in the app's data directory. A
 *    Secure Storage adapter was already installed and simply unused.
 *
 * 2. **Requests need tokens synchronously.** `apiRequest` builds an
 *    `Authorization` header inline, but Secure Storage is async. So the vault keeps
 *    an in-memory copy as the read path and treats the secure store purely as
 *    persistence: `hydrate()` fills memory once during bootstrap, and every write
 *    updates memory synchronously before persisting.
 *
 * Platform split, deliberately:
 *   - **native** — tokens persist in Capacitor Secure Storage only. If the secure
 *     store is unavailable the vault FAILS CLOSED: memory still works for the
 *     current process, but nothing is written to localStorage as a consolation
 *     prize. A session that cannot be stored safely is not stored.
 *   - **web** — admin auth is same-site HttpOnly cookies, so the browser holds the
 *     real credential and the vault only caches the principal and CSRF token in
 *     localStorage. There is nothing secret to protect there that the cookie does
 *     not already protect better.
 *
 * Legacy tokens found in localStorage on a native run are deleted, not migrated.
 * The app is pre-release with no external users, so carrying a rotating refresh
 * token across storage backends would add risk for no benefit — a stale native
 * session simply asks for login again.
 */

const SCOPES = ['client', 'admin'];

const STORAGE_KEYS = {
  client: {
    accessToken: 'boe.client.accessToken',
    refreshToken: 'boe.client.refreshToken',
    user: 'boe.client.user',
    csrfToken: 'boe.client.csrfToken',
  },
  admin: {
    accessToken: 'boe.admin.accessToken',
    refreshToken: 'boe.admin.refreshToken',
    user: 'boe.admin.user',
    csrfToken: 'boe.admin.csrfToken',
  },
};

/** Field names that must never touch localStorage on a native build. */
const SECRET_FIELDS = ['accessToken', 'refreshToken'];

const emptyScope = () => ({ accessToken: '', refreshToken: '', user: null, csrfToken: '' });

/** The synchronous read path for `apiRequest`. */
const memory = { client: emptyScope(), admin: emptyScope() };

let hydrated = false;
let hydrating = null;
/** True when running natively AND the secure store answered. Fail-closed flag. */
let secureUsable = false;

function isNative() {
  try {
    return Boolean(Capacitor.isNativePlatform?.());
  } catch {
    return false;
  }
}

function keysFor(scope) {
  return STORAGE_KEYS[scope] || STORAGE_KEYS.client;
}

function localHandle() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* hydration                                                                  */
/* -------------------------------------------------------------------------- */

async function readSecure(key) {
  try {
    const value = await platformStorage.secure.get(key);
    return value ?? null;
  } catch {
    return null;
  }
}

function readLocal(key) {
  const store = localHandle();
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function parseUser(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Remove credentials this build must not keep in localStorage.
 * Runs on native only, and only for the secret fields — the cached user and CSRF
 * token are not secrets and the web build legitimately keeps them there.
 */
function purgeLegacyLocalSecrets() {
  const store = localHandle();
  if (!store) return;
  for (const scope of SCOPES) {
    const keys = keysFor(scope);
    for (const field of SECRET_FIELDS) {
      try {
        store.removeItem(keys[field]);
      } catch {
        /* a storage that refuses removal cannot be helped; memory is still authoritative */
      }
    }
  }
}

async function hydrateNative() {
  secureUsable = await platformStorage.secure.available().catch(() => false);

  if (!secureUsable) {
    // Fail closed. No localStorage fallback: that is the exact exposure being
    // removed, and silently re-enabling it would make the fix meaningless.
    purgeLegacyLocalSecrets();
    return;
  }

  for (const scope of SCOPES) {
    const keys = keysFor(scope);
    const [accessToken, refreshToken, user, csrfToken] = await Promise.all([
      readSecure(keys.accessToken),
      readSecure(keys.refreshToken),
      readSecure(keys.user),
      readSecure(keys.csrfToken),
    ]);
    memory[scope] = {
      accessToken: accessToken || '',
      refreshToken: refreshToken || '',
      user: parseUser(user),
      csrfToken: csrfToken || '',
    };
  }

  // Anything left over from the localStorage era goes now. Not migrated on
  // purpose — see the module comment.
  purgeLegacyLocalSecrets();
}

function hydrateWeb() {
  for (const scope of SCOPES) {
    const keys = keysFor(scope);
    memory[scope] = {
      accessToken: readLocal(keys.accessToken) || '',
      refreshToken: readLocal(keys.refreshToken) || '',
      user: parseUser(readLocal(keys.user)),
      csrfToken: readLocal(keys.csrfToken) || '',
    };
  }
}

/**
 * Fill the in-memory session from persistent storage. Idempotent and
 * single-flight: concurrent callers await the same promise.
 *
 * Must be awaited before the first authenticated request on native, which is why
 * the session providers gate their restore on it rather than racing it.
 */
export function hydrateSessionVault() {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;

  hydrating = (isNative() ? hydrateNative() : Promise.resolve(hydrateWeb()))
    .catch(() => {
      // A failed hydrate is an anonymous session, never a crash: the app must
      // still reach its login screen.
    })
    .then(() => {
      hydrated = true;
      hydrating = null;
    });

  return hydrating;
}

/** True once hydration has completed. */
export function isSessionVaultHydrated() {
  return hydrated;
}

/* -------------------------------------------------------------------------- */
/* persistence                                                                */
/* -------------------------------------------------------------------------- */

async function persistField(scope, field, value) {
  const key = keysFor(scope)[field];
  const serialised = field === 'user'
    ? (value ? JSON.stringify(value) : '')
    : String(value ?? '');

  if (isNative()) {
    if (!secureUsable) return;
    if (!serialised) {
      await platformStorage.secure.remove(key).catch(() => {});
      return;
    }
    await platformStorage.secure.set(key, serialised).catch(() => {});
    return;
  }

  const store = localHandle();
  if (!store) return;
  try {
    if (!serialised) store.removeItem(key);
    else store.setItem(key, serialised);
  } catch {
    /* quota or privacy mode; memory remains authoritative for this process */
  }
}

/**
 * Write session fields. Memory updates synchronously so the very next request
 * carries the new token; persistence is awaited by callers that care.
 *
 * Only the fields present in `patch` are touched — a token rotation must not wipe
 * the cached user, and caching a user must not clear tokens.
 */
export function setSession(patch = {}, scope = 'client') {
  const target = memory[scope] || (memory[scope] = emptyScope());
  const writes = [];

  for (const field of ['accessToken', 'refreshToken', 'user', 'csrfToken']) {
    if (!(field in patch)) continue;
    const value = patch[field];
    if (value === undefined) continue;
    target[field] = field === 'user' ? (value || null) : (value || '');
    writes.push(persistField(scope, field, target[field]));
  }

  return Promise.all(writes);
}

/** Drop everything for a scope, in memory and in storage. */
export function clearSession(scope = 'client') {
  memory[scope] = emptyScope();

  const keys = keysFor(scope);
  const fields = ['accessToken', 'refreshToken', 'user', 'csrfToken'];

  if (isNative()) {
    return Promise.all(
      fields.map((field) => platformStorage.secure.remove(keys[field]).catch(() => {})),
    );
  }

  const store = localHandle();
  if (store) {
    for (const field of fields) {
      try {
        store.removeItem(keys[field]);
      } catch {
        /* ignore */
      }
    }
  }
  return Promise.resolve();
}

/* -------------------------------------------------------------------------- */
/* synchronous reads (the request path)                                       */
/* -------------------------------------------------------------------------- */

export function accessTokenOf(scope = 'client') {
  return memory[scope]?.accessToken || '';
}

export function refreshTokenOf(scope = 'client') {
  return memory[scope]?.refreshToken || '';
}

export function userOf(scope = 'client') {
  return memory[scope]?.user || null;
}

export function csrfOf(scope = 'client') {
  return memory[scope]?.csrfToken || '';
}

/**
 * Diagnostics for the bootstrap UI and tests. Never returns token values — a
 * status object that leaks a bearer token into a log or an error report would
 * defeat the point of the vault.
 */
export function sessionVaultStatus() {
  return {
    hydrated,
    native: isNative(),
    secureStorageUsable: isNative() ? secureUsable : null,
    scopes: Object.fromEntries(
      SCOPES.map((scope) => [
        scope,
        {
          hasAccessToken: Boolean(memory[scope]?.accessToken),
          hasRefreshToken: Boolean(memory[scope]?.refreshToken),
          hasCachedUser: Boolean(memory[scope]?.user),
        },
      ]),
    ),
  };
}

/** Test-only reset. Not used by application code. */
export function __resetSessionVaultForTests() {
  memory.client = emptyScope();
  memory.admin = emptyScope();
  hydrated = false;
  hydrating = null;
  secureUsable = false;
}
