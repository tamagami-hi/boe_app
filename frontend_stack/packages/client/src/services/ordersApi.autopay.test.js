import { describe, expect, test } from 'vitest';
import { mapAutoPayDetail } from './ordersApi.js';

const detail = (status, mandateStatus, extra = {}) => ({
  sipPlanId: 'sip-1',
  fundId: 'fund-1',
  amountPaise: '100000',
  debitDay: 5,
  durationMonths: 12,
  status,
  mandate: {
    mandateId: 'mandate-1',
    status: mandateStatus,
    authorizedAt: null,
    cancellationRequestedAt: null,
  },
  ...extra,
});

describe('AutoPay detail contract', () => {
  test.each([
    ['setup_failed', 'failed'],
    ['mandate_failed', 'failed'],
  ])('accepts canonical terminal pair %s/%s', (sipState, mandateState) => {
    expect(mapAutoPayDetail(detail(sipState, mandateState))).toMatchObject({
      status: sipState,
      mandate: { status: mandateState },
      canRetrySetup: false,
      latestSetupState: null,
    });
  });

  test.each([
    ['failed', 'failed'],
    ['setup_failed', 'mandate_failed'],
    ['completed', 'completed'],
  ])('rejects noncanonical state pair %s/%s', (sipState, mandateState) => {
    expect(() => mapAutoPayDetail(detail(sipState, mandateState))).toThrow(/Couldn't load this AutoPay SIP/);
  });

  test('uses only an explicit backend retry decision', () => {
    expect(mapAutoPayDetail(detail('pending_mandate', 'setup_pending')).canRetrySetup).toBe(false);
    expect(mapAutoPayDetail(detail('pending_mandate', 'setup_pending', {
      latestSetupState: 'failed',
      canRetrySetup: true,
    }))).toMatchObject({ latestSetupState: 'failed', canRetrySetup: true });
  });
});
