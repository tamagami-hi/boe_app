// Admin ops-side screens. The defects these cover: an audit detail panel that
// printed an empty object, and an email log whose load/read failures rendered as
// "nothing has ever been queued". The transactions register and the holdings
// screen are retired (payments is the evidence trail; AUM lives under /admin/aum).
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AuditLogScreen from './AuditLogScreen.jsx';
import EmailDeliveriesScreen from './EmailDeliveriesScreen.jsx';
import { normalizeAuditRow } from '../helpers/formatters.js';

const listState = {};
const listCalls = [];
vi.mock('../hooks/useAdminList.js', () => ({
  default: (path, filters) => {
    listCalls.push({ path, filters });
    return listState[path] || listState.default;
  },
}));

function setList(next, path = 'default') {
  listState[path] = {
    items: [], loading: false, error: '', hasMore: false,
    loadMore: vi.fn(), reload: vi.fn(), ...next,
  };
}

beforeEach(() => {
  listCalls.length = 0;
  setList({});
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
