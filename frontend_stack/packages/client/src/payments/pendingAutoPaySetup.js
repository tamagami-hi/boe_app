const PENDING_AUTO_PAY_SETUP_KEY = 'boe.pendingAutoPaySetup';
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]{1,160}$/u;
const FINGERPRINT_PATTERN = /^[a-zA-Z0-9._:|-]{1,512}$/u;
const PENDING_AUTO_PAY_SETUP_TTL_MS = 30 * 60 * 1000;

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const remove = () => {
  try {
    storage()?.removeItem(PENDING_AUTO_PAY_SETUP_KEY);
  } catch {
    return;
  }
};

const isIdentifier = (value) => typeof value === 'string' && IDENTIFIER_PATTERN.test(value);

export function autoPayInputFingerprint({ fundId, amount, durationMonths, debitDay }) {
  const amountPaise = Math.round(Number(amount) * 100);
  const months = Number(durationMonths);
  const day = Number(debitDay);
  if (
    !isIdentifier(fundId) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 ||
    !Number.isInteger(months) || months < 1 || !Number.isInteger(day) || day < 1
  ) return null;
  return `${fundId}|${amountPaise}|${day}|${months}`;
}

export function readPendingAutoPaySetup(ownerId) {
  try {
    const raw = storage()?.getItem(PENDING_AUTO_PAY_SETUP_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw);
    const expiresAt = Date.parse(envelope?.expiresAt);
    const isValid =
      isIdentifier(ownerId) && envelope?.ownerId === ownerId &&
      isIdentifier(envelope?.requestKey) &&
      typeof envelope?.inputFingerprint === 'string' && FINGERPRINT_PATTERN.test(envelope.inputFingerprint) &&
      Number.isFinite(expiresAt) && expiresAt > Date.now() &&
      (envelope?.sipPlanId === undefined || isIdentifier(envelope.sipPlanId));
    if (!isValid) {
      remove();
      return null;
    }
    return Object.freeze({
      ownerId: envelope.ownerId,
      requestKey: envelope.requestKey,
      inputFingerprint: envelope.inputFingerprint,
      expiresAt: new Date(expiresAt).toISOString(),
      sipPlanId: envelope.sipPlanId ?? null,
    });
  } catch {
    remove();
    return null;
  }
}

export function beginPendingAutoPaySetup({ ownerId, requestKey, inputFingerprint }) {
  if (!isIdentifier(ownerId) || !isIdentifier(requestKey) || !FINGERPRINT_PATTERN.test(inputFingerprint || '')) return false;
  try {
    storage()?.setItem(PENDING_AUTO_PAY_SETUP_KEY, JSON.stringify({
      ownerId,
      requestKey,
      inputFingerprint,
      expiresAt: new Date(Date.now() + PENDING_AUTO_PAY_SETUP_TTL_MS).toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function completePendingAutoPaySetup({ ownerId, requestKey, sipPlanId }) {
  const pending = readPendingAutoPaySetup(ownerId);
  if (pending === null || pending.requestKey !== requestKey || !isIdentifier(sipPlanId)) return false;
  try {
    storage()?.setItem(PENDING_AUTO_PAY_SETUP_KEY, JSON.stringify({
      ownerId: pending.ownerId,
      requestKey: pending.requestKey,
      inputFingerprint: pending.inputFingerprint,
      expiresAt: pending.expiresAt,
      sipPlanId,
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingAutoPaySetup() {
  remove();
}
