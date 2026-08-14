// Session vault tests (Task 20).
//
// The behaviour that matters is not "can it store a string" — it is the fail-closed
// rule. On native, credentials go to Capacitor Secure Storage or nowhere; there is
// no localStorage fallback, because that fallback is the exposure being removed.
import { beforeEach, describe, expect, test, vi } from 'vitest';

let isNativePlatform = false;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform },
}));

// A fake secure store that can be made unavailable, so the fail-closed path is
// exercised rather than assumed.
const secure = {
  available: true,
  data: new Map(),
};

vi.mock('../platform/storage.js', () => ({
  platformStorage: {
    secure: {
      available: async () => secure.available,
      get: async (key) => {
        if (!secure.available) throw new Error('unavailable');
        return secure.data.get(key) ?? null;
      },
      set: async (key, value) => {
        if (!secure.available) throw new Error('unavailable');
        secure.data.set(key, value);
      },
      remove: async (key) => {
        if (!secure.available) throw new Error('unavailable');
        secure.data.delete(key);
      },
    },
    local: { get: async () => null, set: async () => {}, remove: async () => {} },
    session: { get: async () => null, set: async () => {}, remove: async () => {} },
  },
}));

const vault = await import('./sessionVault.js');

beforeEach(() => {
  vault.__resetSessionVaultForTests();
  secure.available = true;
  secure.data.clear();
  window.localStorage.clear();
  isNativePlatform = false;
});

describe('native runtime', () => {
  beforeEach(() => { isNativePlatform = true; });

  test('hydrates tokens from secure storage into the synchronous read path', async () => {
    secure.data.set('boe.client.accessToken', 'access-1');
    secure.data.set('boe.client.refreshToken', 'refresh-1');
    secure.data.set('boe.client.user', JSON.stringify({ id: 'u1' }));

    await vault.hydrateSessionVault();

    // Synchronous reads matter: apiRequest builds the Authorization header inline.
    expect(vault.accessTokenOf('client')).toBe('access-1');
    expect(vault.refreshTokenOf('client')).toBe('refresh-1');
    expect(vault.userOf('client')).toEqual({ id: 'u1' });
  });

  test('persists tokens to secure storage and never to localStorage', async () => {
    await vault.hydrateSessionVault();
    await vault.setSession({ accessToken: 'a', refreshToken: 'r' }, 'client');

    expect(secure.data.get('boe.client.accessToken')).toBe('a');
    expect(window.localStorage.getItem('boe.client.accessToken')).toBeNull();
    expect(window.localStorage.getItem('boe.client.refreshToken')).toBeNull();
  });

  test('deletes credentials left behind in localStorage instead of migrating them', async () => {
    // Pre-release, single user: carrying a rotating refresh token across storage
    // backends would add risk for no benefit. A stale session just asks for login.
    window.localStorage.setItem('boe.client.accessToken', 'legacy-access');
    window.localStorage.setItem('boe.admin.refreshToken', 'legacy-refresh');

    await vault.hydrateSessionVault();

    expect(window.localStorage.getItem('boe.client.accessToken')).toBeNull();
    expect(window.localStorage.getItem('boe.admin.refreshToken')).toBeNull();
    expect(vault.accessTokenOf('client')).toBe('');
  });

  test('fails closed when secure storage is unavailable', async () => {
    secure.available = false;

    await vault.hydrateSessionVault();
    await vault.setSession({ accessToken: 'a', refreshToken: 'r' }, 'client');

    // Memory still serves the current process so the app is usable...
    expect(vault.accessTokenOf('client')).toBe('a');
    // ...but nothing is written anywhere persistent, least of all localStorage.
    expect(window.localStorage.getItem('boe.client.accessToken')).toBeNull();
    expect(secure.data.size).toBe(0);
    expect(vault.sessionVaultStatus().secureStorageUsable).toBe(false);
  });

  test('a hydrate failure yields an anonymous session rather than throwing', async () => {
    secure.available = false;
    await expect(vault.hydrateSessionVault()).resolves.toBeUndefined();
    expect(vault.isSessionVaultHydrated()).toBe(true);
    expect(vault.userOf('client')).toBeNull();
  });
});

describe('web runtime', () => {
  test('uses localStorage, where the real admin credential is an HttpOnly cookie', async () => {
    window.localStorage.setItem('boe.admin.csrfToken', 'csrf-1');
    window.localStorage.setItem('boe.admin.user', JSON.stringify({ id: 'a1' }));

    await vault.hydrateSessionVault();

    expect(vault.csrfOf('admin')).toBe('csrf-1');
    expect(vault.userOf('admin')).toEqual({ id: 'a1' });
  });

  test('writes through to localStorage', async () => {
    await vault.hydrateSessionVault();
    await vault.setSession({ csrfToken: 'csrf-2' }, 'admin');

    expect(window.localStorage.getItem('boe.admin.csrfToken')).toBe('csrf-2');
  });
});

describe('field semantics', () => {
  beforeEach(async () => {
    await vault.hydrateSessionVault();
    await vault.setSession({ accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } }, 'client');
  });

  test('a token rotation does not wipe the cached principal', async () => {
    // authApi rotates tokens without re-sending the user; losing it here would log
    // the user out on every refresh.
    await vault.setSession({ accessToken: 'a2', refreshToken: 'r2' }, 'client');

    expect(vault.userOf('client')).toEqual({ id: 'u1' });
    expect(vault.accessTokenOf('client')).toBe('a2');
  });

  test('caching a user does not clear tokens', async () => {
    await vault.setSession({ user: { id: 'u2' } }, 'client');

    expect(vault.accessTokenOf('client')).toBe('a');
    expect(vault.userOf('client')).toEqual({ id: 'u2' });
  });

  test('scopes are independent', async () => {
    await vault.setSession({ accessToken: 'admin-a' }, 'admin');

    expect(vault.accessTokenOf('client')).toBe('a');
    expect(vault.accessTokenOf('admin')).toBe('admin-a');
  });

  test('clearSession empties one scope only', async () => {
    await vault.setSession({ accessToken: 'admin-a' }, 'admin');
    await vault.clearSession('client');

    expect(vault.accessTokenOf('client')).toBe('');
    expect(vault.userOf('client')).toBeNull();
    expect(vault.accessTokenOf('admin')).toBe('admin-a');
  });
});

describe('hydration is single-flight', () => {
  test('concurrent callers share one hydrate', async () => {
    isNativePlatform = true;
    secure.data.set('boe.client.accessToken', 'access-1');

    await Promise.all([
      vault.hydrateSessionVault(),
      vault.hydrateSessionVault(),
      vault.hydrateSessionVault(),
    ]);

    expect(vault.accessTokenOf('client')).toBe('access-1');
    expect(vault.isSessionVaultHydrated()).toBe(true);
  });
});

describe('status reporting', () => {
  test('never exposes token values', async () => {
    isNativePlatform = true;
    await vault.hydrateSessionVault();
    await vault.setSession({ accessToken: 'super-secret', refreshToken: 'also-secret' }, 'client');

    const status = vault.sessionVaultStatus();
    const serialised = JSON.stringify(status);

    expect(serialised).not.toContain('super-secret');
    expect(serialised).not.toContain('also-secret');
    expect(status.scopes.client.hasAccessToken).toBe(true);
    expect(status.scopes.client.hasRefreshToken).toBe(true);
  });
});
