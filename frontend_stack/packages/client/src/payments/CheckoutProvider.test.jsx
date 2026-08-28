import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { persistPendingPayment } from './pendingPayment.js';
import { beginPendingAutoPaySetup, completePendingAutoPaySetup } from './pendingAutoPaySetup.js';

let sessionValue;

vi.mock('../store/SessionContext.jsx', () => ({ useSession: () => sessionValue }));

const { PendingPaymentRecovery, createHostedCheckoutPlatform } = await import('./CheckoutProvider.jsx');

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe('PendingPaymentRecovery session handling', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionValue = {
      status: 'anonymous',
      user: null,
      error: Object.assign(new Error('backend timeout'), { code: 'REQUEST_TIMEOUT' }),
      endedReason: null,
    };
  });

  test('preserves the owner-bound pointer after a transient restore failure', async () => {
    persistPendingPayment('pay-1', 'user-1');
    beginPendingAutoPaySetup({
      ownerId: 'user-1',
      requestKey: 'sip-request-1',
      inputFingerprint: 'fund-1|100000|5|12',
    });
    const stored = localStorage.getItem('boe.pendingPayment');
    const storedAutoPay = localStorage.getItem('boe.pendingAutoPaySetup');
    render(
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <PendingPaymentRecovery />
      </MemoryRouter>,
    );
    await waitFor(() => expect(localStorage.getItem('boe.pendingPayment')).toBe(stored));
    expect(localStorage.getItem('boe.pendingAutoPaySetup')).toBe(storedAutoPay);
  });

  test('recovers the canonical SIP detail for the authenticated owner after process restart', async () => {
    beginPendingAutoPaySetup({
      ownerId: 'user-1',
      requestKey: 'sip-request-1',
      inputFingerprint: 'fund-1|100000|5|12',
    });
    completePendingAutoPaySetup({ ownerId: 'user-1', requestKey: 'sip-request-1', sipPlanId: 'sip-1' });
    sessionValue = {
      status: 'authenticated',
      user: { id: 'user-1' },
      error: null,
      endedReason: null,
    };
    render(
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <PendingPaymentRecovery />
        <Routes><Route path="*" element={<LocationProbe />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app/mandates/sip-1'));
    expect(localStorage.getItem('boe.pendingAutoPaySetup')).toBeNull();
  });
});

describe('hosted checkout platform', () => {
  test('opens a trusted redirect result and reports that the page is leaving', async () => {
    const redirect = vi.fn().mockReturnValue({ ok: true });
    const platform = createHostedCheckoutPlatform(redirect);

    await expect(platform.start({
      checkout: { type: 'redirect', url: 'https://mercury.phonepe.com/pay/setup' },
    })).resolves.toEqual({ status: 'leaving' });
    expect(await platform.resolveChannel()).toBe('hosted_redirect');
    expect(redirect).toHaveBeenCalledWith('https://mercury.phonepe.com/pay/setup');
  });

  test('fails closed for a rejected URL or a non-redirect contract', async () => {
    const platform = createHostedCheckoutPlatform(() => ({ ok: false }));

    await expect(platform.start({ checkout: { type: 'redirect', url: 'https://attacker.example' } }))
      .rejects.toThrow("Couldn't start the payment. Try again.");
    await expect(platform.start({ checkout: { type: 'unknown' } }))
      .rejects.toThrow("Couldn't start the payment. Try again.");
  });
});
