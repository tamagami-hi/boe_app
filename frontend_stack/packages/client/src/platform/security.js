import { Capacitor } from '@capacitor/core';
import {
  AccessControl,
  BiometricAuthError,
  BiometryType,
  NativeBiometric,
} from '@capgo/capacitor-native-biometric';

const BIOMETRIC_SERVER_PREFIX = 'beonedge.app-lock';

function randomBytes(length = 16) {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function bytesToBase64Url(bytes) {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fallbackHash(value) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

async function digest(value) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return bytesToBase64Url(new Uint8Array(hash));
  }
  return fallbackHash(value);
}

function isNativeRuntime() {
  try {
    return Boolean(Capacitor.isNativePlatform?.());
  } catch {
    return false;
  }
}

function normalizeCredentialId(value) {
  const raw = String(value || 'client').trim() || 'client';
  return `${BIOMETRIC_SERVER_PREFIX}.${raw.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function biometricLabel(type) {
  if (type === BiometryType.FINGERPRINT || type === BiometryType.TOUCH_ID) return 'Fingerprint unlock';
  if (type === BiometryType.FACE_AUTHENTICATION || type === BiometryType.FACE_ID) return 'Face unlock';
  if (type === BiometryType.IRIS_AUTHENTICATION) return 'Iris unlock';
  if (type === BiometryType.MULTIPLE) return 'Fingerprint or face unlock';
  return 'Fingerprint or face unlock';
}

function isBiometricType(type) {
  return type !== BiometryType.NONE && type !== BiometryType.DEVICE_CREDENTIAL;
}

function authErrorCode(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    if (Object.prototype.hasOwnProperty.call(BiometricAuthError, value)) return BiometricAuthError[value];
  }
  return BiometricAuthError.UNKNOWN_ERROR;
}

function availabilityReason(result) {
  if (result?.isAvailable) return 'ok';
  const code = authErrorCode(result?.errorCode);
  if (code === BiometricAuthError.BIOMETRICS_NOT_ENROLLED) return 'not-enrolled';
  if (code === BiometricAuthError.BIOMETRICS_UNAVAILABLE) return 'not-supported';
  if (code === BiometricAuthError.PASSCODE_NOT_SET) return 'device-not-secure';
  if (code === BiometricAuthError.USER_LOCKOUT || code === BiometricAuthError.USER_TEMPORARY_LOCKOUT) return 'locked-out';
  return 'plugin-error';
}

function platformError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeBiometricError(error) {
  const code = authErrorCode(error?.code);
  if (code === BiometricAuthError.USER_CANCEL || code === BiometricAuthError.SYSTEM_CANCEL || code === BiometricAuthError.APP_CANCEL) {
    return platformError('BIOMETRIC_CANCELLED', 'Biometric unlock was cancelled.');
  }
  if (code === BiometricAuthError.BIOMETRICS_NOT_ENROLLED) {
    return platformError('BIOMETRIC_NOT_ENROLLED', 'No biometric unlock is enrolled on this device.');
  }
  if (code === BiometricAuthError.BIOMETRICS_UNAVAILABLE || code === BiometricAuthError.PASSCODE_NOT_SET) {
    return platformError('BIOMETRIC_UNAVAILABLE', 'Device biometric unlock is not available.');
  }
  if (code === BiometricAuthError.AUTHENTICATION_FAILED || code === BiometricAuthError.USER_LOCKOUT || code === BiometricAuthError.USER_TEMPORARY_LOCKOUT) {
    return platformError('BIOMETRIC_FAILED', 'Biometric unlock failed.');
  }
  return platformError('BIOMETRIC_FAILED', error?.message || 'Biometric unlock failed.');
}

async function biometricAvailability() {
  if (!isNativeRuntime()) {
    return {
      available: false,
      enrolled: false,
      type: 'native-biometric',
      label: 'Fingerprint or face unlock',
      reason: 'not-native-runtime',
    };
  }

  try {
    const result = await NativeBiometric.isAvailable({ useFallback: false });
    const available = Boolean(result.isAvailable && isBiometricType(result.biometryType));
    return {
      available,
      enrolled: available ? true : authErrorCode(result.errorCode) === BiometricAuthError.BIOMETRICS_NOT_ENROLLED ? false : null,
      type: 'native-biometric',
      label: biometricLabel(result.biometryType),
      reason: available ? 'ok' : result.biometryType === BiometryType.DEVICE_CREDENTIAL ? 'biometric-not-enrolled' : availabilityReason(result),
    };
  } catch (error) {
    return {
      available: false,
      enrolled: null,
      type: 'native-biometric',
      label: 'Fingerprint or face unlock',
      reason: availabilityReason({ errorCode: error?.code }),
    };
  }
}

async function biometricEnroll({ userId, displayName } = {}) {
  const availability = await biometricAvailability();
  if (!availability.available) {
    throw platformError('BIOMETRIC_UNAVAILABLE', 'Device biometric unlock is not available.');
  }

  const credentialId = normalizeCredentialId(userId || displayName);
  try {
    await NativeBiometric.setCredentials({
      username: userId || 'client',
      // The stored secret is never read for its value — possession of it is the
      // proof. It exists only so the keystore has something to gate behind a
      // biometric check.
      password: bytesToBase64Url(randomBytes(32)),
      server: credentialId,
      // BIOMETRY_ANY, not BIOMETRY_CURRENT_SET: adding a fingerprint later must
      // not silently break app unlock. Enrolment changes are a convenience
      // concern here, not a trust boundary — the PIN is the real fallback.
      accessControl: AccessControl.BIOMETRY_ANY,
    });
    // Confirm the credential really landed in the keystore. Without this, a
    // silent write failure would leave the app advertising biometric unlock in
    // settings while every unlock attempt fails.
    const saved = await NativeBiometric.isCredentialsSaved({ server: credentialId });
    if (!saved?.isSaved) {
      throw platformError('BIOMETRIC_FAILED', 'The device did not store the biometric key.');
    }
    return { ok: true, credentialId };
  } catch (error) {
    if (error?.code === 'BIOMETRIC_FAILED') throw error;
    throw normalizeBiometricError(error);
  }
}

/** Is a biometric credential still present for this id? */
async function biometricEnrolled({ credentialId } = {}) {
  if (!credentialId || !isNativeRuntime()) return false;
  try {
    const saved = await NativeBiometric.isCredentialsSaved({ server: credentialId });
    return Boolean(saved?.isSaved);
  } catch {
    return false;
  }
}

async function biometricAuthenticate({ credentialId, reason } = {}) {
  if (!credentialId) {
    throw platformError('BIOMETRIC_UNAVAILABLE', 'Biometric unlock is not configured.');
  }

  try {
    await NativeBiometric.getSecureCredentials({
      server: credentialId,
      reason: reason || 'Unlock BeOnEdge',
      title: 'Unlock BeOnEdge',
      subtitle: 'Confirm it is you',
      description: 'Use your device biometric unlock to continue.',
      negativeButtonText: 'Use PIN',
    });
    return { ok: true };
  } catch (error) {
    throw normalizeBiometricError(error);
  }
}

async function biometricDisable({ credentialId } = {}) {
  if (!credentialId) return { ok: true };
  try {
    await NativeBiometric.deleteCredentials({ server: credentialId });
  } catch {
    // Settings removal should not be blocked by a missing native credential.
  }
  return { ok: true };
}

function deviceId() {
  const KEY = 'boe.client.platform.deviceId.v1';
  if (typeof window === 'undefined') return 'device-unknown';
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(KEY, id);
    return id;
  } catch {
    return `device-${Date.now()}`;
  }
}

function deviceLabel() {
  return 'Android device';
}

export const platformSecurity = {
  biometric: {
    availability: biometricAvailability,
    enroll: biometricEnroll,
    enrolled: biometricEnrolled,
    authenticate: biometricAuthenticate,
    disable: biometricDisable,
  },
  crypto: {
    randomBytes,
    digest,
  },
  device: {
    id: deviceId,
    label: deviceLabel,
  },
};
