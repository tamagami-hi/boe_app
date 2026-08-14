// Common helpers for service adapters.
import { reportTransportOutcome } from '@beonedge/shared/net/connectivity.js';
import {
  accessTokenOf,
  clearSession,
  csrfOf,
  refreshTokenOf,
  setSession,
  userOf,
} from '../auth/sessionVault.js';

export const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
export const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:47502';

export function serviceMode() {
  return import.meta.env.VITE_BEO_API_MODE === 'http' ? 'http' : 'fixture';
}

export function useHttpApi() {
  return serviceMode() === 'http';
}

export function apiBaseUrl() {
  return (import.meta.env.VITE_BEO_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

/*
 * Session accessors.
 *
 * These names and signatures are unchanged, but the storage behind them is now
 * `auth/sessionVault.js` rather than `window.localStorage` directly. On native the
 * vault persists to Capacitor Secure Storage and keeps an in-memory copy for the
 * synchronous read path; on web it still uses localStorage, where the real admin
 * credential is an HttpOnly cookie the browser owns.
 *
 * Reads stay synchronous on purpose: `apiRequest` builds the Authorization header
 * inline, and making that async would ripple through every service. The vault is
 * hydrated once during bootstrap instead — see `hydrateSessionVault`.
 */

export function setSessionTokens({ user, accessToken, refreshToken, scope = 'client' }) {
  // Only forward the fields actually supplied. Callers rely on this: a token
  // rotation passes tokens without a user and must not erase the cached principal.
  const patch = {};
  if (user) patch.user = user;
  if (accessToken) patch.accessToken = accessToken;
  if (refreshToken) patch.refreshToken = refreshToken;
  return setSession(patch, scope);
}

export function clearSessionTokens(scope = 'client') {
  return clearSession(scope);
}

// Web (admin) auth is cookie-based; the synchronizer CSRF token is held here and
// sent on unsafe requests. Native (client) auth does not use this.
export function setSessionCsrf(csrfToken, scope = 'client') {
  if (!csrfToken) return Promise.resolve();
  return setSession({ csrfToken }, scope);
}

export function storedCsrf(scope = 'client') {
  return csrfOf(scope);
}

export function storedAccessToken(scope = 'client') {
  return accessTokenOf(scope);
}

export function storedRefreshToken(scope = 'client') {
  return refreshTokenOf(scope);
}

export function storedUser(scope = 'client') {
  return userOf(scope);
}

// Raised instead of performing a network request when the app runs in fixture
// mode. Callers that have local fixture data catch this and fall back; callers
// that do not surface it as an explicit "not available offline" state. Without
// it, `apiRequest` would silently fetch `apiBaseUrl()` even though the app was
// configured to stay offline.
export class FixtureModeError extends Error {
  constructor(path) {
    super('This screen needs the backend. Set VITE_BEO_API_MODE=http to use live data.');
    this.name = 'FixtureModeError';
    this.code = 'FIXTURE_MODE';
    this.path = path;
  }
}

export function isFixtureModeError(error) {
  return error?.code === 'FIXTURE_MODE';
}

// Per-scope session refreshers, registered by `authApi` (which cannot be
// imported here without a cycle). `apiRequest` calls the matching one once when
// a request comes back 401, so an expired access token is rotated transparently.
const sessionRefreshers = {};

export function registerSessionRefresher(scope, refresher) {
  sessionRefreshers[scope] = refresher;
}

/**
 * In-flight refresh per scope, so concurrent 401s share one rotation.
 *
 * This is not an optimisation — it is required for correctness. The backend
 * rotates refresh tokens with reuse detection: presenting an already-consumed
 * token under a different `rotationId` is treated as theft and revokes the
 * entire session family (`nativeAuth.ts`, reason `refresh_reuse`). A cold app
 * start fires several screens' requests at once against an expired access
 * token, so without coalescing, request A rotates the token, request B presents
 * the stale one, and the user is signed out and forced back to the password
 * screen. Verified against the dev API: two parallel refreshes with the same
 * token leave the session `SESSION_INVALID`, including for the caller that
 * "won".
 */
const refreshInFlight = {};

function refreshSessionOnce(scope) {
  const refresher = sessionRefreshers[scope];
  if (!refresher) return Promise.reject(new Error('No session refresher registered.'));
  const pending = refreshInFlight[scope];
  if (pending) return pending;

  const attempt = Promise.resolve()
    .then(() => refresher())
    .finally(() => {
      // Cleared before settling reaches the awaiters, who already hold this
      // promise; the next 401 after this one starts a fresh rotation.
      delete refreshInFlight[scope];
    });
  refreshInFlight[scope] = attempt;
  return attempt;
}

/**
 * Public entry point for a deliberate rotation (e.g. restoring the session at
 * app start). Shares the single-flight slot with 401 recovery, so a boot restore
 * and an in-flight request retry can never both rotate the same token.
 */
export function refreshSession(scope = 'client') {
  return refreshSessionOnce(scope);
}

/**
 * Default per-request deadline.
 *
 * There was none: a request that never answered left the caller awaiting `fetch`
 * forever, which on the sign-in screen showed as a progress bar that never
 * stopped and a button that stayed disabled. A bounded failure the user can retry
 * is strictly better than an unbounded wait, and on a mobile network a stalled
 * socket is normal rather than exceptional.
 */
const DEFAULT_TIMEOUT_MS = 20000;

/** Raised when a request exceeds its deadline, distinct from a rejection. */
export class RequestTimeoutError extends Error {
  constructor(path, timeoutMs) {
    super('The server took too long to respond. Check your connection and try again.');
    this.name = 'RequestTimeoutError';
    this.code = 'REQUEST_TIMEOUT';
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

/** Raised when the request never reached the server at all. */
export class NetworkError extends Error {
  constructor(path, cause) {
    super('Could not reach the server. Check your connection and try again.');
    this.name = 'NetworkError';
    this.code = 'NETWORK_UNAVAILABLE';
    this.path = path;
    this.cause = cause;
  }
}

export function isTransportError(error) {
  return error?.code === 'REQUEST_TIMEOUT' || error?.code === 'NETWORK_UNAVAILABLE';
}

/**
 * `fetch` with a deadline, and with transport failures named.
 *
 * Distinguishing "timed out" and "unreachable" from an HTTP status matters on the
 * sign-in screen: reporting a timeout as bad credentials sends the user to change
 * a password that was never wrong.
 *
 * The deadline covers reading the body, not just the arrival of the headers.
 * `fetch` resolves as soon as headers are in, so clearing the timer there would
 * leave a stalled response body unbounded — the same hang, one step later.
 */
// Retry idempotent reads only. A GET that never arrived is normal on a mobile
// network; a write is never replayed, because the app cannot know whether it landed
// and a duplicated payment costs real money. Writes carry an Idempotency-Key so the
// USER can retry safely instead.
const READ_RETRY_DELAYS_MS = [300, 900];

async function fetchWithDeadline(url, init, path, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, controller ? { ...init, signal: controller.signal } : init);
    const text = await response.text();
    reportTransportOutcome(true);
    return { response, text };
  } catch (error) {
    reportTransportOutcome(false);
    if (controller?.signal.aborted) throw new RequestTimeoutError(path, timeoutMs);
    throw new NetworkError(path, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchRead(url, init, path, timeoutMs, retryable) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchWithDeadline(url, init, path, timeoutMs);
    } catch (error) {
      if (!retryable || !isTransportError(error) || attempt >= READ_RETRY_DELAYS_MS.length) throw error;
      await delay(READ_RETRY_DELAYS_MS[attempt]);
      attempt += 1;
    }
  }
}

export async function apiRequest(
  path,
  {
    method = 'GET',
    body,
    auth = true,
    scope = 'client',
    headers: extraHeaders,
    envelope = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    _retried: retried = false,
  } = {},
) {
  // Mode gate: fixture mode never touches the network, whichever layer calls in.
  if (!useHttpApi()) throw new FixtureModeError(path);

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

  // Per-request headers (e.g. Idempotency-Key, If-Match) win over the defaults.
  if (extraHeaders) Object.assign(headers, extraHeaders);

  const { response, text } = await fetchRead(
    `${apiBaseUrl()}${path}`,
    {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    path,
    timeoutMs,
    // Only a GET is replayed, and only when it never reached the server.
    method === 'GET',
  );

  const payload = text ? JSON.parse(text) : null;

  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Request failed: ${method} ${path}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    if (response.status === 401) {
      // Access tokens are short-lived. Give the scope's registered refresher one
      // chance to rotate the session and replay the request before treating the
      // 401 as a real sign-out. `_retried` stops a refresh loop, and the
      // rotation itself is coalesced (see refreshSessionOnce) so parallel 401s
      // cannot trip the backend's refresh-reuse detection.
      //
      // `auth` gates this. A request sent without credentials — sign-in itself —
      // cannot have failed because its access token expired, so rotating is
      // pointless: it added a doomed network round trip to every wrong-password
      // attempt and then cleared the stored session and fired
      // `boe:session-invalidated`, signing out a *different*, valid session in
      // another tab. A 401 on an unauthenticated request is just a 401.
      if (auth && !retried && sessionRefreshers[scope]) {
        try {
          await refreshSessionOnce(scope);
          return await apiRequest(path, {
            method,
            body,
            auth,
            scope,
            headers: extraHeaders,
            envelope,
            timeoutMs,
            _retried: true,
          });
        } catch {
          /* fall through to invalidation below */
        }
      }
      if (auth) {
        clearSessionTokens(scope);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('boe:session-invalidated', { detail: { scope } }));
        }
      }
    }
    throw error;
  }

  // `envelope: true` keeps `{ ok, data, meta }` intact — list callers need
  // `meta.page.nextCursor` for keyset pagination, which unwrapping would drop.
  if (envelope) return payload;

  return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
}

export function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}
