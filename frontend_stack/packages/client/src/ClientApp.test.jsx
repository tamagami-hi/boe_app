// Route tests for the Client build target.
//
// Tasks 1–3: originally written to freeze the pre-refactor route table, now
// updated to assert post-Task-3 behavior. Page components are mocked to markers;
// routing, guards and layout are the real modules under test.
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ClientApp from './ClientApp.jsx';
import { CLIENT_ROUTES, CLIENT_ROUTE_ALIASES, buildPath } from './navigation/routes.js';

/* ---- collaborator mocks (pages render markers, guards are deterministic) ---- */

vi.mock('./store/SessionContext.jsx', () => ({
  useSession: () => ({
    user: { id: 'u1', role: 'client' },
    isLoading: false,
    logout: async () => {},
  }),
}));

vi.mock('./services/eligibilityApi.js', () => ({
  getInvestingEligibility: async () => ({ canInvest: true }),
}));

vi.mock('./components/AppUpdateGate.jsx', () => ({ default: () => null }));
vi.mock('./components/AppLockGate.jsx', () => ({ default: ({ children }) => children }));
vi.mock('./pages/Blocked.jsx', () => ({ default: () => <div data-testid="page-blocked" /> }));

vi.mock('@beonedge/shared', () => ({
  PageTransition: ({ children }) => children,
}));
vi.mock('@beonedge/shared/components/RouteErrorBoundary.jsx', () => ({
  RouteErrorBoundary: ({ children }) => children,
}));

/* ---- page markers: one mock per page module imported by ClientApp ---- */

vi.mock('./pages/Splash.jsx', () => ({ default: () => <div data-testid="page-splash" /> }));
vi.mock('./pages/Login.jsx', () => ({ default: () => <div data-testid="page-login" /> }));
vi.mock('./pages/KycVerify.jsx', () => ({ default: () => <div data-testid="page-kyc-verify" /> }));
vi.mock('./pages/Dashboard.jsx', () => ({ default: () => <div data-testid="page-dashboard" /> }));
vi.mock('./pages/Explore.jsx', () => ({ default: () => <div data-testid="page-explore" /> }));
vi.mock('./pages/FundDetail.jsx', () => ({ default: () => <div data-testid="page-fund-detail" /> }));
vi.mock('./pages/StartSipSheet.jsx', () => ({ default: () => <div data-testid="page-start-sip" /> }));
vi.mock('./pages/LumpsumSheet.jsx', () => ({ default: () => <div data-testid="page-lumpsum" /> }));
vi.mock('./pages/PaymentStatus.jsx', () => ({ default: () => <div data-testid="page-payment-status" /> }));
vi.mock('./pages/MandateDetail.jsx', () => ({ default: () => <div data-testid="page-mandate-detail" /> }));
vi.mock('./pages/Portfolio.jsx', () => ({ default: () => <div data-testid="page-portfolio" /> }));
vi.mock('./pages/Transactions.jsx', () => ({ default: () => <div data-testid="page-transactions" /> }));
vi.mock('./pages/Statements.jsx', () => ({ default: () => <div data-testid="page-statements" /> }));
vi.mock('./pages/Notifications.jsx', () => ({ default: () => <div data-testid="page-notifications" /> }));
vi.mock('./pages/Profile.jsx', () => ({ default: () => <div data-testid="page-profile" /> }));
vi.mock('./pages/KycDetail.jsx', () => ({ default: () => <div data-testid="page-kyc-detail" /> }));
vi.mock('./pages/Security.jsx', () => ({ default: () => <div data-testid="page-security" /> }));
vi.mock('./pages/Support.jsx', () => ({ default: () => <div data-testid="page-support" /> }));
vi.mock('./pages/Legal.jsx', () => ({ default: () => <div data-testid="page-legal" /> }));
vi.mock('./pages/InvestorCharter.jsx', () => ({ default: () => <div data-testid="page-investor-charter" /> }));
vi.mock('./pages/GrievanceRedressal.jsx', () => ({ default: () => <div data-testid="page-grievance" /> }));
vi.mock('./pages/NotFound.jsx', () => ({ default: () => <div data-testid="page-not-found" /> }));

/* ---- helpers ---- */

// ClientApp is mounted under `/app/*` by the app shell (ClientRoot), exactly as
// in production.
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/*" element={<ClientApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

/* ---- route table freeze ---- */

describe('ClientApp route table', () => {
  const routeCases = [
    ['/app/splash', 'page-splash'],
    ['/app/login', 'page-login'],
    ['/app/verify-email', 'page-kyc-verify'],
    ['/app/dashboard', 'page-dashboard'],
    ['/app/explore', 'page-explore'],
    ['/app/funds/f1', 'page-fund-detail'],
    ['/app/invest/sip/f1', 'page-start-sip'],
    ['/app/invest/lumpsum/f1', 'page-lumpsum'],
    ['/app/payment/p1', 'page-payment-status'],
    ['/app/mandates/m1', 'page-mandate-detail'],
    ['/app/portfolio', 'page-portfolio'],
    ['/app/transactions', 'page-transactions'],
    ['/app/statements', 'page-statements'],
    ['/app/notifications', 'page-notifications'],
    ['/app/profile', 'page-profile'],
    ['/app/profile/kyc', 'page-kyc-detail'],
    ['/app/profile/security', 'page-security'],
    ['/app/profile/support', 'page-support'],
    ['/app/profile/legal', 'page-legal'],
    ['/app/investor-charter', 'page-investor-charter'],
    ['/app/grievance', 'page-grievance'],
  ];

  for (const [path, testId] of routeCases) {
    test(`${path} renders its page`, async () => {
      renderAt(path);
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
    });
  }
});

describe('ClientApp compatibility aliases', () => {
  test('/app redirects to splash (index route)', async () => {
    renderAt('/app');
    expect(await screen.findByTestId('page-splash')).toBeInTheDocument();
  });

  // `/app/start` is a dashboard compatibility alias. It previously used a
  // route-relative `<Navigate to="dashboard">` that resolved to
  // `/app/start/dashboard` and fell through to splash; Task 2 fixed it to an
  // absolute `/app/dashboard` navigate.
  test('/app/start redirects to the dashboard', async () => {
    renderAt('/app/start');
    expect(await screen.findByTestId('page-dashboard')).toBeInTheDocument();
  });
});

/* ---- manifest / router agreement ------------------------------------------ */

describe('route manifest matches the mounted router', () => {
  // A manifest that drifts from the real route table is worse than none, because
  // the shell, the back coordinator and the destination resolver all start
  // trusting it. Every manifest entry must therefore resolve to a real page —
  // never to Not Found.
  const sampleParams = { fundId: 'f1', paymentId: 'p1', mandateId: 'm1' };

  for (const route of CLIENT_ROUTES) {
    const path = buildPath(route.destinationId, sampleParams);

    test(`${route.destinationId} (${route.path}) is mounted`, async () => {
      renderAt(path);
      // A page marker rendered means the router matched a real route. Waiting on
      // the absence of NotFound alone would pass while still loading, so assert
      // NotFound is absent after the tree has settled on some marker.
      await screen.findByTestId(/^page-/);
      expect(screen.queryByTestId('page-not-found')).not.toBeInTheDocument();
    });
  }

  test('every alias resolves to a mounted route', async () => {
    for (const [alias, target] of Object.entries(CLIENT_ROUTE_ALIASES)) {
      const { unmount } = renderAt(alias);
      await screen.findByTestId(/^page-/);
      expect(screen.queryByTestId('page-not-found')).not.toBeInTheDocument();
      expect(target.startsWith('/app/')).toBe(true);
      unmount();
    }
  });
});

describe('ClientApp unknown-route handling', () => {
  // Task 3: unknown `/app/*` paths used to redirect to `/app/splash`, which in
  // the APK is indistinguishable from the app relaunching. They now render a
  // recoverable Not Found inside the shell.
  test('unknown /app/* path renders Not Found, not splash', async () => {
    renderAt('/app/this-route-does-not-exist');
    expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('page-splash')).not.toBeInTheDocument();
  });

  // `/app/orders` never existed as a route; MandateDetail's stale link to it was
  // retargeted to `/app/portfolio` in Task 2. If any other stale reference to it
  // survives, it must surface as Not Found rather than as a silent relaunch.
  test('/app/orders renders Not Found', async () => {
    renderAt('/app/orders');
    expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
  });

  // Plan §O "Route tests — Client": invalid/missing dynamic IDs must not reach
  // splash either. An empty dynamic segment matches no route, so each of these
  // falls to the wildcard.
  const missingIdCases = [
    '/app/funds/',
    '/app/payment/',
    '/app/invest/sip/',
    '/app/invest/lumpsum/',
    '/app/mandates/',
  ];

  for (const path of missingIdCases) {
    test(`${path} (missing dynamic id) renders Not Found`, async () => {
      renderAt(path);
      expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
      expect(screen.queryByTestId('page-splash')).not.toBeInTheDocument();
    });
  }
});
