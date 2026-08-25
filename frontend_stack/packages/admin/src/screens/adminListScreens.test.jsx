// Admin list/action screens. The defects these cover: the payment register showed
// ₹0 for every payment because it was wired to a legacy mock row shape; a load in
// progress and a failed read both rendered as "there is nothing here"; and the
// irreversible approve/reject decision was a small button in a dense row.
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  fmtPaise,
  normalizeAdminCollection,
  paiseToRupees,
} from '../helpers/formatters.js';
import ApprovalsScreen from './ApprovalsScreen.jsx';
import PaymentsScreen from './PaymentsScreen.jsx';
import UserDetailsListScreen from './UserDetailsListScreen.jsx';

// The directory paginates through useAdminList; these tests drive its result.
const listState = {
  items: [], loading: false, error: '', hasMore: false, loadMore: vi.fn(), reload: vi.fn(),
};
vi.mock('../hooks/useAdminList.js', () => ({
  default: () => listState,
}));

function setList(next) {
  Object.assign(listState, {
    items: [], loading: false, error: '', hasMore: false, loadMore: vi.fn(), reload: vi.fn(),
  }, next);
}

const PAYMENT = {
  id: 'pay_1',
  orderId: 'ord_1',
  userId: 'u1',
  userEmail: 'asha@example.com',
  amountPaise: '2500000',
  currency: 'INR',
  status: 'succeeded',
  attemptCount: 2,
  provider: 'phonepe',
  providerReference: 'pay_PP123',
  succeededAt: '2026-08-01T10:00:00.000Z',
  failedAt: null,
  createdAt: '2026-08-01T09:59:00.000Z',
};

const payments = (overrides = {}) => normalizeAdminCollection([{ ...PAYMENT, ...overrides }], '/v1/admin/payments');

describe('canonical row shapes', () => {
  test('paise become rupees, and a missing amount stays missing', () => {
    expect(paiseToRupees('2500000')).toBe(25000);
    expect(paiseToRupees(null)).toBeNull();
    expect(paiseToRupees(undefined)).toBeNull();
  });

  // The screens rendered `formatMoney(row.amount)` against a payload that has no
  // `amount`, and Intl turned undefined into ₹0 — a definite statement about money
  // that was never sent.
  test('an unknown amount renders as an em dash, never as zero', () => {
    expect(fmtPaise(null)).toBe('—');
    expect(fmtPaise(undefined)).toBe('—');
    expect(fmtPaise('0')).toBe('₹0.00');
    expect(fmtPaise('2500000')).toBe('₹25,000.00');
  });

  test('a payment row exposes amount and settlement time from the canonical fields', () => {
    const [row] = payments();
    expect(row.amount).toBe(25000);
    expect(row.settledAt).toBe(PAYMENT.succeededAt);
    expect(row.providerReference).toBe('pay_PP123');
  });

  test('a failed payment settles at its failure time', () => {
    const [row] = payments({ status: 'failed', succeededAt: null, failedAt: '2026-08-02T00:00:00.000Z' });
    expect(row.settledAt).toBe('2026-08-02T00:00:00.000Z');
  });
});

describe('PaymentsScreen', () => {
  test('shows the real amount rather than a fabricated zero', () => {
    render(<PaymentsScreen rows={payments()} />);
    expect(screen.getByText(/25,000/u)).toBeTruthy();
    expect(screen.queryByText('₹0')).toBeNull();
  });

  test('the status filter offers only states the backend can be in', () => {
    render(<PaymentsScreen rows={payments()} />);
    const select = screen.getByLabelText('Payment status');
    const values = Array.from(select.querySelectorAll('option')).map((option) => option.value);
    expect(values).toEqual([
      '', 'created', 'provider_pending', 'succeeded', 'failed', 'expired',
      'refund_pending', 'refunded', 'refund_failed',
    ]);
    // The old list offered success/confirmed/reconciled/approved/rejected/pending —
    // none of which any payment is ever in, so choosing one emptied the table.
    expect(values).not.toContain('success');
    expect(values).not.toContain('reconciled');
  });

  test('the settled tile counts succeeded payments', () => {
    const { container } = render(<PaymentsScreen rows={payments()} />);
    const tile = Array.from(container.querySelectorAll('.adm-stat'))
      .find((node) => node.textContent.startsWith('Succeeded'));
    expect(tile.querySelector('.adm-stat-value').textContent).toBe('1');
  });

  test('search matches the provider reference', () => {
    render(<PaymentsScreen rows={payments()} />);
    fireEvent.change(screen.getByLabelText('Search payments'), { target: { value: 'PP123' } });
    expect(screen.getByText('pay_1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search payments'), { target: { value: 'nothing' } });
    expect(screen.getByText(/match the selected filters/u)).toBeTruthy();
  });

  test('a load in progress does not claim there are no payments', () => {
    render(<PaymentsScreen rows={[]} loading />);
    expect(screen.queryByText(/No payments have been recorded/u)).toBeNull();
  });

  test('an empty result still reads as empty once loaded', () => {
    render(<PaymentsScreen rows={[]} loading={false} />);
    expect(screen.getByText(/No payments have been recorded/u)).toBeTruthy();
  });

  test('no fund pool column or filter, because payments carry no fund', () => {
    render(<PaymentsScreen rows={payments()} />);
    expect(screen.queryByText(/Unmapped fund/u)).toBeNull();
    expect(screen.queryByText('All fund pools')).toBeNull();
  });

  test('every button declares its type and the row action names itself', () => {
    const onUserDetail = vi.fn();
    render(<PaymentsScreen rows={payments()} onUserDetail={onUserDetail} />);
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(screen.getByRole('button', { name: 'View user' }));
    expect(onUserDetail).toHaveBeenCalledTimes(1);
  });

  test('there are no approval buttons because successful payments allocate immediately', () => {
    render(<PaymentsScreen rows={payments()} />);
    expect(screen.queryByRole('button', { name: /Approve/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject/u })).toBeNull();
    expect(screen.getByText(/allocated immediately/u)).toBeTruthy();
    expect(screen.queryByText(/nothing to approve/iu)).toBeNull();
  });
});

const APPLICATION = {
  id: 'app_1',
  applicationId: 'app_1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  phone: '+919876543210',
  status: 'submitted',
  createdAt: '2026-08-01T09:00:00.000Z',
};

describe('ApprovalsScreen decisions', () => {
  test('the decision opens in place, showing the full identity', () => {
    render(<ApprovalsScreen rows={[APPLICATION]} />);
    // No decision button until the row is expanded, and no overlay involved.
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    const review = screen.getByRole('button', { name: 'Review' });
    expect(review.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(review);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('+919876543210')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  test('the toggle reports its state and the panel it controls', () => {
    render(<ApprovalsScreen rows={[APPLICATION]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const toggle = screen.getByRole('button', { name: 'Close' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls'))).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  // Same class of defect as the client money screens: `disabled` cannot stop the
  // second tap, because the re-render that disables the button has not happened yet.
  test('a double tap approves exactly once', async () => {
    let resolve;
    const onApprove = vi.fn(() => new Promise((r) => { resolve = r; }));
    render(<ApprovalsScreen rows={[APPLICATION]} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const approve = screen.getByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
    resolve(true);
  });

  test('a decision that failed keeps the panel open for a retry', async () => {
    const onApprove = vi.fn().mockResolvedValue(false);
    render(<ApprovalsScreen rows={[APPLICATION]} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  test('only one decision panel is open at a time', () => {
    const second = { ...APPLICATION, id: 'app_2', email: 'bina@example.com', phone: '+911111111111' };
    render(<ApprovalsScreen rows={[APPLICATION, second]} />);
    const [first, other] = screen.getAllByRole('button', { name: 'Review' });
    fireEvent.click(first);
    fireEvent.click(other);
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.getByText('+911111111111')).toBeTruthy();
  });

  test('every button on the screen declares its type', () => {
    render(<ApprovalsScreen rows={[APPLICATION]} />);
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('type')).toBe('button');
  });

  test('a load in progress does not claim the queue is empty', () => {
    render(<ApprovalsScreen rows={[]} loading />);
    expect(screen.queryByText(/No signups are waiting/u)).toBeNull();
  });
});


const USER = {
  id: 'u1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z',
  activatedAt: '2026-08-02T09:00:00.000Z',
  role: 'client',
};

describe('UserDetailsListScreen', () => {
  test('a failed read is announced with a retry, and does not read as an empty directory', () => {
    const reload = vi.fn();
    setList({ error: 'Network request failed', reload });
    render(<UserDetailsListScreen />);
    expect(screen.getByRole('alert').textContent).toContain('Network request failed');
    expect(screen.queryByText(/No users match this filter yet/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Try again/u }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('a genuinely empty directory still says so', () => {
    setList({});
    render(<UserDetailsListScreen />);
    expect(screen.getByText(/No users match this filter yet/u)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Every row used to render a green tick regardless of state, using a
  // `.be-badge-green` class that no stylesheet defines.
  test('a suspended account is not shown as green and approved', () => {
    setList({ items: [{ ...USER, status: 'suspended' }] });
    const { container } = render(<UserDetailsListScreen />);
    const badge = container.querySelector('.adm-col-status .be-badge');
    expect(badge.textContent).toContain('Suspended');
    expect(badge.className).toContain('be-badge-failed');
  });

  // The header sorted on `approvedAt`, a field no user record carries, so the
  // column's sort silently did nothing.
  test('the Approved column sorts on the field it displays', () => {
    setList({
      items: [
        { ...USER, id: 'u1', name: 'First', activatedAt: '2026-08-05T00:00:00.000Z' },
        { ...USER, id: 'u2', name: 'Second', activatedAt: '2026-08-01T00:00:00.000Z' },
      ],
    });
    const { container } = render(<UserDetailsListScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Approved/u }));
    const names = Array.from(container.querySelectorAll('.adm-user-name')).map((n) => n.textContent);
    expect(names).toEqual(['Second', 'First']);
    expect(screen.getByRole('columnheader', { name: /Approved/u }).getAttribute('aria-sort')).toBe('ascending');
  });

  // SortHeader was declared inside the component body, so each render produced a new
  // component type and React remounted the header buttons — destroying the control
  // under the operator's finger and taking focus with it.
  test('typing in the search box does not destroy the focused sort control', () => {
    setList({ items: [USER] });
    render(<UserDetailsListScreen />);
    const sort = screen.getByRole('button', { name: /Signed up/u });
    sort.focus();
    expect(document.activeElement).toBe(sort);
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'asha' } });
    expect(document.activeElement).toBe(sort);
  });

  test('dates are formatted rather than printed as raw ISO strings', () => {
    setList({ items: [USER] });
    render(<UserDetailsListScreen />);
    expect(screen.queryByText(/2026-08-01T09:00:00/u)).toBeNull();
  });

  test('every button declares its type', () => {
    setList({ items: [USER], hasMore: true });
    render(<UserDetailsListScreen />);
    for (const button of screen.getAllByRole('button')) expect(button.getAttribute('type')).toBe('button');
  });
});
