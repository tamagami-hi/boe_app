// Common helpers for service adapters.
export const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
export const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

const SESSION_KEYS = {
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
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:47502';

function sessionKeys(scope = 'client') {
  return SESSION_KEYS[scope] || SESSION_KEYS.client;
}

function localStorageHandle() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function serviceMode() {
  return import.meta.env.VITE_BEO_API_MODE === 'http' ? 'http' : 'fixture';
}

export function useHttpApi() {
  return serviceMode() === 'http';
}

export function apiBaseUrl() {
  return (import.meta.env.VITE_BEO_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

export function setSessionTokens({ user, accessToken, refreshToken, scope = 'client' }) {
  const storage = localStorageHandle();
  if (!storage) return;
  const keys = sessionKeys(scope);
  if (user) storage.setItem(keys.user, JSON.stringify(user));
  if (accessToken) storage.setItem(keys.accessToken, accessToken);
  if (refreshToken) storage.setItem(keys.refreshToken, refreshToken);
}

export function clearSessionTokens(scope = 'client') {
  const storage = localStorageHandle();
  if (!storage) return;
  const keys = sessionKeys(scope);
  storage.removeItem(keys.accessToken);
  storage.removeItem(keys.refreshToken);
  storage.removeItem(keys.user);
  storage.removeItem(keys.csrfToken);
}

// Web (admin) auth is cookie-based; the synchronizer CSRF token is held here and
// sent on unsafe requests. Native (client) auth does not use this.
export function setSessionCsrf(csrfToken, scope = 'client') {
  const storage = localStorageHandle();
  if (!storage || !csrfToken) return;
  storage.setItem(sessionKeys(scope).csrfToken, csrfToken);
}

export function storedCsrf(scope = 'client') {
  return localStorageHandle()?.getItem(sessionKeys(scope).csrfToken) || '';
}

export function storedAccessToken(scope = 'client') {
  return localStorageHandle()?.getItem(sessionKeys(scope).accessToken) || '';
}

export function storedRefreshToken(scope = 'client') {
  return localStorageHandle()?.getItem(sessionKeys(scope).refreshToken) || '';
}

export function storedUser(scope = 'client') {
  const raw = localStorageHandle()?.getItem(sessionKeys(scope).user);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function apiRequest(path, { method = 'GET', body, auth = true, scope = 'client' } = {}) {
  const headers = { accept: 'application/json' };

  if (body !== undefined) headers['content-type'] = 'application/json';

  if (auth) {
    const token = storedAccessToken(scope);
    if (token) headers.authorization = `Bearer ${token}`;
  }

  // Web (cookie) scopes attach the synchronizer CSRF token on unsafe methods.
  if (method !== 'GET') {
    const csrf = storedCsrf(scope);
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Request failed: ${method} ${path}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    if (response.status === 401) {
      clearSessionTokens(scope);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('boe:session-invalidated', { detail: { scope } }));
      }
    }
    throw error;
  }

  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

export function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}
