import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FundReceiptScreen, {
  AcknowledgedReceipts,
  AwaitingReceipts,
  RefundExceptions,
} from './FundReceiptScreen.jsx';

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
}));

const receiptsState = {};
const refundsState = {};
const invalidateFundReceipts = vi.fn();
const invalidateRefunds = vi.fn();
vi.mock('../data/adminResources.js', () => ({
  useAdminFundReceipts: (state) => receiptsState[state],
  useAdminRefunds: (state) => refundsState[state],
  useAdminCacheActions: () => ({ invalidateFundReceipts, invalidateRefunds }),
}));

let mockUser = { id: 'a1', permissions: ['funds.receipts.write', 'refunds.write'] };
vi.mock('@beonedge/client/store/AdminSessionContext.jsx', () => ({
  useAdminSession: () => ({ user: mockUser }),
}));

vi.mock('../data/AdminReadError.jsx', () => ({ default: () => null }));

const idle = { rows: [], isLoading: false, error: null };

const PENDING = {
  orderId: 'ord_1',
  client: { id: 'u1', name: 'Asha Rao', email: 'asha@example.com' },
  amountPaise: '2500000',
  currency: 'INR',
  selectedFund: { id: 'f1', name: 'Edge Growth', versionId: 'v3' },
  payment: {
    id: 'pay_1',
    state: 'succeeded',
    provider: 'phonepe',
    merchantOrderId: 'MO-1001',
    providerReference: 'pay_PP123',
    succeededAt: '2026-08-01T10:00:00.000Z',
  },
  acknowledgement: { state: 'pending', version: 3 },
};

beforeEach(() => {
  request.mockReset().mockResolvedValue({});
  invalidateFundReceipts.mockReset();
  invalidateRefunds.mockReset();
  mockUser = { id: 'a1', permissions: ['funds.receipts.write', 'refunds.write'] };
  receiptsState.pending = { ...idle };
  receiptsState.acknowledged = { ...idle };
  refundsState.failed = { ...idle };
  refundsState.all = { ...idle };
});

function renderAt(ui, path = '/admin/funds-received/awaiting') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('the tab shell', () => {
  test('tabs are route links and the active one is marked', () => {
    renderAt(<FundReceiptScreen tab="awaiting" />);
    const awaiting = screen.getByRole('link', { name: 'Awaiting acknowledgement' });
    expect(awaiting).toHaveAttribute('href', '/admin/funds-received/awaiting');
    expect(awaiting).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Refunds and exceptions' }))
      .toHaveAttribute('href', '/admin/funds-received/refunds');
  });
});

describe('AwaitingReceipts', () => {
  test('the pending queue shows client, amount, selected fund and PhonePe evidence', () => {
    receiptsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReceipts />);
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText(/25,000/u)).toBeTruthy();
    expect(screen.getByText('Edge Growth')).toBeTruthy();
    expect(screen.getByText('pay_PP123')).toBeTruthy();
    expect(screen.getByText('MO-1001')).toBeTruthy();
  });

  test('an empty queue says so instead of showing skeletons forever', () => {
    renderAt(<AwaitingReceipts />);
    expect(screen.getByText(/No funds are waiting for acknowledgement/u)).toBeTruthy();
  });

  test('the receipt panel shows the selected fund read-only — there is no fund selector', () => {
    receiptsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReceipts />);
    const toggle = screen.getByRole('button', { name: 'View funds' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    expect(panel.textContent).toContain('Edge Growth');
    expect(panel.textContent).toContain('version v3');
    expect(panel.querySelector('select')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('acknowledge sends the expected version and an Idempotency-Key', async () => {
    receiptsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReceipts />);
    fireEvent.click(screen.getByRole('button', { name: 'View funds' }));
    fireEvent.change(screen.getByLabelText(/Private note/u), { target: { value: 'Bank credit seen' } });
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/u }));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    const [path, options] = request.mock.calls[0];
    expect(path).toBe('/v1/admin/fund-receipts/ord_1/acknowledge');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ expectedVersion: '3', privateNote: 'Bank credit seen' });
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    expect(invalidateFundReceipts).toHaveBeenCalled();
  });

  test('a 409 closes the panel, refreshes the queue and says why — no blind retry', async () => {
    const conflict = new Error('Conflict');
    conflict.status = 409;
    request.mockRejectedValue(conflict);
    receiptsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReceipts />);
    fireEvent.click(screen.getByRole('button', { name: 'View funds' }));
    fireEvent.click(screen.getByRole('button', { name: /Acknowledge/u }));
    const notice = await screen.findByText(/changed since you opened it/u);
    expect(notice.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Acknowledge/u })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(invalidateFundReceipts).toHaveBeenCalled();
  });

  test('read-only users can inspect a receipt without seeing acknowledgement controls', () => {
    mockUser = { id: 'a2', permissions: ['funds.receipts.read'] };
    receiptsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReceipts />);
    fireEvent.click(screen.getByRole('button', { name: 'View funds' }));
    expect(screen.getAllByText('Edge Growth')).toHaveLength(2);
    expect(screen.queryByLabelText(/Private note/u)).toBeNull();
    expect(screen.queryByRole('button', { name: /Acknowledge/u })).toBeNull();
  });
});

describe('AcknowledgedReceipts', () => {
  test('the acknowledged record is read-only', () => {
    receiptsState.acknowledged = {
      ...idle,
      rows: [{ ...PENDING, acknowledgement: { state: 'acknowledged', version: 4, acknowledgedAt: '2026-08-02T09:00:00.000Z' } }],
    };
    renderAt(<AcknowledgedReceipts />);
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText('ord_1')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('RefundExceptions', () => {
  const REFUND = {
    id: 'rfnd_1',
    orderId: 'ord_1',
    amountPaise: '2500000',
    state: 'failed',
    failureCode: 'provider_rejected',
    attemptCount: 3,
    merchantRefundId: 'MR-ord_1',
    providerRefundId: null,
    createdAt: '2026-08-03T10:00:00.000Z',
  };

  test('the default view is the exception queue', () => {
    refundsState.failed = { ...idle, rows: [REFUND] };
    renderAt(<RefundExceptions />);
    expect(screen.getByLabelText('Refund status')).toHaveValue('failed');
    expect(screen.getByText('MR-ord_1')).toBeTruthy();
    expect(screen.getByText('provider_rejected')).toBeTruthy();
  });

  test('retry and reconcile POST with an Idempotency-Key', async () => {
    refundsState.failed = { ...idle, rows: [REFUND] };
    renderAt(<RefundExceptions />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(/Refund retry dispatched/u);
    let [path, options] = request.mock.calls[0];
    expect(path).toBe('/v1/admin/refunds/rfnd_1/retry');
    expect(options.method).toBe('POST');
    expect(options.headers['Idempotency-Key']).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    await screen.findByText(/Reconciliation requested/u);
    [path, options] = request.mock.calls[1];
    expect(path).toBe('/v1/admin/refunds/rfnd_1/reconcile');
    expect(invalidateRefunds).toHaveBeenCalled();
  });

  test('the actions are hidden without refunds.write', () => {
    mockUser = { id: 'a2', permissions: ['funds.receipts.read'] };
    refundsState.failed = { ...idle, rows: [REFUND] };
    renderAt(<RefundExceptions />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconcile' })).toBeNull();
  });
});
