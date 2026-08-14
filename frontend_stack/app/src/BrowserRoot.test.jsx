// Route tests for the admin/browser build target's top-level route table
// (Task 4).
//
// Covers the `/` alias, the public splash/login routes, the admin guard, and the
// top-level unknown-path behavior — which used to redirect to `/admin/splash`,
// making a bad URL look like the console relaunching.
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BrowserRoot from './BrowserRoot.jsx';

/* ---- collaborator mocks ---------------------------------------------------- */

vi.mock('@beonedge/client/store/SessionContext.jsx', () => ({
  SessionProvider: ({ children }) => children,
}));

// An authenticated admin, so `/admin/*` reaches the Admin module rather than
// bouncing to login. Guard behavior for other principals is covered below.
let mockAdminStatus = 'authenticated';
let mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'] };

vi.mock('@beonedge/client/store/AdminSessionContext.jsx', () => ({
  AdminSessionProvider: ({ children }) => children,
  useAdminSession: () => ({
    user: mockAdminUser,
    status: mockAdminStatus,
    isLoading: mockAdminStatus === 'restoring',
    error: null,
    logout: async () => {},
  }),
}));

vi.mock('@beonedge/client/store/sessionState.js', () => ({
  SESSION_STATUS: { RESTORING: 'restoring', AUTHENTICATED: 'authenticated', ANONYMOUS: 'anonymous' },
}));

vi.mock('@beonedge/shared/components/BootstrapShell.jsx', () => ({
  default: ({ label }) => <div data-testid="bootstrap-shell">{label}</div>,
}));

vi.mock('./components/RootErrorBoundary.jsx', () => ({
  default: ({ children }) => children,
}));

vi.mock('@beonedge/admin/pages/Admin.jsx', async () => {
  const { useLocation } = await import('react-router-dom');
  return {
    default: function AdminProbe() {
      const location = useLocation();
      return <div data-testid="admin-location">{location.pathname}</div>;
    },
  };
});

vi.mock('@beonedge/admin/pages/AdminLogin.jsx', () => ({
  default: () => <div data-testid="page-admin-login" />,
}));
vi.mock('@beonedge/admin/pages/AdminSplash.jsx', () => ({
  default: () => <div data-testid="page-admin-splash" />,
}));
vi.mock('@beonedge/admin/pages/NotFound.jsx', () => ({
  default: () => <div data-testid="page-admin-not-found" />,
}));

/* ---- helpers -------------------------------------------------------------- */

function renderShellAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BrowserRoot />
    </MemoryRouter>,
  );
}

/* ---- tests ---------------------------------------------------------------- */

describe('BrowserRoot admin guard (Task 11/13)', () => {
  afterEach(() => {
    mockAdminStatus = 'authenticated';
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'] };
  });

  test('shows a stable bootstrap surface while restoring, not a blank console', async () => {
    mockAdminStatus = 'restoring';
    mockAdminUser = null;
    renderShellAt('/admin/overview');

    expect(await screen.findByTestId('bootstrap-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-location')).not.toBeInTheDocument();
  });

  test('sends a settled anonymous visitor to login with a return path', async () => {
    mockAdminStatus = 'anonymous';
    mockAdminUser = null;
    renderShellAt('/admin/ops/holdings');

    expect(await screen.findByTestId('page-admin-login')).toBeInTheDocument();
  });

  test('rejects a non-admin principal', async () => {
    mockAdminStatus = 'authenticated';
    mockAdminUser = { id: 'c1', role: 'client', roles: ['client'] };
    renderShellAt('/admin/overview');

    expect(await screen.findByTestId('page-admin-login')).toBeInTheDocument();
  });
});

describe('BrowserRoot public routes', () => {
  test('/ redirects to the admin splash', async () => {
    renderShellAt('/');
    expect(await screen.findByTestId('page-admin-splash')).toBeInTheDocument();
  });

  test('/admin/login renders the login page', async () => {
    renderShellAt('/admin/login');
    expect(await screen.findByTestId('page-admin-login')).toBeInTheDocument();
  });
});

describe('BrowserRoot admin scope', () => {
  test('/admin/* mounts the Admin module with the path preserved', async () => {
    renderShellAt('/admin/ops/holdings');
    expect(await screen.findByTestId('admin-location')).toHaveTextContent('/admin/ops/holdings');
  });
});

describe('BrowserRoot unknown-path handling', () => {
  test('unknown top-level path renders Not Found, not splash', async () => {
    renderShellAt('/totally-unknown');
    expect(await screen.findByTestId('page-admin-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('page-admin-splash')).not.toBeInTheDocument();
  });

  // Cross-scope check from plan §O: a client path in the admin build must be
  // rejected visibly rather than absorbed into the admin console.
  test('a client path is rejected rather than absorbed', async () => {
    renderShellAt('/app/dashboard');
    expect(await screen.findByTestId('page-admin-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-location')).not.toBeInTheDocument();
  });
});
