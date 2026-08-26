import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../store/SessionContext.jsx';
import Blocked from '../pages/Blocked.jsx';
import BottomNav from './BottomNav.jsx';
import AppLockGate from '../components/AppLockGate.jsx';
import { isTerminalAccount } from '../utils/approval.js';
import { findRouteMeta, showsBottomNav as routeShowsBottomNav } from '../navigation/routes.js';
import { SESSION_STATUS } from '../store/sessionState.js';
import { BootstrapShell, PageTransition } from '@beonedge/shared';
import { hasRole } from '@beonedge/shared/auth/roles.js';

export default function ClientLayout(props) {
  const { user, status, logout } = useSession();
  const location = useLocation();
  const path = location.pathname;
  // Public routes come from the manifest's `isPublic` flag rather than a second
  // list of path literals to keep in sync.
  const isPublic = findRouteMeta(path)?.isPublic === true;

  if (isPublic) {
    return (
      <PageTransition>
        <Outlet />
      </PageTransition>
    );
  }

  // Was `return null`, which blanked the whole app on every cold start — on a
  // phone that is indistinguishable from the app crashing and relaunching. A
  // stable branded surface keeps the launch sequence continuous instead.
  if (status === SESSION_STATUS.RESTORING) {
    return <BootstrapShell label="Restoring your session" />;
  }

  if (!user) {
    const redirect = encodeURIComponent(path + location.search);
    return <Navigate to={`/app/login?from=${redirect}`} replace />;
  }

  if (hasRole(user, 'admin')) {
    return <Navigate to="/admin" replace />;
  }

  if (!hasRole(user, 'client')) {
    return <Navigate to="/app/login" replace />;
  }

  if (isTerminalAccount(user)) {
    // Terminal accounts are confined to Blocked plus the routes Blocked's own
    // actions need: Support, so "Contact support" is actually reachable. (The
    // other action, logout, is handled inside Blocked itself.) Every other
    // route — including all financial content — keeps rendering Blocked.
    //
    // The exception list is a route-manifest flag rather than a path literal
    // here, so adding a terminal-reachable screen is a one-line manifest change
    // instead of a second place to keep in sync.
    const isAllowedTerminalRoute = findRouteMeta(path)?.allowTerminalAccount === true;
    return (
      <div className="app-shell app-shell-single" {...props}>
        <main className="app-main">
          {isAllowedTerminalRoute ? <Outlet /> : <Blocked />}
        </main>
      </div>
    );
  }

  // Explicit per-route metadata, not prefix matching. Prefix matching was wrong
  // in both directions: it kept the bar on `/app/profile/{kyc,security,support,
  // legal}` — pushed secondary screens — while hiding it on Statements and
  // Notifications, which sit at the same level of the same hierarchy.
  const showBottomNav = routeShowsBottomNav(path);

  return (
    <AppLockGate user={user} logout={logout}>
      <div className="app-shell" {...props}>
        <main className={showBottomNav ? 'app-main app-main--nav' : 'app-main'}>
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>

        {showBottomNav && <BottomNav />}
      </div>
    </AppLockGate>
  );
}
