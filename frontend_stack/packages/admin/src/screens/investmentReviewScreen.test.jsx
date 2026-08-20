// The private review queue (spec §9.3, §11.1). Locks the decisions an operator can
// reach: the selected fund is read-only (no selector anywhere), accept is gated on
// the bank-evidence attestation, every mutation carries expectedVersion and an
// Idempotency-Key, and a 409 refreshes instead of retrying blindly.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InvestmentReviewScreen, {
  AcceptedReviews,
  AwaitingReview,
  RefundExceptions,
} from './InvestmentReviewScreen.jsx';

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
}));

const reviewsState = {};
const refundsState = {};
const invalidateReviews = vi.fn();
vi.mock('../data/adminResources.js', () => ({
  useAdminInvestmentReviews: (state) => reviewsState[state],
  useAdminRefunds: (state) => refundsState[state],
  useAdminCacheActions: () => ({ invalidateReviews }),
}));

let mockUser = { id: 'a1', permissions: ['investments.review.write', 'refunds.write'] };
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
  review: { state: 'pending', version: 3 },
};

beforeEach(() => {
  request.mockReset().mockResolvedValue({});
  invalidateReviews.mockReset();
  mockUser = { id: 'a1', permissions: ['investments.review.write', 'refunds.write'] };
  reviewsState.pending = { ...idle };
  reviewsState.accepted = { ...idle };
  refundsState.refund_failed = { ...idle };
  refundsState.all = { ...idle };
});

function renderAt(ui, path = '/admin/reviews/awaiting') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('the tab shell', () => {
  test('tabs are route links and the active one is marked', () => {
    renderAt(<InvestmentReviewScreen tab="awaiting" />);
    const awaiting = screen.getByRole('link', { name: 'Awaiting review' });
    expect(awaiting).toHaveAttribute('href', '/admin/reviews/awaiting');
    expect(awaiting).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Refunds and exceptions' }))
      .toHaveAttribute('href', '/admin/reviews/refunds');
  });
});

describe('AwaitingReview', () => {
  test('the pending queue shows client, amount, selected fund and PhonePe evidence', () => {
    reviewsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReview />);
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByText(/25,000/u)).toBeTruthy();
    expect(screen.getByText('Edge Growth')).toBeTruthy();
    expect(screen.getByText('pay_PP123')).toBeTruthy();
    expect(screen.getByText('MO-1001')).toBeTruthy();
  });

  test('an empty queue says so instead of showing skeletons forever', () => {
    renderAt(<AwaitingReview />);
    expect(screen.getByText(/No payments are waiting for review/u)).toBeTruthy();
  });

  test('the review panel shows the selected fund read-only — there is no fund selector', () => {
    reviewsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReview />);
    const toggle = screen.getByRole('button', { name: 'Review' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    expect(panel.textContent).toContain('Edge Growth');
    expect(panel.textContent).toContain('version v3');
    // The allocation target was chosen by the client at order time; changing it
    // here is not a power this screen has.
    expect(panel.querySelector('select')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('accept is impossible until the bank evidence is confirmed', () => {
    reviewsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const accept = screen.getByRole('button', { name: /Accept and allocate/u });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(accept).not.toBeDisabled();
  });

  test('accept sends the attestation, the expected version and an Idempotency-Key', async () => {
    reviewsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText(/Private note/u), { target: { value: 'Bank credit seen' } });
    fireEvent.click(screen.getByRole('button', { name: /Accept and allocate/u }));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    const [path, options] = request.mock.calls[0];
    expect(path).toBe('/v1/admin/investment-reviews/ord_1/accept');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ bankVerified: true, expectedVersion: '3', privateNote: 'Bank credit seen' });
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    expect(invalidateReviews).toHaveBeenCalled();
  });

  test('reject without a reason code never reaches the route', () => {
    reviewsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: /Reject and refund/u }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('reason code');
  });

  test('reject sends the reason code and starts the refund', async () => {
    reviewsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.change(screen.getByLabelText(/Rejection reason code/u), { target: { value: 'bank_mismatch' } });
    fireEvent.click(screen.getByRole('button', { name: /Reject and refund/u }));
    await Promise.resolve();
    const [path, options] = request.mock.calls[0];
    expect(path).toBe('/v1/admin/investment-reviews/ord_1/reject');
    expect(options.body).toEqual({ reasonCode: 'bank_mismatch', expectedVersion: '3' });
    expect(options.headers['Idempotency-Key']).toBeTruthy();
  });

  test('a 409 closes the panel, refreshes the queue and says why — no blind retry', async () => {
    const conflict = new Error('Conflict');
    conflict.status = 409;
    request.mockRejectedValue(conflict);
    reviewsState.pending = { ...idle, rows: [PENDING] };
    renderAt(<AwaitingReview />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Accept and allocate/u }));
    const notice = await screen.findByText(/changed since you opened it/u);
    expect(notice.closest('[role="status"]')).toBeTruthy();
    // The panel is closed — the operator re-opens the item against fresh data.
    expect(screen.queryByRole('button', { name: /Accept and allocate/u })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(invalidateReviews).toHaveBeenCalled();
  });
});

describe('AcceptedReviews', () => {
  test('the accepted record is read-only — nothing to decide, no buttons', () => {
    reviewsState.accepted = {
      ...idle,
      rows: [{ ...PENDING, review: { state: 'accepted', version: 4, reviewedAt: '2026-08-02T09:00:00.000Z' } }],
    };
    renderAt(<AcceptedReviews />);
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
    state: 'refund_failed',
    failureCode: 'provider_rejected',
    attemptCount: 3,
    merchantRefundId: 'MR-ord_1',
    providerRefundId: null,
    createdAt: '2026-08-03T10:00:00.000Z',
  };

  test('the default view is the exception queue', () => {
    refundsState.refund_failed = { ...idle, rows: [REFUND] };
    renderAt(<RefundExceptions />);
    expect(screen.getByLabelText('Refund status')).toHaveValue('refund_failed');
    expect(screen.getByText('MR-ord_1')).toBeTruthy();
    expect(screen.getByText('provider_rejected')).toBeTruthy();
  });

  test('retry and reconcile POST with an Idempotency-Key', async () => {
    refundsState.refund_failed = { ...idle, rows: [REFUND] };
    renderAt(<RefundExceptions />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // Wait for the action to settle — the lock is held until it does.
    await screen.findByText(/Refund retry dispatched/u);
    let [path, options] = request.mock.calls[0];
    expect(path).toBe('/v1/admin/refunds/rfnd_1/retry');
    expect(options.method).toBe('POST');
    expect(options.headers['Idempotency-Key']).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    await screen.findByText(/Reconciliation requested/u);
    [path, options] = request.mock.calls[1];
    expect(path).toBe('/v1/admin/refunds/rfnd_1/reconcile');
    expect(invalidateReviews).toHaveBeenCalled();
  });

  test('the actions are hidden without refunds.write', () => {
    mockUser = { id: 'a2', permissions: ['investments.review.read'] };
    refundsState.refund_failed = { ...idle, rows: [REFUND] };
    renderAt(<RefundExceptions />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconcile' })).toBeNull();
  });
});
