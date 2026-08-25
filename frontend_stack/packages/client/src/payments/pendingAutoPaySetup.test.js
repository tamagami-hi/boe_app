import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  beginPendingAutoPaySetup,
  completePendingAutoPaySetup,
  readPendingAutoPaySetup,
} from './pendingAutoPaySetup.js';

describe('pending AutoPay setup recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  test('stores only the owner, request key, input fingerprint and expiry before create', () => {
    beginPendingAutoPaySetup({
      ownerId: 'user-1',
      requestKey: 'sip-request-1',
      inputFingerprint: 'fund-1|100000|5|12',
    });
    const stored = JSON.parse(localStorage.getItem('boe.pendingAutoPaySetup'));
    expect(Object.keys(stored).sort()).toEqual(['expiresAt', 'inputFingerprint', 'ownerId', 'requestKey']);
    expect(JSON.stringify(stored)).not.toMatch(/token|provider|order/i);
  });

  test('adds only the canonical SIP id after create and clears on owner mismatch', () => {
    beginPendingAutoPaySetup({
      ownerId: 'user-1',
      requestKey: 'sip-request-1',
      inputFingerprint: 'fund-1|100000|5|12',
    });
    completePendingAutoPaySetup({ ownerId: 'user-1', requestKey: 'sip-request-1', sipPlanId: 'sip-1' });
    expect(readPendingAutoPaySetup('user-1')).toMatchObject({ sipPlanId: 'sip-1' });
    expect(readPendingAutoPaySetup('user-2')).toBeNull();
    expect(localStorage.getItem('boe.pendingAutoPaySetup')).toBeNull();
  });

  test('expires the pointer rather than reusing a stale request key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T10:00:00Z'));
    beginPendingAutoPaySetup({
      ownerId: 'user-1',
      requestKey: 'sip-request-1',
      inputFingerprint: 'fund-1|100000|5|12',
    });
    vi.setSystemTime(new Date('2026-08-24T10:31:00Z'));
    expect(readPendingAutoPaySetup('user-1')).toBeNull();
    expect(localStorage.getItem('boe.pendingAutoPaySetup')).toBeNull();
  });
});
