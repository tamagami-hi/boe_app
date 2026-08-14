// Route tests for the app shell's top-level route table.
//
// Covers ClientRoot's `/` and `/login` compatibility aliases (which are
// deliberate and must stay) and its top-level unknown-path behavior, replaced in
// Task 3. The lazy ClientApp is mocked to a location probe; routing is the real
// module under test.
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClientRoot from './ClientRoot.jsx';

// `useSession` is needed by ClientCacheEvictor, which ClientRoot mounts inside the
// cache provider to drop cached data when the principal changes. An anonymous
// session is the right default here: these are routing tests.
vi.mock('@beonedge/client/store/SessionContext.jsx', () => ({
  SessionProvider: ({ children }) => children,
  useSession: () => ({ user: null, status: 'anonymous', isLoading: false, error: null }),
}));

vi.mock('@beonedge/client/ClientApp.jsx', async () => {
  const { useLocation } = await import('react-router-dom');
  return {
    default: function ClientAppProbe() {
      const location = useLocation();
      return <div data-testid="location">{location.pathname}</div>;
    },
  };
});

vi.mock('@beonedge/client/pages/NotFound.jsx', () => ({
  default: () => <div data-testid="page-not-found" />,
}));

vi.mock('./components/RootErrorBoundary.jsx', () => ({
  default: ({ children }) => children,
}));

function renderShellAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ClientRoot />
    </MemoryRouter>,
  );
}

describe('ClientRoot compatibility aliases', () => {
  test('/login redirects to /app/login', async () => {
    renderShellAt('/login');
    expect(await screen.findByTestId('location')).toHaveTextContent('/app/login');
  });

  test('/ redirects to /app/splash', async () => {
    renderShellAt('/');
    expect(await screen.findByTestId('location')).toHaveTextContent('/app/splash');
  });
});

describe('ClientRoot unknown-path handling', () => {
  // Task 3: any unknown top-level path used to redirect to `/app/splash`. The
  // concrete case this masked was a link missing the `/app` prefix — the
  // pre-fix disclosure targets `/investor-charter` and `/grievance` — which
  // presented to the user as the app restarting itself.
  test('unknown top-level path renders Not Found, not splash', async () => {
    renderShellAt('/totally-unknown');
    expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();
  });

  // The historical regression, asserted directly: an unprefixed disclosure path
  // must be diagnosable rather than silently swallowed.
  const unprefixedPaths = ['/investor-charter', '/grievance'];

  for (const path of unprefixedPaths) {
    test(`${path} (missing /app prefix) renders Not Found`, async () => {
      renderShellAt(path);
      expect(await screen.findByTestId('page-not-found')).toBeInTheDocument();
    });
  }
});
