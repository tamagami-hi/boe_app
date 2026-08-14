import React, { lazy, Suspense } from 'react';
import { resolveAdminBackPolicy } from '@beonedge/admin/navigation/backPolicy.js';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AdminSessionProvider, useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { SESSION_STATUS } from '@beonedge/client/store/sessionState.js';
import { RouteErrorBoundary } from '@beonedge/shared/components/RouteErrorBoundary.jsx';
import { ResourceCacheProvider } from '@beonedge/shared/data/ResourceCacheProvider.jsx';
import BootstrapShell from '@beonedge/shared/components/BootstrapShell.jsx';
import PageLoader from './components/PageLoader.jsx';
import RootErrorBoundary from './components/RootErrorBoundary.jsx';

const Admin = lazy(() => import('@beonedge/admin/pages/Admin.jsx'));
const AdminLogin = lazy(() => import('@beonedge/admin/pages/AdminLogin.jsx'));
const AdminSplash = lazy(() => import('@beonedge/admin/pages/AdminSplash.jsx'));
const AdminNotFound = lazy(() => import('@beonedge/admin/pages/NotFound.jsx'));

function hasRole(user, role) {
  const expected = role.toLowerCase();
  return (
    String(user?.role || '').toLowerCase() === expected ||
    String(user?.accountType || '').toLowerCase() === expected ||
    user?.roles?.some((value) => String(value).toLowerCase() === expected)
  );
}

function RequireAdmin({ children }) {
  const { user, status } = useAdminSession();
  const location = useLocation();

  // Was `if (isLoading) return null` — a blank console during every session
  // restore. A stable branded surface instead, so the app never appears to vanish.
  if (status === SESSION_STATUS.RESTORING) return <BootstrapShell label="Restoring your session" />;

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/admin/login?from=${redirect}`} replace />;
  }

  if (!hasRole(user, 'admin')) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}

const Page = ({ children }) => (
  <Suspense fallback={<PageLoader />}>
    {children}
  </Suspense>
);

export default function BrowserRoot() {
  return (
    // The client `SessionProvider` used to be mounted here as well. Nothing in the
    // admin package calls `useSession` — verified by search — so all it did was
    // fire an unused client-scope `currentUser` request on every admin load and
    // add a second restore to race with the admin one.
    <AdminSessionProvider>
      {/* One cache for the admin surface — the same contract the client uses, so
          the admin screens can stop each owning their own request state. */}
      <ResourceCacheProvider>
      <RootErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/splash" replace />} />
          <Route path="/admin/splash" element={<Page><RouteErrorBoundary><AdminSplash /></RouteErrorBoundary></Page>} />
          <Route path="/admin/login" element={<Page><RouteErrorBoundary><AdminLogin /></RouteErrorBoundary></Page>} />
          <Route path="/admin/*" element={<RequireAdmin><Page><RouteErrorBoundary><Admin /></RouteErrorBoundary></Page></RequireAdmin>} />
          {/*
            A non-`/admin` path in the admin build is a genuine dead end, not a
            reason to relaunch at splash. Rendered standalone: the admin shell is
            deliberately not mounted here, because that would require an admin
            session and its data bootstrap just to report a bad URL.
          */}
          <Route path="*" element={<Page><RouteErrorBoundary><AdminNotFound standalone /></RouteErrorBoundary></Page>} />
        </Routes>
      </RootErrorBoundary>
      </ResourceCacheProvider>
    </AdminSessionProvider>
  );
}

/*
 * Navigation policy for this target — see the note in ClientRoot.jsx about why this
 * is exported from the root module rather than imported separately by main.jsx.
 *
 * No `probeReachability`: the admin console is served same-origin in the browser and
 * the admin APK's own reachability is covered by its session restore, so there is
 * nothing extra worth a round trip here.
 */
export const backPolicy = resolveAdminBackPolicy;
