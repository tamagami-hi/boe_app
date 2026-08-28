import React, { lazy, Suspense } from 'react';
import { resolveClientBackPolicy } from '@beonedge/client/navigation/backPolicy.js';
import * as clientAuthApi from '@beonedge/client/services/authApi.js';
import { Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from '@beonedge/client/store/SessionContext.jsx';
import { RouteErrorBoundary } from '@beonedge/shared/components/RouteErrorBoundary.jsx';
import { ResourceCacheProvider } from '@beonedge/shared/data/ResourceCacheProvider.jsx';
import ClientCacheEvictor from '@beonedge/client/data/ClientCacheEvictor.jsx';
import PageLoader from './components/PageLoader.jsx';
import RootErrorBoundary from './components/RootErrorBoundary.jsx';
import { CheckoutProvider, PendingPaymentRecovery } from '@beonedge/client/payments/CheckoutProvider.jsx';

const ClientApp = lazy(() => import('@beonedge/client/ClientApp.jsx'));
const NotFound = lazy(() => import('@beonedge/client/pages/NotFound.jsx'));

const Page = ({ children }) => (
  <Suspense fallback={<PageLoader />}>
    {children}
  </Suspense>
);

export default function ClientRoot() {
  return (
    <SessionProvider>
      <CheckoutProvider>
      {/*
        One cache for the whole client surface, above the routes so a tab switch
        reuses what the previous visit fetched instead of re-issuing it. Inside
        SessionProvider so a signed-out session tears the cache down with it.
      */}
      <ResourceCacheProvider>
      {/*
        Clears the cache when the signed-in principal changes or signs out. A cache
        that outlives its session would let the next user see the previous one's
        figures.
      */}
      <ClientCacheEvictor />
      <PendingPaymentRecovery />
      <RootErrorBoundary>
        <Routes>
          {/* Compatibility aliases — deliberate, and covered by ClientRoot.test.jsx. */}
          <Route path="/" element={<Navigate to="/app/splash" replace />} />
          <Route path="/login" element={<Navigate to="/app/login" replace />} />
          <Route path="/app/*" element={<Page><RouteErrorBoundary><ClientApp /></RouteErrorBoundary></Page>} />
          {/*
            Anything else is a genuine dead end. It used to redirect to
            `/app/splash`, so a stale link — e.g. the pre-fix disclosure targets
            `/investor-charter` and `/grievance`, which lacked the `/app` prefix
            — presented as the app restarting itself.

            No `/app`-prefix guessing here on purpose: that needs the canonical
            route manifest to decide what a "known" path is, and hardcoding a
            second list of routes would be the same drift this plan is removing.
            Not Found is the honest answer until the manifest lands.
          */}
          <Route path="*" element={<Page><RouteErrorBoundary><NotFound /></RouteErrorBoundary></Page>} />
        </Routes>
      </RootErrorBoundary>
      </ResourceCacheProvider>
      </CheckoutProvider>
    </SessionProvider>
  );
}

/*
 * Navigation policy and connectivity probe for this target, exported here so
 * main.jsx imports ONE module per build target. Importing them separately made the
 * unused target's subtree statically reachable, and the client APK shipped the
 * admin chunk and stylesheet.
 */
export const backPolicy = resolveClientBackPolicy;

/**
 * Reuses the same reachability check the splash performs, so the connectivity
 * provider and the launch screen cannot disagree about whether the backend is up.
 */
export async function probeReachability() {
  const result = await clientAuthApi.checkReachability();
  return Boolean(result?.ok);
}
