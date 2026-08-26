// The last group of client screens. The recurring defect here was a swallowed read
// failure: `.catch(() => setItems([]))` renders "you have nothing" to someone who
// has something, which on a statements or withdrawals screen is a lie about money.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HOME_PATH, buildPath } from '../navigation/routes.js';

const listStatements = vi.fn();
const listNotifications = vi.fn();
const markAllRead = vi.fn();
const markRead = vi.fn();

vi.mock('../services/statementsApi.js', () => ({
  listStatements: (...a) => listStatements(...a),
  downloadStatement: async () => ({}),
}));
vi.mock('../services/notificationsApi.js', () => ({
  listNotifications: (...a) => listNotifications(...a),
  markAllRead: (...a) => markAllRead(...a),
  markRead: (...a) => markRead(...a),
}));
vi.mock('../layout/AppBar.jsx', () => ({ default: ({ title }) => <span>{title}</span> }));

const { default: Statements } = await import('./Statements.jsx');
const { default: Notifications } = await import('./Notifications.jsx');

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(element, path, routePath) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  listStatements.mockReset().mockResolvedValue([
    { id: 's1', period: '2026-07', closingValue: 1200, returns: 200 },
  ]);
  listNotifications.mockReset().mockResolvedValue([
    { id: 'n1', kind: 'order_booked', title: 'SIP booked', body: 'Alpha Pool', ts: '2026-08-01T10:00:00Z', read: false, deepLink: null },
  ]);
  markAllRead.mockReset().mockResolvedValue({});
  markRead.mockReset().mockResolvedValue({});
});

describe('a failed read is never rendered as "you have nothing"', () => {
  test('Statements says the read failed and offers a retry', async () => {
    listStatements.mockRejectedValue(new Error('backend down'));
    renderAt(<Statements />, '/app/statements', '/app/statements');
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load your statements');
    // The old behaviour: "Statements appear here once your account has activity."
    expect(screen.queryByText(/once your account has activity/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(listStatements).toHaveBeenCalledTimes(2);
  });

  test('Notifications says the read failed instead of showing an empty inbox', async () => {
    listNotifications.mockRejectedValue(new Error('backend down'));
    renderAt(<Notifications />, '/app/notifications', '/app/notifications');
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load your notifications');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(listNotifications).toHaveBeenCalledTimes(2);
  });

});

describe('Notifications semantics', () => {
  test('a notification row is a real button, not a div with a role', async () => {
    const { container } = renderAt(<Notifications />, '/app/notifications', '/app/notifications');
    await flush();
    const row = screen.getByRole('button', { name: /Investment: SIP booked, unread/ });
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAttribute('type', 'button');
    expect(container.querySelectorAll('div[role="button"]').length).toBe(0);
    expect(container.querySelectorAll('div[tabindex]').length).toBe(0);
  });

  test('opening an app-update notification goes Home via the manifest', async () => {
    listNotifications.mockResolvedValue([
      { id: 'n2', kind: 'app_update_available', title: 'Update ready', body: '', ts: '2026-08-01T10:00:00Z', read: true },
    ]);
    renderAt(<Notifications />, '/app/notifications', '/app/notifications');
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /App update: Update ready/ }));
    await flush();
    expect(screen.getByTestId('location')).toHaveTextContent(HOME_PATH);
  });

  test('"Mark all read" is disabled once nothing is unread', async () => {
    renderAt(<Notifications />, '/app/notifications', '/app/notifications');
    await flush();
    const markAll = screen.getByRole('button', { name: 'Mark all notifications as read' });
    expect(markAll).toBeEnabled();
    fireEvent.click(markAll);
    await flush();
    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Mark all notifications as read' })).toBeDisabled();
  });
});
