import { describe, expect, test } from 'vitest';
import { requireClientPaymentStatus } from './paymentStates.js';

describe('requireClientPaymentStatus', () => {
  test('returns every canonical client payment status', () => {
    expect(requireClientPaymentStatus('confirmed')).toBe('confirmed');
    expect(requireClientPaymentStatus('refund_in_progress')).toBe('refund_in_progress');
  });

  test('rejects an internal or unknown payment status', () => {
    expect(() => requireClientPaymentStatus('provider_pending')).toThrow("Couldn't load this payment. Try again.");
    expect(() => requireClientPaymentStatus('mystery')).toThrow("Couldn't load this payment. Try again.");
  });
});
