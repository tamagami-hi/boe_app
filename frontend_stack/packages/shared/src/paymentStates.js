export const CLIENT_PAYMENT_STATES = Object.freeze([
  'payment_in_progress',
  'processing',
  'confirmed',
  'refund_in_progress',
  'support_required',
  'refunded',
  'payment_failed',
]);

export const PAYMENT_RECORD_STATES = Object.freeze([
  'created',
  'provider_pending',
  'succeeded',
  'failed',
  'expired',
  'reconciliation_required',
  'refund_pending',
  'refunded',
  'refund_failed',
]);

export const PAYMENT_RECORD_GROUPS = Object.freeze({
  settled: Object.freeze(['succeeded']),
  inFlight: Object.freeze(['created', 'provider_pending']),
  unsuccessful: Object.freeze(['failed', 'expired']),
});

const NON_TERMINAL_CLIENT_STATES = new Set(['payment_in_progress', 'processing', 'refund_in_progress']);
const CLIENT_PAYMENT_STATE_SET = new Set(CLIENT_PAYMENT_STATES);

const LABELS = Object.freeze({
  payment_in_progress: 'Payment in progress',
  processing: 'Processing',
  confirmed: 'Confirmed',
  refund_in_progress: 'Refund in progress',
  support_required: 'Support required',
  refunded: 'Refunded',
  payment_failed: 'Payment failed',
  success: 'Payment received',
  reconciled: 'Reconciled',
  created: 'Payment created',
  provider_pending: 'With provider',
  pending: 'Payment pending',
  succeeded: 'Succeeded',
  failed: 'Payment failed',
  expired: 'Payment expired',
  reconciliation_required: 'Support required',
  refund_pending: 'Refund pending',
  refund_failed: 'Refund failed',
  submitted: 'Submitted',
});

const SUCCESS_STATES = new Set(['success', 'confirmed', 'reconciled', 'approved', 'succeeded']);
const FAILED_STATES = new Set([
  'failed',
  'expired',
  'rejected',
  'payment_failed',
  'approval_rejected',
  'support_required',
  'reconciliation_required',
  'refund_failed',
]);

export function isClientPaymentPending(status) {
  return NON_TERMINAL_CLIENT_STATES.has(status);
}

export function requireClientPaymentStatus(status) {
  if (CLIENT_PAYMENT_STATE_SET.has(status)) return status;
  throw new Error("Couldn't load this payment. Try again.");
}

export function paymentStatusLabel(status) {
  const key = String(status || '').toLowerCase();
  return LABELS[key] || key.replaceAll('_', ' ') || 'Unknown';
}

export function paymentStatusTone(status) {
  const key = String(status || '').toLowerCase();
  if (SUCCESS_STATES.has(key)) return 'active';
  if (FAILED_STATES.has(key)) return 'failed';
  if (key === 'refunded') return 'neutral';
  return 'paused';
}
