// Route tests for the Admin build target (Task 4).
//
// Locks the canonical route table, the intentional compatibility redirects, and
// the unknown-path behavior that Task 4 changed from a silent
// `Navigate to="/admin/overview"` into an explicit Not Found. Screens are mocked
// to markers; routing and the shell wiring are the real modules under test.
import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import Admin from './Admin.jsx';
import { NAV_DOMAINS, allNavPermissions } from '../navigation/nav.js';

const ALL_PERMISSIONS = allNavPermissions();

/* ---- collaborator mocks ---------------------------------------------------- */

// The real AdminShell mounts ApprovalsQueueProvider, which fetches the approvals
// queue and polls it. Routing does not need any of that.
vi.mock('../layout/AdminShell.jsx', () => ({
  default: () => (
    <div data-testid="admin-shell">
      <Outlet />
    </div>
  ),
}));

vi.mock('./LegacyTabRedirect.jsx', () => ({
  default: () => <div data-testid="page-legacy-tab-redirect" />,
}));
vi.mock('./OverviewPage.jsx', () => ({ default: () => <div data-testid="page-overview" /> }));
vi.mock('../features/site/FaqsPage.jsx', () => ({ default: () => <div data-testid="page-faqs" /> }));
vi.mock('./NotFound.jsx', () => ({ default: () => <div data-testid="page-not-found" /> }));
vi.mock('./Forbidden.jsx', () => ({ default: () => <div data-testid="page-forbidden" /> }));

// A principal holding every permission the nav declares, so the canonical route
// tests below exercise routing rather than the permission gate. Gating itself is
// covered in its own describe block.
let mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: ALL_PERMISSIONS };
vi.mock('@beonedge/client/store/AdminSessionContext.jsx', () => ({
  useAdminSession: () => ({ user: mockAdminUser, status: 'authenticated' }),
}));

vi.mock('./legacy/legacyRoutes.jsx', () => ({
  ApprovalsRoute: () => <div data-testid="page-approvals" />,
  MandatesRoute: () => <div data-testid="page-mandates" />,
  PaymentsRoute: () => <div data-testid="page-payments" />,
  UserDirectoryRoute: () => <div data-testid="page-user-directory" />,
  UserDetailRoute: () => <div data-testid="page-user-detail" />,
  FundsRoute: () => <div data-testid="page-funds" />,
  FundWorkspaceRoute: () => <div data-testid="page-fund-workspace" />,
  RedemptionsRoute: () => <div data-testid="page-redemptions" />,
  FundWorkspaceRoute: () => <div data-testid="page-fund-workspace" />,
  RedemptionsRoute: () => <div data-testid="page-redemptions" />,
  HoldingsRoute: () => <div data-testid="page-holdings" />,
  TransactionsRoute: () => <div data-testid="page-transactions" />,
  AppBuilderRoute: () => <div data-testid="page-app-builder" />,
  AuditLogRoute: () => <div data-testid="page-audit-log" />,
  EmailDeliveriesRoute: () => <div data-testid="page-email-deliveries" />,
  EnvironmentRoute: () => <div data-testid="page-environment" />,
}));

/* ---- helpers -------------------------------------------------------------- */

// Admin is mounted under `/admin/*` by the app shell (BrowserRoot), exactly as
// in production.
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<Admin />} />
      </Routes>
    </MemoryRouter>,
  );
}

/* ---- canonical routes ----------------------------------------------------- */

describe('Admin route table', () => {
  const routeCases = [
    ['/admin/overview', 'page-overview'],
    ['/admin/users/approvals', 'page-approvals'],
    ['/admin/users/subscriptions', 'page-mandates'],
    ['/admin/users/payments', 'page-payments'],
    ['/admin/users/directory', 'page-user-directory'],
    ['/admin/users/directory/u1', 'page-user-detail'],
    ['/admin/site/faqs', 'page-faqs'],
    ['/admin/app/builder', 'page-app-builder'],
    ['/admin/ops/funds', 'page-funds'],
    ['/admin/ops/funds/f1', 'page-fund-workspace'],
    ['/admin/ops/redemptions', 'page-redemptions'],
    ['/admin/ops/funds/f1', 'page-fund-workspace'],
    ['/admin/ops/redemptions', 'page-redemptions'],
    ['/admin/ops/holdings', 'page-holdings'],
    ['/admin/ops/transactions', 'page-transactions'],
    ['/admin/system/audit-log', 'page-audit-log'],
    ['/admin/system/emails', 'page-email-deliveries'],
    ['/admin/system/environment', 'page-environment'],
  ];

  for (const [path, testId] of routeCases) {
    test(`${path} renders its screen`, async () => {
      renderAt(path);
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    });
  }

  test('every route renders inside the persistent shell', async () => {
    renderAt('/admin/overview');
    expect(await screen.findByTestId('admin-shell')).toBeInTheDocument();
  });

  test('/admin resolves through the legacy ?tab= resolver', async () => {
    renderAt('/admin');
    expect(await screen.findByTestId('page-legacy-tab-redirect')).toBeInTheDocument();
  });
});

/* ---- deliberate compatibility redirects ---------------------------------- */

describe('Admin retired-route redirects', () => {
  // These are intentional: the features were retired by canonical decisions, so
  // the paths must keep resolving somewhere sensible rather than becoming dead
  // links. They are the reason the wildcard could be narrowed safely.
  const redirectCases = [
    ['/admin/users/kyc', 'page-approvals'],
    ['/admin/users/risk-profiles', 'page-approvals'],
    ['/admin/ops/ledger', 'page-transactions'],
    ['/admin/ops/sip-control', 'page-transactions'],
    ['/admin/system/support', 'page-audit-log'],
  ];

  for (const [path, testId] of redirectCases) {
    test(`${path} still redirects to its replacement`, async () => {
      renderAt(path);
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    });
  }
});

/* ---- unknown paths ------------------------------------------------------- */

describe('Admin unknown-route handling', () => {
  test('unknown /admin/* path renders Not Found, not Overview', async () => {
    renderAt('/admin/this-page-does-not-exist');
    expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('page-overview')).not.toBeInTheDocument();
  });

  test('Not Found still renders inside the admin shell', async () => {
    renderAt('/admin/this-page-does-not-exist');
    expect(await screen.findByTestId('admin-shell')).toBeInTheDocument();
  });

  test('a client path typed into the admin build is not silently absorbed', async () => {
    renderAt('/admin/dashboard');
    expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
  });
});

/* ---- permission gating (Task 15) ------------------------------------------ */

describe('Admin permission gating', () => {
  afterEach(() => {
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: ALL_PERMISSIONS };
  });

  // Every gated destination, driven from the manifest so a new route cannot be
  // added without a permission decision being made for it.
  const gated = NAV_DOMAINS
    .flatMap((domain) => domain.items)
    .filter((item) => item.permissions.length > 0);

  test('there is at least one gated destination to check', () => {
    expect(gated.length).toBeGreaterThan(0);
  });

  for (const item of gated) {
    test(`${item.path} renders Forbidden without ${item.permissions.join(' or ')}`, async () => {
      // Holds a real permission, just not one this destination accepts.
      mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: ['nothing.useful'] };
      renderAt(item.path);

      expect(await screen.findByTestId('page-forbidden')).toBeInTheDocument();
    });

    test(`${item.path} renders its screen with only ${item.permissions[0]}`, async () => {
      // Required-ANY: one matching code is enough, mirroring the backend.
      mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: [item.permissions[0]] };
      renderAt(item.path);

      expect(await screen.findByTestId(/^page-/)).toBeInTheDocument();
      expect(screen.queryByTestId('page-forbidden')).not.toBeInTheDocument();
    });
  }

  test('Overview stays reachable for a principal with no permissions at all', async () => {
    // Hiding it would leave a limited admin with no entry point.
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: [] };
    renderAt('/admin/overview');

    expect(await screen.findByTestId('page-overview')).toBeInTheDocument();
  });

  test('Forbidden is distinct from Not Found', async () => {
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: [] };
    renderAt('/admin/system/audit-log');
    expect(await screen.findByTestId('page-forbidden')).toBeInTheDocument();
    expect(screen.queryByTestId('page-not-found')).not.toBeInTheDocument();
  });

  test('an unknown path is Not Found, not Forbidden, even with no permissions', async () => {
    // A path that does not exist is a different fact from one that is withheld.
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: [] };
    renderAt('/admin/no-such-page');
    expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('page-forbidden')).not.toBeInTheDocument();
  });
});
