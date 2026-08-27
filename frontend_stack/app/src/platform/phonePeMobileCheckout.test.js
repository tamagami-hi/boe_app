import { describe, expect, test, vi } from 'vitest';
import { createPhonePeMobileCheckout } from './phonePeMobileCheckout.js';

const checkout = {
  type: 'phonepe_sdk',
  providerOrderId: 'provider-order-1',
  token: 'sdk-token',
  merchantId: 'merchant-1',
  environment: 'SANDBOX',
  expiresAt: '2026-08-24T12:02:00.000Z',
};

function fixture(overrides = {}) {
  const init = vi.fn().mockResolvedValue({ status: true });
  const startTransaction = vi.fn().mockResolvedValue({ status: 'SUCCESS' });
  const platform = createPhonePeMobileCheckout({
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
    loadPlugin: async () => ({ init, startTransaction }),
    generateFlowId: () => 'sdk-flow-123',
    now: () => new Date('2026-08-24T12:00:00.000Z').getTime(),
    ...overrides,
  });
  return { platform, init, startTransaction };
}

describe('PhonePe mobile checkout boundary', () => {
  test('fails closed before SDK init for an unknown environment', async () => {
    const { platform, init } = fixture();
    await expect(platform.start({ checkout: { ...checkout, environment: 'STAGING' }, paymentId: 'pay-1' }))
      .rejects.toThrow('Mobile checkout configuration is unavailable.');
    expect(init).not.toHaveBeenCalled();
  });

  test('fails closed before SDK init when checkout material has expired', async () => {
    const { platform, init } = fixture();
    await expect(platform.start({
      checkout: { ...checkout, expiresAt: '2026-08-24T12:00:01.000Z' },
      paymentId: 'pay-1',
    })).rejects.toThrow('Mobile checkout configuration is unavailable.');
    expect(init).not.toHaveBeenCalled();
  });

  test('passes the exact SDK contract with production logging disabled', async () => {
    const { platform, init, startTransaction } = fixture();
    await expect(platform.start({ checkout, paymentId: 'pay-123' })).resolves.toEqual({ status: 'returned' });
    expect(init).toHaveBeenCalledWith({
      environment: 'SANDBOX',
      merchantId: 'merchant-1',
      flowId: 'sdkflow123',
      enableLogging: false,
    });
    expect(startTransaction).toHaveBeenCalledWith({
      request: JSON.stringify({
        orderId: 'provider-order-1',
        merchantId: 'merchant-1',
        token: 'sdk-token',
        paymentMode: { type: 'PAY_PAGE' },
      }),
      showLoaderFlag: true,
      appSchema: null,
    });
  });

  test.each(['SUCCESS', 'FAILURE', 'INTERRUPTED', 'UNKNOWN'])(
    'normalizes SDK status %s without asserting payment completion',
    async (status) => {
      const { platform, startTransaction } = fixture();
      startTransaction.mockResolvedValue({ status });
      await expect(platform.start({ checkout, paymentId: 'pay-1' })).resolves.toEqual({
        status: status === 'UNKNOWN' ? 'unavailable' : 'returned',
      });
    },
  );

  test('does not expose native provider errors', async () => {
    const { platform, startTransaction } = fixture();
    startTransaction.mockRejectedValue(new Error('sdk-token leaked by provider'));
    await expect(platform.start({ checkout, paymentId: 'pay-1' }))
      .rejects.toThrow('Mobile checkout is unavailable. Check your payment status and try again if needed.');
  });
});
