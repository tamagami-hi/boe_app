const PENDING_PAYMENT_KEY = 'boe.pendingPayment';
const PAYMENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/u;
const OWNER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/u;
const PENDING_PAYMENT_TTL_MS = 30 * 60 * 1000;

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export function shouldClearPendingPaymentForSession({ status, error, endedReason }) {
  return status === 'anonymous' && (endedReason === 'expired' || error == null);
}

export function persistPendingPayment(paymentId, ownerId) {
  if (
    typeof paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(paymentId) ||
    typeof ownerId !== 'string' || !OWNER_ID_PATTERN.test(ownerId)
  ) return;
  try {
    storage()?.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
      paymentId,
      ownerId,
      expiresAt: new Date(Date.now() + PENDING_PAYMENT_TTL_MS).toISOString(),
    }));
  } catch {
    return;
  }
}

export function readPendingPayment(ownerId) {
  try {
    const raw = storage()?.getItem(PENDING_PAYMENT_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw);
    const expiresAt = Date.parse(envelope?.expiresAt);
    if (
      typeof ownerId !== 'string' || envelope?.ownerId !== ownerId ||
      !PAYMENT_ID_PATTERN.test(envelope?.paymentId || '') ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now()
    ) {
      storage()?.removeItem(PENDING_PAYMENT_KEY);
      return null;
    }
    return envelope.paymentId;
  } catch {
    storage()?.removeItem(PENDING_PAYMENT_KEY);
    return null;
  }
}

export function clearPendingPayment(paymentId, ownerId) {
  try {
    const raw = storage()?.getItem(PENDING_PAYMENT_KEY);
    if (!raw || !paymentId) {
      storage()?.removeItem(PENDING_PAYMENT_KEY);
      return;
    }
    const current = JSON.parse(raw);
    if (current?.paymentId === paymentId && (!ownerId || current?.ownerId === ownerId)) {
      storage()?.removeItem(PENDING_PAYMENT_KEY);
    }
  } catch {
    return;
  }
}
