// Tests for ClientLayout's BottomNav visibility rule, the terminal-account
// allowed-route exception (Task 2), and its adoption of the canonical route
// manifest (Task 14).
//
// Visibility is now declared per route in `navigation/routes.js`. It used to be
// inferred by prefix matching, which showed the bar on every descendant of a
// primary path — all of `/app/profile/*` — while hiding it on Statements and
// Notifications, which sit at the same level of the same hierarchy.
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ClientLayout from './ClientLayout.jsx';

const ACTIVE_USER = { id: 'u1', role: 'client' };
let mockUser = ACTIVE_USER;
let mockStatus = 'authenticated';

vi.mock('../store/SessionContext.jsx', () => ({
  useSession: () => ({
    user: mockUser,
    status: mockStatus,
    isLoading: mockStatus === 'restoring',
    error: null,
    logout: async () => {},
  }),
}));

vi.mock('../components/AppLockGate.jsx', () => ({ default: ({ children }) => children }));
vi.mock('../pages/Blocked.jsx', () => ({ default: () => <div data-testid="page-blocked" /> }));
vi.mock('@beonedge/shared', () => ({
  PageTransition: ({ children }) => children,
  BootstrapShell: ({ label }) => <div data-testid="bootstrap-shell">{label}</div>,
}));

function renderLayoutAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ClientLayout />}>
          <Route path="/app/profile/support" element={<div data-testid="page-support" />} />
          <Route path="*" element={<div data-testid="outlet-page" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const primaryNav = () => screen.queryByRole('navigation', { name: 'Primary' });

describe('ClientLayout bottom nav visibility', () => {
  const primaryPaths = [
    '/app/dashboard',
    '/app/explore',
    '/app/portfolio',
    '/app/transactions',
    '/app/profile',
  ];

  for (const path of primaryPaths) {
    test(`shows bottom nav on primary path ${path}`, () => {
      renderLayoutAt(path);
      expect(primaryNav()).toBeInTheDocument();
    });
  }

  // Task 14: these are pushed secondary screens under Profile. Prefix matching
  // kept the bottom bar on them purely because their path starts with
  // `/app/profile`; the manifest now says otherwise.
  const profileDescendants = [
    '/app/profile/email-verification',
    '/app/profile/security',
    '/app/profile/support',
    '/app/profile/legal',
  ];

  for (const path of profileDescendants) {
    test(`hides bottom nav on secondary Profile screen ${path}`, () => {
      renderLayoutAt(path);
      expect(primaryNav()).not.toBeInTheDocument();
    });
  }

  const nonPrimaryPaths = [
    '/app/funds/f1',
    '/app/statements',
    '/app/notifications',
    '/app/investor-charter',
    '/app/grievance',
  ];

  for (const path of nonPrimaryPaths) {
    test(`hides bottom nav on non-primary path ${path}`, () => {
      renderLayoutAt(path);
      expect(primaryNav()).not.toBeInTheDocument();
    });
  }

  test('hides bottom nav on an unknown path (Not Found)', () => {
    // Not Found renders inside the shell; it is not a primary destination, so
    // the bar must not appear on it.
    renderLayoutAt('/app/this-route-does-not-exist');
    expect(primaryNav()).not.toBeInTheDocument();
  });

  test('hides bottom nav on the public splash and login paths', () => {
    for (const path of ['/app/splash', '/app/login']) {
      const { unmount } = renderLayoutAt(path);
      expect(primaryNav()).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('ClientLayout session restore (Task 11/13)', () => {
  afterEach(() => {
    mockStatus = 'authenticated';
    mockUser = ACTIVE_USER;
  });

  test('renders a stable bootstrap surface while restoring, never a blank frame', () => {
    // Was `return null`. On a phone a blank frame during every cold start is
    // indistinguishable from the app crashing and relaunching.
    mockStatus = 'restoring';
    mockUser = null;
    renderLayoutAt('/app/dashboard');

    expect(screen.getByTestId('bootstrap-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet-page')).not.toBeInTheDocument();
  });

  test('does not show the bootstrap surface once the session has settled', () => {
    renderLayoutAt('/app/dashboard');

    expect(screen.queryByTestId('bootstrap-shell')).not.toBeInTheDocument();
    expect(screen.getByTestId('outlet-page')).toBeInTheDocument();
  });

  test('public routes render without waiting on the session at all', () => {
    // Splash and login must paint immediately — they are what the user sees during
    // the restore that everything else waits for.
    mockStatus = 'restoring';
    mockUser = null;
    renderLayoutAt('/app/splash');

    expect(screen.getByTestId('outlet-page')).toBeInTheDocument();
    expect(screen.queryByTestId('bootstrap-shell')).not.toBeInTheDocument();
  });
});

describe('ClientLayout terminal-account access', () => {
  // Terminal (rejected/suspended/closed) accounts see Blocked on every route
  // except the ones Blocked's own actions need — Support — added in Task 2 so
  // the "Contact support" button no longer loops back to Blocked.
  afterEach(() => {
    mockUser = ACTIVE_USER;
  });

  test('terminal account on /app/profile/support renders Support, not Blocked', () => {
    mockUser = { id: 'u1', role: 'client', status: 'suspended' };
    renderLayoutAt('/app/profile/support');
    expect(screen.getByTestId('page-support')).toBeInTheDocument();
    expect(screen.queryByTestId('page-blocked')).not.toBeInTheDocument();
  });

  test('terminal account on /app/dashboard still renders Blocked', () => {
    mockUser = { id: 'u1', role: 'client', status: 'suspended' };
    renderLayoutAt('/app/dashboard');
    expect(screen.getByTestId('page-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet-page')).not.toBeInTheDocument();
  });
});
