// Admin ops screens. The defects these cover: filter values the backend's strict
// enums reject (so choosing a filter 400s the screen), a "Load more" that wiped the
// rows it was adding to, holdings and AUM read from fields the projection does not
// send, and an audit detail panel that printed an empty object.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TransactionsScreen from './TransactionsScreen.jsx';
import HoldingsScreen from './HoldingsScreen.jsx';
import AuditLogScreen from './AuditLogScreen.jsx';
import EmailDeliveriesScreen from './EmailDeliveriesScreen.jsx';
import { normalizeAuditRow, normalizeFundRow } from '../helpers/formatters.js';

// The canonical enums, copied from backend_controller/src/db/types.ts. A filter that
// sends anything outside these is rejected by the route's `.strict()` schema.
const ORDER_STATES = [
  'submitted', 'payment_pending', 'payment_confirmed', 'booked',
  'payment_failed', 'cancelled', 'rejected', 'refunded', 'reversed',
];
const ORDER_TYPES = ['purchase', 'sip_installment', 'redemption', 'refund', 'adjustment'];

const listState = {};
const listCalls = [];
vi.mock('../hooks/useAdminList.js', () => ({
  default: (path, filters) => {
    listCalls.push({ path, filters });
    return listState[path] || listState.default;
  },
}));

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
}));

function setList(next, path = 'default') {
  listState[path] = {
    items: [], loading: false, error: '', hasMore: false,
    loadMore: vi.fn(), reload: vi.fn(), ...next,
  };
}

const ORDER = {
  id: '4f1c2d3e-1111-2222-3333-444455556666',
  userEmail: 'asha@example.com',
  fundName: 'Edge Growth',
  type: 'sip_installment',
  status: 'booked',
  amountPaise: '500000',
  requestedAt: '2026-08-01T10:00:00.000Z',
  createdAt: '2026-08-01T10:00:00.000Z',
};

beforeEach(() => {
  listCalls.length = 0;
  setList({});
  request.mockReset();
  request.mockResolvedValue({ items: [] });
});

describe('TransactionsScreen filters match the backend enums', () => {
  test('every status option is a real order state', () => {
    setList({ items: [ORDER] });
    render(<TransactionsScreen />);
    const values = Array.from(screen.getByLabelText('Order status').querySelectorAll('option'))
      .map((o) => o.value)
      .filter((v) => v !== 'all');
    expect(values).toEqual(ORDER_STATES);
    // The old list offered these three, which no order is ever in.
    for (const bogus of ['awaiting_approval', 'approved', 'approval_rejected']) {
      expect(values).not.toContain(bogus);
    }
  });

  test('every type option is a real order type', () => {
    setList({ items: [ORDER] });
    render(<TransactionsScreen />);
    const values = Array.from(screen.getByLabelText('Order type').querySelectorAll('option'))
      .map((o) => o.value)
      .filter((v) => v !== 'all');
    expect(values).toEqual(ORDER_TYPES);
    // Both of the old options were rejected by the route, so the type filter
    // could only ever produce a validation error.
    expect(values).not.toContain('sip');
    expect(values).not.toContain('lumpsum');
  });

  test('the chosen status reaches the query', () => {
    setList({ items: [ORDER] });
    render(<TransactionsScreen />);
    fireEvent.change(screen.getByLabelText('Order status'), { target: { value: 'booked' } });
    expect(listCalls.at(-1).filters.status).toBe('booked');
  });
});

describe('TransactionsScreen state', () => {
  // `loading` goes true on every fetch, Load more included, and the rows were
  // rendered behind `!loading`.
  test('a further page does not blank the rows already on screen', () => {
    setList({ items: [ORDER], loading: true, hasMore: true });
    const { container } = render(<TransactionsScreen />);
    expect(screen.getByText('Edge Growth')).toBeTruthy();
    expect(container.querySelectorAll('.adm-skeleton, .skeleton-table-row__bar').length).toBe(0);
  });

  test('a failed read is announced with a retry and does not read as empty', () => {
    const reload = vi.fn();
    setList({ error: 'Could not load data.', reload });
    render(<TransactionsScreen />);
    expect(screen.getByRole('alert').textContent).toContain('Could not load data.');
    expect(screen.queryByText(/No orders match these filters/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Try again/u }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('the order reference is rendered in full', () => {
    setList({ items: [ORDER] });
    render(<TransactionsScreen />);
    expect(screen.getByText(ORDER.id)).toBeTruthy();
  });

  test('a SIP installment is labelled as one', () => {
    setList({ items: [ORDER] });
    render(<TransactionsScreen />);
    expect(screen.getAllByText('SIP installment').length).toBeGreaterThan(0);
  });
});

describe('HoldingsScreen reads the fields the projection sends', () => {
  const fund = normalizeFundRow({
    id: 'f1',
    slug: 'edge-growth',
    name: 'Edge Growth',
    status: 'published',
    objective: 'Long-term compounding',
    stockCount: 12,
    aum: { closingPaise: '250000000', periodStart: '2026-08-01', updatedAt: '2026-08-05T00:00:00.000Z' },
  });

  test('the pool size comes from the published AUM, not a field that does not exist', () => {
    const { container } = render(<HoldingsScreen funds={[fund]} />);
    // 250000000 paise = ₹25,00,000.
    expect(container.textContent).toContain('25,00,000');
    expect(container.textContent).not.toContain('₹0');
  });

  test('the disclosed stock count is shown', () => {
    render(<HoldingsScreen funds={[fund]} />);
    expect(screen.getByText('12')).toBeTruthy();
  });

  test('a load in progress does not claim there are no pools', () => {
    render(<HoldingsScreen funds={[]} loading />);
    expect(screen.queryByText(/No fund pools exist yet/u)).toBeNull();
  });

  test('expanding a pool reads its real stock list', async () => {
    request.mockResolvedValue({
      items: [
        { id: 's1', stockName: 'SJS Enterprises', quarterLabel: 'Q1 FY27', weightPercent: 4.5, state: 'active' },
        { id: 's2', stockName: 'Old Holding', quarterLabel: 'Q4 FY26', state: 'exited' },
      ],
    });
    render(<HoldingsScreen funds={[fund]} />);
    const toggle = screen.getByRole('button', { name: 'View holdings' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(await screen.findByText('SJS Enterprises')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('/v1/admin/funds/f1/stocks', { scope: 'admin' });
    // An exited holding is counted, not listed as current.
    expect(screen.queryByText('Old Holding')).toBeNull();
    expect(screen.getByText(/exited holding/u)).toBeTruthy();
  });

  test('a failed stock read is announced, not shown as an empty pool', async () => {
    request.mockRejectedValue(new Error('Read failed'));
    render(<HoldingsScreen funds={[fund]} />);
    fireEvent.click(screen.getByRole('button', { name: 'View holdings' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Read failed');
    expect(screen.queryByText(/No stocks disclosed/u)).toBeNull();
  });

  test('the stage badge names the real fund state', () => {
    render(<HoldingsScreen funds={[fund]} />);
    expect(screen.getByText('Published')).toBeTruthy();
  });
});

describe('AuditLogScreen', () => {
  const event = normalizeAuditRow({
    id: 'e1',
    occurredAt: '2026-08-01T09:15:30.000Z',
    createdAt: '2026-08-01T09:15:30.000Z',
    actorType: 'admin',
    actorEmail: 'operator@example.com',
    command: 'application.decide',
    entityType: 'application',
    entityId: 'aaaabbbb-cccc-dddd-eeee-ffff00001111',
    fromState: 'submitted',
    toState: 'approved',
    reasonCode: 'documents_verified',
    requestId: 'req_12345',
    entityVersion: 3,
    metadata: { decision: 'approved' },
  });

  test('the detail panel shows the transition and the request, not an empty object', () => {
    render(<AuditLogScreen rows={[event]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
    const panel = document.getElementById('audit-detail-e1');
    expect(panel.textContent).toContain('aaaabbbb-cccc-dddd-eeee-ffff00001111');
    expect(panel.textContent).toContain('req_12345');
    expect(panel.textContent).not.toContain('{}');
    // The old panel printed `{ before, after, ip, ua }`, none of which exist.
    expect(panel.textContent).not.toContain('ipAddress');
  });

  test('the transition is on the entry itself', () => {
    const { container } = render(<AuditLogScreen rows={[event]} />);
    const transition = container.querySelector('.adm-event__transition');
    expect(transition.textContent).toContain('submitted');
    expect(transition.textContent).toContain('approved');
  });

  test('the actor email is not truncated to eight characters', () => {
    render(<AuditLogScreen rows={[event]} />);
    expect(screen.getByText(/operator@example\.com/u)).toBeTruthy();
  });

  test('the toggle declares what it controls', () => {
    render(<AuditLogScreen rows={[event]} />);
    const toggle = screen.getByRole('button', { name: 'Detail' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide detail' }).getAttribute('aria-expanded')).toBe('true');
  });

  // It rendered one <table>, with its own header row, per day on screen.
  test('the stream is a list, not a table per day', () => {
    render(<AuditLogScreen rows={[event]} />);
    expect(document.querySelectorAll('table').length).toBe(0);
    expect(document.querySelectorAll('.adm-stream li').length).toBe(1);
  });

  test('the entries-today tile does not change when you search', () => {
    render(<AuditLogScreen rows={[event]} />);
    const tileValue = () => Array.from(document.querySelectorAll('.adm-stat'))
      .find((n) => n.textContent.startsWith('Entries today'))
      .querySelector('.adm-stat-value').textContent;
    const before = tileValue();
    fireEvent.change(screen.getByLabelText('Search the audit log'), { target: { value: 'zzz' } });
    expect(tileValue()).toBe(before);
  });

  test('an empty log teaches what will appear', () => {
    render(<AuditLogScreen rows={[]} />);
    expect(screen.getByText(/Every administrative command is recorded/u)).toBeTruthy();
  });
});

describe('EmailDeliveriesScreen', () => {
  const delivery = {
    emailDeliveryId: 'd1',
    recipientMasked: 'a***@example.com',
    templateKey: 'account_approved',
    state: 'delivered',
    attemptCount: 1,
    lastErrorCode: null,
    updatedAt: '2026-08-01T10:00:00.000Z',
  };

  test('its buttons use the console button class, not one that does not exist', () => {
    setList({ items: [delivery], hasMore: true });
    render(<EmailDeliveriesScreen />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(1);
    for (const button of buttons) {
      expect(button.className).toContain('be-btn');
      expect(button.className).not.toContain('adm-btn');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  test('the status column is a badge', () => {
    setList({ items: [delivery] });
    const { container } = render(<EmailDeliveriesScreen />);
    const badge = container.querySelector('.be-badge');
    expect(badge.textContent).toContain('Delivered');
    expect(badge.className).toContain('be-badge-active');
  });

  test('both filters are labelled', () => {
    setList({ items: [delivery] });
    render(<EmailDeliveriesScreen />);
    expect(screen.getByLabelText('Delivery status')).toBeTruthy();
    expect(screen.getByLabelText('Template')).toBeTruthy();
  });

  test('a failed read does not claim nothing has ever been queued', () => {
    setList({ error: 'Read failed' });
    render(<EmailDeliveriesScreen />);
    expect(screen.getByRole('alert').textContent).toContain('Read failed');
    expect(screen.queryByText(/No email has been queued yet/u)).toBeNull();
  });
});
