import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from '@beonedge/client/store/SessionContext.jsx';
import { RouteErrorBoundary } from '@beonedge/shared/components/RouteErrorBoundary.jsx';
import PageLoader from './components/PageLoader.jsx';
import RootErrorBoundary from './components/RootErrorBoundary.jsx';

const ClientApp = lazy(() => import('@beonedge/client/ClientApp.jsx'));

const Page = ({ children }) => (
  <Suspense fallback={<PageLoader />}>
    {children}
  </Suspense>
);

export default function ClientRoot() {
  return (
    <SessionProvider>
      <RootErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/app/splash" replace />} />
          <Route path="/login" element={<Navigate to="/app/login" replace />} />
          <Route path="/app/*" element={<Page><RouteErrorBoundary><ClientApp /></RouteErrorBoundary></Page>} />
          <Route path="*" element={<Navigate to="/app/splash" replace />} />
        </Routes>
      </RootErrorBoundary>
    </SessionProvider>
  );
}
