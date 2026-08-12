import { fixtureUser } from '../data/fixtureUser.js';
import { Capacitor } from '@capacitor/core';

import {
  apiRequest,
  clearSessionTokens,
  clone,
  delay,
  refreshSession,
  setSessionCsrf,
  setSessionTokens,
  storedAccessToken,
  storedRefreshToken,
  storedUser,
  useHttpApi,
  registerSessionRefresher,
} from './_util.js';

const DEVICE_ID_KEY = 'boe.client.deviceId';
const CLIENT_APP_VERSION = '1.0.0';

/**
 * Does the admin console have to authenticate with a bearer token rather than
 * the HttpOnly session cookie?
 *
 * Inside the Android build the SPA is served from `https://localhost` while the
 * API is on a beonedge.in subdomain. Those are different registrable domains, so
 * every API call is cross-site: the `SameSite=Lax` session cookie is not sent,
 * browsers may refuse to store it as a third-party cookie at all, and the
 * backend's own Origin gate rejects `Sec-Fetch-Site: cross-site`. Cookie auth
 * therefore cannot work there, and the console uses the same native bearer
 * token the client app uses. The backend accepts either transport and applies
 * identical RBAC to both — see domain/admin/adminAccess.ts.
 *
 * The browser console is served same-site with the API and keeps using cookies,
 * which is the stronger option where it is available because the token stays
 * out of reach of JavaScript.
 */
function adminUsesBearer() {
  try {
    return Boolean(Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

let _users = {
  client: null,
  admin: null,
};

const LOCAL_PENDING_APPROVALS_KEY = 'boe.local.pendingApprovals';

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function maskPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  const last = digits.slice(-3);
  return last ? `+91 ••••• ••${last}` : '';
}

function localUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Native login/refresh require a stable device installation UUID. On the APK
// this identifies the Capacitor install; in the browser preview it is a stable
// per-browser UUID. platform is 'android' as the backend requires.
function getOrCreateDeviceId() {
  const storage = localStorageHandle();
  if (!storage) return localUuid();
  let id = storage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = localUuid();
    storage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function buildDevice() {
  return {
    installationId: getOrCreateDeviceId(),
    name: 'BeOnEdge Client',
    platform: 'android',
    appVersion: CLIENT_APP_VERSION,
  };
}

/**
 * Device identity for an admin native session. The admin and client builds are
 * separate applicationIds with separate WebView storage, so the installation UUID
 * is naturally distinct; the name differs too so an operator reading the session
 * list can tell an admin console session from an investor one.
 */
function buildAdminDevice() {
  return {
    installationId: getOrCreateDeviceId(),
    name: 'BeOnEdge Admin',
    platform: 'android',
    appVersion: CLIENT_APP_VERSION,
  };
}

// Map the canonical native principal ({ userId, fullName, phoneMasked,
// accountStatus }) to the app's user input shape for toClientUser. The backend
// account status is the source of truth: 'active' is the app's 'approved'
// vocabulary; anything else (e.g. a future suspended/closed state) passes
// through verbatim so terminal-account handling in ClientLayout still works.
function fromNativeUser(nativeUser) {
  const accountStatus = String(nativeUser?.accountStatus || '').trim().toLowerCase();
  return {
    id: nativeUser?.userId,
    name: nativeUser?.fullName,
    email: nativeUser?.email,
    phoneMasked: nativeUser?.phoneMasked,
    status: accountStatus === 'active' ? 'approved' : accountStatus,
    role: 'client',
    roles: ['client'],
  };
}

function localStorageHandle() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLocalPendingApprovals() {
  const raw = localStorageHandle()?.getItem(LOCAL_PENDING_APPROVALS_KEY);
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function toClientUser(user) {
  if (!user) return null;
  const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'BeOnEdge Client';
  const rawRoles = Array.isArray(user.roles) ? user.roles : [];
  const role = String(user.role || user.accountType || rawRoles[0] || 'client').toLowerCase();
  const roles = (rawRoles.length ? rawRoles : [role])
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return {
    id: user.id,
    name,
    email: user.email || '',
    phoneMasked: user.phoneMasked || maskPhone(user.phone),
    status: user.status || 'approved',
    approvalRef: user.approvalRef || user.approval_ref || user.approvalReference || user.approval_reference || '',
    riskProfileStatus: user.riskProfileStatus || user.risk_profile_status || '',
    kycStatus: user.kycStatus || user.kyc_status || '',
    role,
    roles,
    avatarInitials: user.avatarInitials || initials(name) || 'BO',
  };
}

// Map the canonical web-auth principal ({ userId, fullName, email, roles,
// permissions }) to the app's user shape. Any successful web login is an admin
// principal (the backend rejects zero-role users), so 'admin' is injected to
// satisfy the admin app's role gate while the canonical roles/permissions are
// preserved for RBAC-aware UI.
function toAdminUser(principal) {
  const canonicalRoles = Array.isArray(principal?.roles)
    ? principal.roles.map((value) => String(value).toLowerCase())
    : [];
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  const base = toClientUser({
    id: principal?.userId,
    name: principal?.fullName,
    email: principal?.email,
    status: 'approved',
    role: 'admin',
    roles: [...new Set([...canonicalRoles, 'admin'])],
  });
  return { ...base, permissions };
}

export function hasRole(user, role) {
  return user?.roles?.some((value) => String(value).toLowerCase() === role) ||
    String(user?.role || '').toLowerCase() === role;
}

function assertScopeUser(user, scope) {
  if (scope === 'admin' && !hasRole(user, 'admin')) {
    const error = new Error('Admin access is required.');
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }
  if (scope === 'client' && hasRole(user, 'admin')) {
    const error = new Error('Use the admin login for admin access.');
    error.code = 'ADMIN_LOGIN_REQUIRED';
    throw error;
  }
  return user;
}

export async function login(credentials = {}, { scope = 'client' } = {}) {
  if (useHttpApi()) {
    if (scope === 'admin') {
      const email = credentials.identifier || credentials.email;

      if (adminUsesBearer()) {
        // Native transport. The login proves identity but says nothing about
        // authority, so the admin principal is fetched separately; a non-admin
        // account authenticates here and is then rejected by /v1/admin/session,
        // which is what turns a client credential into ADMIN_REQUIRED rather
        // than a half-open console.
        const session = await apiRequest('/v1/auth/native/login', {
          method: 'POST',
          auth: false,
          scope,
          body: { email, password: credentials.password, device: buildAdminDevice() },
        });
        setSessionTokens({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          scope,
        });
        try {
          const principal = await apiRequest('/v1/admin/session', { scope });
          const user = assertScopeUser(toAdminUser(principal), scope);
          setSessionTokens({ user, scope });
          _users[scope] = user;
          return clone(user);
        } catch (error) {
          // Never leave a usable client token behind under the admin scope.
          clearSessionTokens(scope);
          _users[scope] = null;
          if (error?.status === 403) {
            const denied = new Error('Admin access is required.');
            denied.code = 'ADMIN_REQUIRED';
            throw denied;
          }
          throw error;
        }
      }

      // Browser transport: canonical web auth, HttpOnly cookies + synchronizer CSRF.
      const result = await apiRequest('/v1/auth/web/login', {
        method: 'POST',
        auth: false,
        scope,
        body: { email, password: credentials.password },
      });
      const user = assertScopeUser(toAdminUser(result.user), scope);
      setSessionCsrf(result.csrfToken, scope);
      setSessionTokens({ user, scope });
      _users[scope] = user;
      return clone(user);
    }

    // Client (native) auth: bearer access + rotating refresh, held in storage.
    const result = await apiRequest('/v1/auth/native/login', {
      method: 'POST',
      auth: false,
      scope,
      body: {
        email: credentials.identifier || credentials.email,
        password: credentials.password,
        device: buildDevice(),
      },
    });
    const user = assertScopeUser(toClientUser(fromNativeUser(result.user)), scope);
    setSessionTokens({ user, accessToken: result.accessToken, refreshToken: result.refreshToken, scope });
    _users[scope] = user;
    return clone(user);
  }

  await delay(280);
  const identifier = String(credentials.identifier || credentials.email || credentials.phone || '').trim();
  const isEmail = identifier.includes('@');
  const isAdmin = scope === 'admin';
  const user = assertScopeUser(toClientUser({
    ...fixtureUser,
    id: `local_${Date.now()}`,
    name: isAdmin ? 'BeOnEdge Admin' : isEmail ? identifier.split('@')[0] : 'BeOnEdge Client',
    email: isEmail ? identifier : fixtureUser.email,
    phone: isEmail ? '' : identifier,
    status: 'approved',
    role: isAdmin ? 'admin' : 'client',
    roles: [isAdmin ? 'admin' : 'client'],
  }), scope);
  _users[scope] = user;
  return clone(user);
}

export async function listPendingApprovals() {
  await delay(80);
  return clone(readLocalPendingApprovals());
}

export async function logout({ scope = 'client' } = {}) {
  if (useHttpApi()) {
    // An admin session on the native transport is a native session, so it must
    // be revoked through the native door; the web logout route authenticates
    // from the cookie this transport does not have.
    const nativeAdmin = scope === 'admin' && adminUsesBearer();
    const useNativeDoor = scope !== 'admin' || nativeAdmin;
    const logoutPath = useNativeDoor ? '/v1/auth/native/logout' : '/v1/auth/web/logout';
    const logoutBody = useNativeDoor ? { refreshToken: storedRefreshToken(scope) } : undefined;
    try {
      await apiRequest(logoutPath, { method: 'POST', scope, body: logoutBody });
    } finally {
      clearSessionTokens(scope);
      _users[scope] = null;
    }
    return;
  }

  await delay(120);
  _users[scope] = null;
}

/**
 * Rotate the stored native session.
 *
 * Always reached through `refreshSession('client')` rather than called
 * directly, so a boot-time restore and a concurrent 401 recovery share one
 * rotation. Two rotations of the same refresh token are treated as token theft
 * by the backend and revoke the whole session family.
 */
async function refreshCurrentUser(scope) {
  const refreshToken = storedRefreshToken(scope);
  if (!refreshToken) {
    throw new Error('No refresh token available.');
  }
  const result = await apiRequest('/v1/auth/native/refresh', {
    method: 'POST',
    auth: false,
    scope,
    body: { refreshToken, rotationId: localUuid() },
  });
  // Native refresh returns tokens only; retain the stored principal.
  const user = assertScopeUser(toClientUser(storedUser(scope)), scope);
  setSessionTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken, user, scope });
  _users[scope] = user;
  return clone(user);
}

/**
 * Rotate the admin web session from its HttpOnly refresh cookie
 * (`POST /v1/auth/web/refresh`). The response rotates both the refresh cookie
 * and the synchronizer CSRF token, so the new token is stored before any further
 * unsafe request. Used when a cookie-scoped call comes back 401 after the short
 * access-token TTL has elapsed.
 */
export async function refreshAdminSession() {
  if (adminUsesBearer()) {
    // Native transport: rotate the stored refresh token, then re-read the
    // principal so a permission change made while the app was backgrounded is
    // picked up rather than trusting the cached copy.
    const refreshToken = storedRefreshToken('admin');
    if (!refreshToken) throw new Error('No refresh token available.');
    const rotated = await apiRequest('/v1/auth/native/refresh', {
      method: 'POST',
      auth: false,
      scope: 'admin',
      body: { refreshToken, rotationId: localUuid() },
    });
    setSessionTokens({
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      scope: 'admin',
    });
    const principal = await apiRequest('/v1/admin/session', { scope: 'admin' });
    const user = assertScopeUser(toAdminUser(principal), 'admin');
    setSessionTokens({ user, scope: 'admin' });
    _users.admin = user;
    return clone(user);
  }

  const result = await apiRequest('/v1/auth/web/refresh', {
    method: 'POST',
    auth: false,
    scope: 'admin',
  });
  const user = assertScopeUser(toAdminUser(result.user), 'admin');
  setSessionCsrf(result.csrfToken, 'admin');
  setSessionTokens({ user, scope: 'admin' });
  _users.admin = user;
  return clone(user);
}

// Register the 401 recovery paths with the transport: the admin (cookie) scope
// rotates via `/v1/auth/web/refresh`, the client (native) scope via its stored
// refresh token. Registered once at module load.
registerSessionRefresher('admin', refreshAdminSession);
registerSessionRefresher('client', () => refreshCurrentUser('client'));

export async function currentUser({ scope = 'client' } = {}) {
  if (useHttpApi()) {
    if (scope === 'admin') {
      if (adminUsesBearer()) {
        // Native transport: no cookie to recover from, so the stored bearer is
        // re-presented. /v1/admin/session doubles as the "is this still a valid
        // admin session" probe; apiRequest transparently rotates the token once
        // on 401 before this rejects.
        if (!storedAccessToken(scope)) {
          _users[scope] = null;
          return null;
        }
        try {
          const principal = await apiRequest('/v1/admin/session', { scope });
          const user = assertScopeUser(toAdminUser(principal), scope);
          setSessionTokens({ user, scope });
          _users[scope] = user;
          return clone(user);
        } catch {
          clearSessionTokens(scope);
          _users[scope] = null;
          return null;
        }
      }

      // Restore the admin session from the HttpOnly cookies via the CSRF
      // reload-recovery endpoint, which returns the principal + a fresh token.
      try {
        const recovered = await apiRequest('/v1/auth/web/csrf', { scope });
        const user = assertScopeUser(toAdminUser(recovered.user), scope);
        setSessionCsrf(recovered.csrfToken, scope);
        setSessionTokens({ user, scope });
        _users[scope] = user;
        return clone(user);
      } catch {
        clearSessionTokens(scope);
        _users[scope] = null;
        return null;
      }
    }

    // Client (native): there is no server session endpoint. Trust the stored
    // principal while an access token is present; otherwise rotate the refresh
    // token to re-establish the session.
    const storedClientUser = storedUser(scope);
    if (storedAccessToken(scope) && storedClientUser) {
      try {
        const user = assertScopeUser(toClientUser(storedClientUser), scope);
        _users[scope] = user;
        return clone(user);
      } catch {
        clearSessionTokens(scope);
        _users[scope] = null;
        return null;
      }
    }
    const refreshed = await refreshSession(scope).catch(() => null);
    if (refreshed) return refreshed;
    clearSessionTokens(scope);
    _users[scope] = null;
    return null;
  }

  await delay(60);
  return _users[scope] ? clone(_users[scope]) : null;
}

export async function checkReachability() {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('simulate') === 'offline') {
    await delay(180);
    return { ok: false, minVersion: '1.0.0' };
  }

  if (useHttpApi()) {
    // Canonical health envelope: { status: 'ok' }. Map to the reachability shape.
    const health = await apiRequest('/v1/health', { auth: false }).catch(() => null);
    return { ok: health?.status === 'ok', minVersion: '1.0.0' };
  }

  await delay(180);
  return { ok: true, minVersion: '1.0.0' };
}
