import { platformSecurity, platformStorage } from '../platform/clientPlatform.js';

const SETTINGS_PREFIX = 'boe.client.security.v1';

/**
 * ── LOCK POLICY ─────────────────────────────────────────────────────────────
 * The app lock is not an inactivity timeout. Once signed in, a client stays
 * signed in until they sign out (or their session is evicted by the device cap);
 * what the PIN guards is *this device*, so the lock engages exactly twice:
 *
 *   • on every launch      — a cold start has a fresh JS context, so the
 *                            in-memory unlock flag below is necessarily absent
 *   • on every background   — cleared explicitly when the app is paused
 *
 * The flag is deliberately held only in memory. Persisting it (sessionStorage,
 * secure storage, a timestamp) would mean trusting that the store is cleared
 * when the process dies, and a stale "unlocked" record would leave the app open
 * on a launch it should have locked. Memory gives that guarantee for free.
 */
const unlocked = new Set();

// In-memory cache of persisted settings so sync helpers can read without await.
const settingsCache = new Map();

function userKey(user) {
  return user?.id || user?.email || 'local-client';
}

function settingsKey(user) {
  return `${SETTINGS_PREFIX}.${userKey(user)}`;
}

function defaultSettings() {
  return {
    pinHash: '',
    pinSalt: '',
    pinSetAt: '',
    biometricEnabled: false,
    biometricCredentialId: '',
    biometricSetAt: '',
    deviceId: platformSecurity.device.id(),
    deviceLabel: platformSecurity.device.label(),
    updatedAt: new Date().toISOString(),
  };
}

async function readRaw(user) {
  const key = settingsKey(user);
  const cached = settingsCache.get(key);
  if (cached) return cached;

  const stored = await platformStorage.local.get(key);
  if (stored) {
    const merged = { ...defaultSettings(), ...stored };
    settingsCache.set(key, merged);
    return merged;
  }
  return defaultSettings();
}

function readRawSync(user) {
  const key = settingsKey(user);
  return settingsCache.get(key) || defaultSettings();
}

async function writeRaw(user, next) {
  const key = settingsKey(user);
  const payload = { ...next, updatedAt: new Date().toISOString() };
  settingsCache.set(key, payload);
  await platformStorage.local.set(key, payload);
  window.dispatchEvent(new CustomEvent('boe:security-settings-changed', { detail: { userKey: userKey(user) } }));
  return payload;
}

export async function getSecurityState(user) {
  const settings = await readRaw(user);
  const hasPin = Boolean(settings.pinHash && settings.pinSalt);
  const availability = await platformSecurity.biometric.availability();
  return {
    pinSet: hasPin,
    pinSetAt: settings.pinSetAt,
    biometricEnabled: hasPin && Boolean(settings.biometricEnabled && settings.biometricCredentialId),
    biometricAvailable: availability.available,
    biometricLabel: availability.label,
    biometricReason: availability.reason,
    deviceId: settings.deviceId || platformSecurity.device.id(),
    deviceLabel: settings.deviceLabel || platformSecurity.device.label(),
    updatedAt: settings.updatedAt,
  };
}

export function getSecurityStateSync(user) {
  const settings = readRawSync(user);
  return {
    pinSet: Boolean(settings.pinHash && settings.pinSalt),
    biometricEnabled: Boolean(settings.biometricEnabled && settings.biometricCredentialId),
  };
}

export function validatePin(pin) {
  return /^\d{4,6}$/.test(String(pin || ''));
}

export async function setPin(user, pin) {
  if (!validatePin(pin)) {
    const error = new Error('Use a 4 to 6 digit PIN.');
    error.code = 'INVALID_PIN';
    throw error;
  }
  const saltBytes = platformSecurity.crypto.randomBytes(32);
  const pinSalt = await platformSecurity.crypto.digest(
    Array.from(saltBytes, (b) => String.fromCharCode(b)).join('')
  );
  const pinHash = await platformSecurity.crypto.digest(`${pinSalt}:${pin}`);
  const current = await readRaw(user);
  const next = await writeRaw(user, {
    ...current,
    pinHash,
    pinSalt,
    pinSetAt: new Date().toISOString(),
    biometricEnabled: false,
    biometricCredentialId: '',
    biometricSetAt: '',
    deviceId: current.deviceId || platformSecurity.device.id(),
    deviceLabel: current.deviceLabel || platformSecurity.device.label(),
  });
  // Setting a PIN must not immediately lock the user out of the screen they are
  // standing on.
  markUnlocked(user);
  return getSecurityState(user);
}

export async function verifyPin(user, pin) {
  const current = await readRaw(user);
  if (!current.pinHash || !current.pinSalt) return false;
  const pinHash = await platformSecurity.crypto.digest(`${current.pinSalt}:${pin}`);
  return pinHash === current.pinHash;
}

export async function clearPin(user, currentPin) {
  const ok = await verifyPin(user, currentPin);
  if (!ok) {
    const error = new Error('Current PIN is incorrect.');
    error.code = 'BAD_PIN';
    throw error;
  }
  const current = await readRaw(user);
  await writeRaw(user, {
    ...current,
    pinHash: '',
    pinSalt: '',
    pinSetAt: '',
    biometricEnabled: false,
    biometricCredentialId: '',
    biometricSetAt: '',
  });
  clearUnlock(user);
  return getSecurityState(user);
}

export async function enableBiometric(user) {
  const current = await readRaw(user);
  if (!current.pinHash) {
    const error = new Error('Set an app PIN first.');
    error.code = 'PIN_REQUIRED';
    throw error;
  }
  const availability = await platformSecurity.biometric.availability();
  if (!availability.available) {
    const error = new Error('Device biometric unlock is not available on this device.');
    error.code = 'BIOMETRIC_UNAVAILABLE';
    throw error;
  }

  const result = await platformSecurity.biometric.enroll({
    userId: user?.email || user?.name || 'client',
    displayName: user?.name || 'BeOnEdge Client',
  });

  if (!result.ok) throw new Error('Biometric setup was cancelled.');
  await writeRaw(user, {
    ...current,
    biometricEnabled: true,
    biometricCredentialId: result.credentialId,
    biometricSetAt: new Date().toISOString(),
  });
  return getSecurityState(user);
}

export async function disableBiometric(user) {
  const current = await readRaw(user);
  await platformSecurity.biometric.disable({ credentialId: current.biometricCredentialId });
  await writeRaw(user, {
    ...current,
    biometricEnabled: false,
    biometricCredentialId: '',
    biometricSetAt: '',
  });
  return getSecurityState(user);
}

export async function authenticateBiometric(user) {
  const current = await readRaw(user);
  if (!current.biometricEnabled || !current.biometricCredentialId) return false;
  const availability = await platformSecurity.biometric.availability();
  if (!availability.available) return false;
  // The OS keystore is the source of truth. If the credential is gone (app data
  // partially cleared, biometrics reset), self-heal the setting instead of
  // failing on every unlock forever.
  if (!(await platformSecurity.biometric.enrolled({ credentialId: current.biometricCredentialId }))) {
    await writeRaw(user, {
      ...current,
      biometricEnabled: false,
      biometricCredentialId: '',
      biometricSetAt: '',
    });
    return false;
  }
  // Throws on cancel/failure — the caller distinguishes "declined" (fall back to
  // the PIN) from "unavailable" (false).
  await platformSecurity.biometric.authenticate({
    credentialId: current.biometricCredentialId,
    reason: 'Unlock BeOnEdge',
  });
  markUnlocked(user);
  return true;
}

/** Mark this device unlocked for the current foreground run of the app. */
export function markUnlocked(user) {
  unlocked.add(userKey(user));
}

/** Drop the unlock, so the next render locks. Called on pause and on sign-out. */
export function clearUnlock(user) {
  unlocked.delete(userKey(user));
}

export function isUnlocked(user) {
  return unlocked.has(userKey(user));
}

export function currentSession(user) {
  return {
    id: platformSecurity.device.id(),
    label: platformSecurity.device.label(),
    user: user?.email || user?.phoneMasked || user?.name || 'Client session',
    lastActive: new Date().toISOString(),
  };
}
