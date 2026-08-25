import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearPendingPayment,
  persistPendingPayment,
  readPendingPayment,
  shouldClearPendingPaymentForSession,
} from './pendingPayment.js';

describe('pending payment recovery', () => {
  beforeEach(() => localStorage.clear());

  test('stores only a principal-bound payment envelope with a bounded expiry', () => {
    vi.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    persistPendingPayment('pay-1', 'user-1');
    const stored = JSON.parse(localStorage.getItem('boe.pendingPayment'));
    expect(Object.keys(stored).sort()).toEqual(['expiresAt', 'ownerId', 'paymentId']);
    expect(stored).toEqual({
      paymentId: 'pay-1', ownerId: 'user-1', expiresAt: '2026-08-24T12:30:00.000Z',
    });
  });

  test('clears recovery on principal mismatch or expiry', () => {
    vi.setSystemTime(new Date('2026-08-24T12:00:00.000Z'));
    persistPendingPayment('pay-1', 'user-1');
    expect(readPendingPayment('user-2')).toBeNull();
    expect(localStorage.getItem('boe.pendingPayment')).toBeNull();
    persistPendingPayment('pay-1', 'user-1');
    vi.setSystemTime(new Date('2026-08-24T12:31:00.000Z'));
    expect(readPendingPayment('user-1')).toBeNull();
    clearPendingPayment();
  });

  test('preserves recovery during a transient restore failure and clears definitive session endings', () => {
    expect(shouldClearPendingPaymentForSession({
      status: 'anonymous', error: Object.assign(new Error('timeout'), { code: 'REQUEST_TIMEOUT' }), endedReason: null,
    })).toBe(false);
    expect(shouldClearPendingPaymentForSession({
      status: 'anonymous', error: Object.assign(new Error('backend unavailable'), { status: 503 }), endedReason: null,
    })).toBe(false);
    expect(shouldClearPendingPaymentForSession({ status: 'anonymous', error: null, endedReason: null })).toBe(true);
    expect(shouldClearPendingPaymentForSession({ status: 'anonymous', error: null, endedReason: 'expired' })).toBe(true);
  });
});
