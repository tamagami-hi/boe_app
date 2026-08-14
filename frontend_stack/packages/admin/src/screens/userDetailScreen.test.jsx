// The per-user record. Its defects were the same family as the registers: money read
// from fields the projection does not send (so every figure was ₹0), five sections fed
// from a hardcoded empty array (so every user "had no redemptions, tickets or
// notifications"), and a tab strip that a keyboard could enter but not move within.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import UserDetailScreen from './UserDetailScreen.jsx';

const detail = {
  user: {
    id: 'u1',
    name: 'Asha Rao',
    email: 'asha@example.com',
    phone: '+919876543210',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    activatedAt: '2026-07-02T00:00:00.000Z',
  },
  roles: [],
  kyc: { status: 'approved' },
  orders: [{
    id: 'ord_1',
    fundName: 'Edge Growth',
    type: 'sip_installment',
    status: 'booked',
    amountPaise: '500000',
    requestedAt: '2026-08-01T00:00:00.000Z',
    bookedAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
  }],
  payments: [{
    id: 'pay_1',
    amountPaise: '500000',
    status: 'succeeded',
    provider: 'razorpay',
    providerReference: 'pay_RZP1',
    attemptCount: 1,
    succeededAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
  }],
  mandates: [{
    id: 'mnd_1',
    providerMandateId: 'rzp_m1',
    maxAmountPaise: '1000000',
    debitDay: 5,
    status: 'active',
    validFrom: '2026-07-05T00:00:00.000Z',
    validTo: null,
  }],
  sips: [{
    id: 'sip_1',
    fundSlug: 'edge-growth',
    amountPaise: '500000',
    debitDay: 5,
    status: 'active',
    nextDueDate: '2026-09-05',
    installments: 2,
  }],
  positions: [],
  portfolio: {
    poolCount: 1,
    totalInvestmentPaise: '1000000',
    currentValuePaise: '1100000',
    totalReturnPaise: '100000',
    returnPercent: 10,
    allocatedGainPaise: '100000',
    sipInstallmentCount: 2,
    lumpSumCount: 0,
  },
};

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
}));

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue(detail);
});

async function open(tab) {
  render(<UserDetailScreen userId="u1" />);
  await screen.findByRole('tablist');
  if (tab) fireEvent.click(screen.getByRole('tab', { name: new RegExp(tab, 'u') }));
}

// Every panel stays mounted and `hidden`, so assertions scope to one panel.
const panel = (id) => document.getElementById(`user-detail-tabpanel-${id}`);
const textIn = (id) => panel(id).textContent;

describe('money on the user record', () => {
  test('a payment shows its real amount, not ₹0', async () => {
    await open('Payments');
    expect(textIn('payments')).toContain('₹5,000');
    expect(textIn('payments')).not.toContain('₹0');
  });

  test('a mandate shows the authorised maximum and its debit day', async () => {
    await open('Payments');
    expect(textIn('payments')).toContain('₹10,000');
    expect(textIn('payments')).toContain('rzp_m1');
  });

  test('a SIP plan shows its installment amount', async () => {
    await open('Investments');
    expect(textIn('investments')).toContain('edge-growth');
    expect(textIn('investments')).toContain('₹5,000');
  });

  // The payload carried orders all along and nothing rendered them.
  test('order activity is on screen', async () => {
    await open('Investments');
    expect(screen.getByText('Order activity')).toBeTruthy();
    expect(textIn('investments')).toContain('Edge Growth');
    expect(textIn('investments')).toContain('Sip installment');
  });
});

describe('sections with no data source', () => {
  test('the phantom tables and the tab that held them are gone', async () => {
    await open();
    expect(screen.queryByRole('tab', { name: /Support/u })).toBeNull();
    for (const gone of [
      /No redemption requests/u,
      /No SIP control requests/u,
      /No support tickets/u,
      /No notifications/u,
      /No audit logs/u,
    ]) expect(screen.queryByText(gone)).toBeNull();
  });

  test('three tabs, each with a panel', async () => {
    await open();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(document.getElementById(tab.getAttribute('aria-controls'))).toBeTruthy();
    }
  });
});

describe('blocking reasons', () => {
  test('a user with no KYC case is not reported as clear', async () => {
    request.mockResolvedValue({ ...detail, kyc: null });
    await open();
    expect(screen.getByText(/No KYC case on record/u)).toBeTruthy();
    expect(screen.queryByText('No blocking reasons')).toBeNull();
  });

  test('a suspended account is a blocking reason', async () => {
    request.mockResolvedValue({ ...detail, user: { ...detail.user, status: 'suspended' } });
    await open();
    expect(screen.getByText(/Account is suspended/u)).toBeTruthy();
  });

  test('an approved, active user is clear', async () => {
    await open();
    expect(screen.getByText('No blocking reasons')).toBeTruthy();
  });
});

describe('keyboard and failure handling', () => {
  // Inactive tabs carry tabIndex -1, so without arrow handling a keyboard user could
  // reach the strip and never leave the tab they landed on.
  test('arrow keys move between tabs', async () => {
    await open();
    const first = screen.getByRole('tab', { name: /Overview/u });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = screen.getByRole('tab', { name: /Investments/u });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'End' });
    expect(screen.getByRole('tab', { name: /Payments/u }).getAttribute('aria-selected')).toBe('true');
  });

  test('a failed read is announced and offers a retry', async () => {
    request.mockRejectedValue(new Error('Network request failed'));
    render(<UserDetailScreen userId="u1" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Network request failed');
    request.mockResolvedValue(detail);
    fireEvent.click(screen.getByRole('button', { name: /Try again/u }));
    expect(await screen.findByRole('tablist')).toBeTruthy();
  });
});
