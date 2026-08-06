import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { SessionProvider } from '@beonedge/client/store/SessionContext.jsx';
import { AdminSessionProvider, useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { RouteErrorBoundary } from '@beonedge/shared/components/RouteErrorBoundary.jsx';
import PageLoader from './components/PageLoader.jsx';
import RootErrorBoundary from './components/RootErrorBoundary.jsx';

const Admin = lazy(() => import('@beonedge/admin/pages/Admin.jsx'));
const AdminLogin = lazy(() => import('@beonedge/admin/pages/AdminLogin.jsx'));
const AdminSplash = lazy(() => import('@beonedge/admin/pages/AdminSplash.jsx'));

function hasRole(user, role) {
  const expected = role.toLowerCase();
  return (
    String(user?.role || '').toLowerCase() === expected ||
    String(user?.accountType || '').toLowerCase() === expected ||
    user?.roles?.some((value) => String(value).toLowerCase() === expected)
  );
}

function RequireAdmin({ children }) {
  const { user, isLoading } = useAdminSession();
  const location = useLocation();

  if (isLoading) return null;

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
    <SessionProvider>
      <AdminSessionProvider>
        <RootErrorBoundary>
          <Routes>
            <Route path="/" element={<Navigate to="/admin/splash" replace />} />
            <Route path="/admin/splash" element={<Page><RouteErrorBoundary><AdminSplash /></RouteErrorBoundary></Page>} />
            <Route path="/admin/login" element={<Page><RouteErrorBoundary><AdminLogin /></RouteErrorBoundary></Page>} />
            <Route path="/admin/*" element={<RequireAdmin><Page><RouteErrorBoundary><Admin /></RouteErrorBoundary></Page></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/admin/splash" replace />} />
          </Routes>
        </RootErrorBoundary>
      </AdminSessionProvider>
    </SessionProvider>
  );
}
