import { describe, expect, test, vi } from 'vitest';
import { executeOrderCheckout } from './checkoutOrchestrator.js';
import { mapPaymentCheckout } from '../services/ordersApi.js';
import { redirectToCheckout } from '../utils/checkoutRedirect.js';

const sdkCheckout = {
  orderId: 'order-1',
  paymentId: 'payment-1',
  provider: 'phonepe',
  checkout: {
    type: 'phonepe_sdk',
    providerOrderId: 'provider-order-1',
    token: 'sdk-token',
    merchantId: 'merchant-1',
    environment: 'SANDBOX',
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  },
};

describe('order checkout orchestration', () => {
  test('rejects malformed SDK checkout material before it reaches the native boundary', () => {
    expect(() => mapPaymentCheckout({
      ...sdkCheckout.checkout,
      environment: 'STAGING',
    })).toThrow("Couldn't start the payment. Try again.");
  });

  test.each([
    { token: '   ' },
    { expiresAt: 'not-a-date' },
    { expiresAt: new Date(Date.now() + 1000).toISOString() },
  ])('rejects unsafe SDK checkout material before native dispatch', (invalid) => {
    expect(() => mapPaymentCheckout({ ...sdkCheckout.checkout, ...invalid }))
      .toThrow("Couldn't start the payment. Try again.");
  });

  test('persists recovery state and opens hosted checkout for a one-time payment', async () => {
    const redirect = vi.fn().mockReturnValue({ ok: true });
    const persistPendingPayment = vi.fn().mockReturnValue(true);
    const navigate = vi.fn();
    const beginPayment = vi.fn().mockResolvedValue({
      paymentId: 'payment-2',
      checkout: { type: 'redirect', url: 'https://mercury.phonepe.com/pay/abc' },
    });
    const platform = {
      resolveChannel: vi.fn().mockResolvedValue('phonepe_mobile_sdk'),
      start: vi.fn(),
    };
    await expect(executeOrderCheckout({
      orderId: 'order-1', beginPayment, platform, navigate, redirect, persistPendingPayment,
    })).resolves.toEqual({ leaving: true, paymentId: 'payment-2' });
    expect(beginPayment).toHaveBeenCalledWith('order-1', { checkoutChannel: 'hosted_redirect' });
    expect(persistPendingPayment).toHaveBeenCalledWith('payment-2');
    expect(redirect).toHaveBeenCalledWith('https://mercury.phonepe.com/pay/abc');
    expect(platform.start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://mercury.phonepe.com/pay/abc',
    '//attacker.example/pay/abc',
  ])('does not navigate to unsafe checkout URL %s', (url) => {
    expect(redirectToCheckout(url)).toMatchObject({ ok: false });
  });

  test.each([
    Object.assign(new Error('provider unavailable'), { code: 'DEPENDENCY_UNAVAILABLE' }),
    new TypeError('network failure'),
  ])('does not fall back after an ambiguous mobile failure', async (failure) => {
    const beginPayment = vi.fn().mockRejectedValue(failure);
    await expect(executeOrderCheckout({
      orderId: 'order-1',
      beginPayment,
      platform: { resolveChannel: async () => 'phonepe_mobile_sdk', start: vi.fn() },
      navigate: vi.fn(),
      redirect: vi.fn(),
      persistPendingPayment: vi.fn(),
    })).rejects.toBe(failure);
    expect(beginPayment).toHaveBeenCalledTimes(1);
  });

  test('rejects a channel-mismatched response before opening any checkout', async () => {
    const persistPendingPayment = vi.fn();
    const platform = {
      resolveChannel: vi.fn().mockResolvedValue('phonepe_mobile_sdk'),
      start: vi.fn(),
    };
    await expect(executeOrderCheckout({
      orderId: 'order-1',
      beginPayment: vi.fn().mockResolvedValue(sdkCheckout),
      platform,
      navigate: vi.fn(),
      redirect: vi.fn(),
      persistPendingPayment,
    })).rejects.toThrow("Couldn't start the payment. Try again.");
    expect(platform.start).not.toHaveBeenCalled();
    expect(persistPendingPayment).not.toHaveBeenCalled();
  });
});
