import { describe, expect, test, vi } from 'vitest';
import { executeOrderCheckout } from './checkoutOrchestrator.js';
import { mapPaymentCheckout } from '../services/ordersApi.js';

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

  test('falls back once to hosted checkout only when mobile checkout is disabled', async () => {
    const disabled = Object.assign(new Error('safe'), { code: 'MOBILE_CHECKOUT_DISABLED' });
    const beginPayment = vi.fn()
      .mockRejectedValueOnce(disabled)
      .mockResolvedValueOnce({
        paymentId: 'payment-2',
        checkout: { type: 'redirect', url: 'https://mercury-uat.phonepe.com/pay/abc' },
      });
    const redirect = vi.fn().mockReturnValue({ ok: true });
    const platform = {
      resolveChannel: vi.fn().mockResolvedValue('phonepe_mobile_sdk'),
      start: vi.fn(),
    };
    await expect(executeOrderCheckout({
      orderId: 'order-1', beginPayment, platform, navigate: vi.fn(), redirect, persistPendingPayment: vi.fn(),
    })).resolves.toEqual({ leaving: true, paymentId: 'payment-2' });
    expect(beginPayment.mock.calls).toEqual([
      ['order-1', { checkoutChannel: 'phonepe_mobile_sdk' }],
      ['order-1', { checkoutChannel: 'hosted_redirect' }],
    ]);
    expect(platform.start).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledTimes(1);
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

  test.each(['SUCCESS', 'FAILURE', 'INTERRUPTED'])(
    'SDK result %s only returns the user to authoritative payment status',
    async (sdkStatus) => {
      const navigate = vi.fn();
      const persistPendingPayment = vi.fn();
      const beginPayment = vi.fn().mockResolvedValue(sdkCheckout);
      const platform = {
        resolveChannel: vi.fn().mockResolvedValue('phonepe_mobile_sdk'),
        start: vi.fn().mockResolvedValue({ status: sdkStatus }),
      };
      await executeOrderCheckout({
        orderId: 'order-1',
        beginPayment,
        platform,
        navigate,
        redirect: vi.fn(),
        persistPendingPayment,
      });
      expect(beginPayment).toHaveBeenCalledWith('order-1', { checkoutChannel: 'phonepe_mobile_sdk' });
      expect(beginPayment).toHaveBeenCalledTimes(1);
      expect(persistPendingPayment).toHaveBeenCalledWith('payment-1');
      expect(navigate).toHaveBeenCalledWith('/app/payment/payment-1', { replace: true });
    },
  );

  test('rejects a channel-mismatched response before opening any checkout', async () => {
    const persistPendingPayment = vi.fn();
    const platform = {
      resolveChannel: vi.fn().mockResolvedValue('phonepe_mobile_sdk'),
      start: vi.fn(),
    };
    await expect(executeOrderCheckout({
      orderId: 'order-1',
      beginPayment: vi.fn().mockResolvedValue({
        ...sdkCheckout,
        checkout: { type: 'redirect', url: 'https://example.test' },
      }),
      platform,
      navigate: vi.fn(),
      redirect: vi.fn(),
      persistPendingPayment,
    })).rejects.toThrow("Couldn't start the payment. Try again.");
    expect(platform.start).not.toHaveBeenCalled();
    expect(persistPendingPayment).not.toHaveBeenCalled();
  });
});
