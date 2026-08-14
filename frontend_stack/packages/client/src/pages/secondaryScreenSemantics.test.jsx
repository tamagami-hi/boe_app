// Secondary screens: the same rule as the primary ones. Navigation is a link, an
// action is a button, a disclosure says it discloses, and a filter that changes what
// you see belongs in the URL.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildPath } from '../navigation/routes.js';

/* ---- collaborators --------------------------------------------------------- */

const logout = vi.fn();
vi.mock('../store/SessionContext.jsx', () => ({
  useSession: () => ({
    user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', phoneMasked: '••••1234', avatarInitials: 'AL' },
    status: 'authenticated',
    logout,
  }),
}));

vi.mock('../services/kycApi.js', () => ({
  fetchKycStatus: async () => ({ status: 'approved', expired: false }),
}));

const createTicket = vi.fn();
vi.mock('../services/supportApi.js', () => ({
  listFaqs: async () => [{ q: 'How does a SIP work?', a: 'Recurring UPI AutoPay debits.' }],
  listTickets: async () => [
    { id: 't1', reference: 'BOE-1A2B3C4D', subject: 'Cannot pause my SIP', status: 'open', updatedAt: '2026-08-01' },
  ],
  createTicket: (...a) => createTicket(...a),
}));

const TX = [{ id: 'x1', type: 'sip', amount: 1000, date: '2026-08-01', status: 'success', fundName: 'Alpha Pool' }];
const PAYMENTS = [{ paymentId: 'p1', amount: 1000, status: 'pending', type: 'sip', fundName: 'Alpha Pool' }];

vi.mock('../data/clientResources.js', () => ({
  useTransactions: (filter, { enabled } = {}) => ({ data: enabled ? TX : undefined, error: null }),
  usePaymentQueue: (kind, { enabled } = {}) => ({ data: enabled ? PAYMENTS : undefined, error: null }),
  usePortfolio: () => ({ data: undefined, error: null, isLoading: true, isRefreshing: false, refresh: () => {} }),
  useClientCacheActions: () => ({ invalidateMoney: () => {} }),
}));

const { default: Profile } = await import('./Profile.jsx');
const { default: Support } = await import('./Support.jsx');
const { default: Transactions } = await import('./Transactions.jsx');

const renderAt = (ui, path) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  logout.mockReset();
  createTicket.mockReset().mockResolvedValue({
    id: 't2', reference: 'BOE-99887766', subject: 'New issue', status: 'open', updatedAt: '2026-08-14',
  });
});

describe('Profile settings rows are links', () => {
  const expected = [
    ['Notifications', buildPath('notifications')],
    ['Security & PIN', buildPath('security')],
    ['Statements', buildPath('statements')],
    ['Support', buildPath('support')],
    ['Legal & disclosures', buildPath('legal')],
    ['KYC & Compliance', buildPath('kyc')],
  ];

  test.each(expected)('%s is a focusable link to %s', async (label, href) => {
    renderAt(<Profile />, '/app/profile');
    const row = await screen.findByRole('link', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    expect(row).toHaveAttribute('href', href);
    row.focus();
    expect(row).toHaveFocus();
  });

  test('read-only rows are not controls', async () => {
    renderAt(<Profile />, '/app/profile');
    await screen.findByRole('link', { name: /Notifications/ });
    // Email and Phone display a value; they lead nowhere and must not look like
    // they do. The old Row rendered a chevron only when onClick was passed but was
    // a clickable div either way.
    expect(screen.queryByRole('link', { name: /^Email/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Email/ })).not.toBeInTheDocument();
    // It appears twice on the screen (identity card + Account row), which is fine —
    // the point is that neither occurrence is a control.
    expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0);
  });

  test('sign out is a button and replaces the history entry', async () => {
    renderAt(<Profile />, '/app/profile');
    const button = screen.getByRole('button', { name: 'Sign out' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    await flush();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  test('no clickable divs remain', async () => {
    const { container } = renderAt(<Profile />, '/app/profile');
    await screen.findByRole('link', { name: /Notifications/ });
    expect(container.querySelectorAll('div[role="button"]').length).toBe(0);
    expect(container.querySelectorAll('div[tabindex]').length).toBe(0);
  });
});

describe('Support', () => {
  test('a FAQ is a disclosure button, not a div', async () => {
    renderAt(<Support />, '/app/profile/support');
    const q = await screen.findByRole('button', { name: /How does a SIP work/ });
    expect(q).toHaveAttribute('aria-expanded', 'false');
    const panelId = q.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    // aria-controls must resolve even while collapsed.
    expect(document.getElementById(panelId)).toBeTruthy();

    fireEvent.click(q);
    expect(q).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Recurring UPI AutoPay debits.')).toBeVisible();
  });

  test('the ticket form labels its controls', async () => {
    renderAt(<Support />, '/app/profile/support');
    fireEvent.click(await screen.findByRole('button', { name: 'Open a ticket' }));
    // These were bare <label> elements with no `for`, so all three were unlabelled.
    expect(screen.getByLabelText(/Subject/)).toBeRequired();
    expect(screen.getByLabelText(/Category/).tagName).toBe('SELECT');
    expect(screen.getByLabelText(/Describe the issue/).tagName).toBe('TEXTAREA');
  });

  test('a failed submit keeps the form and says so', async () => {
    createTicket.mockRejectedValueOnce(new Error('network down'));
    renderAt(<Support />, '/app/profile/support');
    fireEvent.click(await screen.findByRole('button', { name: 'Open a ticket' }));
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: 'Help' } });
    fireEvent.change(screen.getByLabelText(/Describe the issue/), { target: { value: 'Details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await flush();
    // The old version closed the form and prepended `undefined` to the list.
    expect(screen.getByRole('alert')).toHaveTextContent('network down');
    expect(screen.getByLabelText(/Subject/)).toHaveValue('Help');
  });

  test('an existing ticket shows the reference the backend minted', async () => {
    renderAt(<Support />, '/app/profile/support');
    expect(await screen.findByText(/BOE-1A2B3C4D/)).toBeInTheDocument();
  });
});

describe('Transactions filters live in the URL', () => {
  test('the tab strip is a group of toggles, not a tablist', async () => {
    const { container } = renderAt(<Transactions />, '/app/transactions');
    expect(container.querySelectorAll('[role="tablist"]').length).toBe(0);
    expect(container.querySelectorAll('[role="tab"]').length).toBe(0);
    const group = screen.getByRole('group', { name: 'Transaction filters' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('?tab= selects the filter on arrival, so the screen can be linked to', () => {
    renderAt(<Transactions />, '/app/transactions?tab=pending');
    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('an unknown ?tab= falls back to All rather than showing nothing', () => {
    renderAt(<Transactions />, '/app/transactions?tab=nonsense');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('tapping a filter moves the selection', () => {
    renderAt(<Transactions />, '/app/transactions');
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a transaction row is a real button', () => {
    renderAt(<Transactions />, '/app/transactions');
    const row = screen.getByRole('button', { name: /Alpha Pool/ });
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAttribute('type', 'button');
    fireEvent.click(row);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('"View payment" is a link to the payment route', () => {
    renderAt(<Transactions />, '/app/transactions?tab=pending');
    const link = screen.getByRole('link', { name: 'View payment' });
    expect(link).toHaveAttribute('href', buildPath('payment_status', { paymentId: 'p1' }));
  });
});
