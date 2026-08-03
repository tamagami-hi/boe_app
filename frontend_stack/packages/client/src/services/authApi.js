import { fixtureUser } from '../data/fixtureUser.js';
import {
  apiRequest,
  clearSessionTokens,
  clone,
  delay,
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

// Map the canonical native principal ({ userId, fullName, phoneMasked,
// accountStatus }) to the app's user input shape for toClientUser.
function fromNativeUser(nativeUser) {
  return {
    id: nativeUser?.userId,
    name: nativeUser?.fullName,
    email: nativeUser?.email,
    phoneMasked: nativeUser?.phoneMasked,
    status: 'approved',
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

function writeLocalPendingApprovals(rows) {
  const storage = localStorageHandle();
  if (!storage) return;
  storage.setItem(LOCAL_PENDING_APPROVALS_KEY, JSON.stringify(rows));
}

function rememberLocalPendingApproval(user) {
  const row = {
    id: user.id || user.approvalRef || localUuid(),
    name: user.name,
    email: user.email,
    status: user.status,
    role: user.role || 'client',
    createdAt: new Date().toISOString(),
    approvalRef: user.approvalRef || '',
  };
  const rows = readLocalPendingApprovals().filter((item) => item.email !== row.email);
  rows.unshift(row);
  writeLocalPendingApprovals(rows);
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
      // Admin uses canonical web auth: HttpOnly cookies + synchronizer CSRF.
      const result = await apiRequest('/v1/auth/web/login', {
        method: 'POST',
        auth: false,
        scope,
        body: { email: credentials.identifier || credentials.email, password: credentials.password },
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

export async function signup(details = {}, { scope = 'client' } = {}) {
  if (useHttpApi()) {
    // The canonical onboarding model has no self-service account signup: a user
    // applies (on the website), verifies their email, is approved by an admin,
    // and receives an activation link where they set a password. Direct API
    // account creation is intentionally unsupported here.
    const error = new Error(
      'Account creation is by application and admin approval. Apply on the website to receive an activation link.',
    );
    error.code = 'SIGNUP_VIA_APPLICATION';
    throw error;
  }

  await delay(280);
  const user = assertScopeUser(toClientUser({
    id: `local_${Date.now()}`,
    name: details.name || details.email || 'BeOnEdge Client',
    email: details.email || '',
    phone: details.phone || '',
    role: 'client',
    status: 'pending_review',
    approvalRef: localUuid(),
    riskProfileStatus: 'pending',
    kycStatus: 'pending',
  }), scope);
  _users[scope] = user;
  rememberLocalPendingApproval(user);
  return clone(user);
}

export async function logout({ scope = 'client' } = {}) {
  if (useHttpApi()) {
    const logoutPath = scope === 'admin' ? '/v1/auth/web/logout' : '/v1/auth/native/logout';
    const logoutBody = scope === 'admin' ? undefined : { refreshToken: storedRefreshToken(scope) };
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

/**
 * Complete an activation invite (`POST /v1/activations/complete`): the invited
 * user sets their first password with the token from the invite email and
 * receives a native session in return. This is the only self-service path into
 * an account — signup is application + admin approval.
 */
export async function completeActivation({ token, password } = {}) {
  if (!useHttpApi()) {
    await delay(120);
    throw new Error('Activation needs the backend. Set VITE_BEO_API_MODE=http.');
  }
  const result = await apiRequest('/v1/activations/complete', {
    method: 'POST',
    auth: false,
    scope: 'client',
    body: { token, password, device: buildDevice() },
  });
  const user = assertScopeUser(toClientUser(fromNativeUser(result.user)), 'client');
  setSessionTokens({
    user,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    scope: 'client',
  });
  _users.client = user;
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
    const refreshed = await refreshCurrentUser(scope).catch(() => null);
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
