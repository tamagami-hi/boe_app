import React from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import Admin from './Admin.jsx';
import { NAV_DOMAINS, allNavPermissions } from '../navigation/nav.js';

const ALL_PERMISSIONS = allNavPermissions();

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

let mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: ALL_PERMISSIONS };
vi.mock('@beonedge/client/store/AdminSessionContext.jsx', () => ({
  useAdminSession: () => ({ user: mockAdminUser, status: 'authenticated' }),
}));

vi.mock('./legacy/legacyRoutes.jsx', () => ({
  ApprovalsRoute: () => <div data-testid="page-approvals" />,
  PaymentsRoute: () => <div data-testid="page-payments" />,
  UserDirectoryRoute: () => <div data-testid="page-user-directory" />,
  UserDetailRoute: () => <div data-testid="page-user-detail" />,
  FundsRoute: () => <div data-testid="page-funds" />,
  FundCreateRoute: () => <div data-testid="page-fund-create" />,
  FundWorkspaceRoute: () => <div data-testid="page-fund-workspace" />,
  InvestmentReviewsRoute: ({ tab }) => <div data-testid={`page-investment-reviews-${tab}`} />,
  ClientValuesRoute: ({ tab }) => <div data-testid={`page-client-values-${tab}`} />,
  AumRoute: ({ tab }) => <div data-testid={`page-aum-${tab}`} />,
  AppBuilderRoute: () => <div data-testid="page-app-builder" />,
  AuditLogRoute: () => <div data-testid="page-audit-log" />,
  EmailDeliveriesRoute: () => <div data-testid="page-email-deliveries" />,
  EnvironmentRoute: () => <div data-testid="page-environment" />,
}));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/*" element={<Admin />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Admin route table', () => {
  const routeCases = [
    ['/admin/overview', 'page-overview'],
    ['/admin/users/approvals', 'page-approvals'],
    ['/admin/users/directory', 'page-user-directory'],
    ['/admin/users/directory/u1', 'page-user-detail'],
    ['/admin/site/faqs', 'page-faqs'],
    ['/admin/app/builder', 'page-app-builder'],
    ['/admin/funds', 'page-funds'],
    ['/admin/funds/f1', 'page-fund-workspace'],
    ['/admin/reviews/awaiting', 'page-investment-reviews-awaiting'],
    ['/admin/reviews/accepted', 'page-investment-reviews-accepted'],
    ['/admin/reviews/refunds', 'page-investment-reviews-refunds'],
    ['/admin/client-values/detail', 'page-client-values-detail'],
    ['/admin/client-values/individual', 'page-client-values-individual'],
    ['/admin/client-values/collective', 'page-client-values-collective'],
    ['/admin/aum/current', 'page-aum-current'],
    ['/admin/aum/manage', 'page-aum-manage'],
    ['/admin/aum/collective', 'page-aum-collective'],
    ['/admin/aum/history', 'page-aum-history'],
    ['/admin/payments', 'page-payments'],
    ['/admin/audit', 'page-audit-log'],
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

describe('Admin retired-route redirects', () => {
  const redirectCases = [
    ['/admin/users/kyc', 'page-approvals'],
    ['/admin/users/risk-profiles', 'page-approvals'],
    ['/admin/users/subscriptions', 'page-investment-reviews-awaiting'],
    ['/admin/users/payments', 'page-payments'],
    ['/admin/ops/funds', 'page-funds'],
    ['/admin/ops/funds/f1', 'page-fund-workspace'],
    ['/admin/ops/redemptions', 'page-payments'],
    ['/admin/ops/transactions', 'page-payments'],
    ['/admin/ops/ledger', 'page-payments'],
    ['/admin/ops/sip-control', 'page-payments'],
    ['/admin/ops/holdings', 'page-aum-current'],
    ['/admin/system/support', 'page-audit-log'],
    ['/admin/system/audit-log', 'page-audit-log'],
    ['/admin/reviews', 'page-investment-reviews-awaiting'],
    ['/admin/client-values', 'page-client-values-detail'],
    ['/admin/aum', 'page-aum-current'],
  ];

  for (const [path, testId] of redirectCases) {
    test(`${path} still redirects to its replacement`, async () => {
      renderAt(path);
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    });
  }
});

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

describe('Admin permission gating', () => {
  afterEach(() => {
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: ALL_PERMISSIONS };
  });

  const gated = NAV_DOMAINS
    .flatMap((domain) => domain.items)
    .filter((item) => item.permissions.length > 0);

  test('there is at least one gated destination to check', () => {
    expect(gated.length).toBeGreaterThan(0);
  });

  for (const item of gated) {
    test(`${item.path} renders Forbidden without ${item.permissions.join(' or ')}`, async () => {
      mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: ['nothing.useful'] };
      renderAt(item.path);

      expect(await screen.findByTestId('page-forbidden')).toBeInTheDocument();
    });

    test(`${item.path} renders its screen with ${item.permissions[0]} plus its prerequisites`, async () => {
      mockAdminUser = {
        id: 'a1',
        role: 'admin',
        roles: ['admin'],
        permissions: [item.permissions[0], ...(item.requiresAll ?? [])],
      };
      renderAt(item.path);

      expect(await screen.findByTestId(/^page-/)).toBeInTheDocument();
      expect(screen.queryByTestId('page-forbidden')).not.toBeInTheDocument();
    });

    for (const prerequisite of item.requiresAll ?? []) {
      test(`${item.path} renders Forbidden without its ${prerequisite} prerequisite`, async () => {
        mockAdminUser = {
          id: 'a1',
          role: 'admin',
          roles: ['admin'],
          permissions: [
            item.permissions[0],
            ...(item.requiresAll ?? []).filter((code) => code !== prerequisite),
          ],
        };
        renderAt(item.path);

        expect(await screen.findByTestId('page-forbidden')).toBeInTheDocument();
      });
    }
  }

  test('Overview stays reachable for a principal with no permissions at all', async () => {
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: [] };
    renderAt('/admin/overview');

    expect(await screen.findByTestId('page-overview')).toBeInTheDocument();
  });

  test('Forbidden is distinct from Not Found', async () => {
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: [] };
    renderAt('/admin/audit');
    expect(await screen.findByTestId('page-forbidden')).toBeInTheDocument();
    expect(screen.queryByTestId('page-not-found')).not.toBeInTheDocument();
  });

  test('an unknown path is Not Found, not Forbidden, even with no permissions', async () => {
    mockAdminUser = { id: 'a1', role: 'admin', roles: ['admin'], permissions: [] };
    renderAt('/admin/no-such-page');
    expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('page-forbidden')).not.toBeInTheDocument();
  });
});
