import { Suspense, useState } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { useBreakpoint } from '@beonedge/shared';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import AdminMobileNav from './AdminMobileNav.jsx';
import AdminDomainStrip from './AdminDomainStrip.jsx';
import PageHeadingProvider, { usePageHeading } from './PageHeading.jsx';
import ToastProvider from '../components/ToastProvider.jsx';
import ApprovalsQueueProvider, { useApprovalsQueue } from '../data/ApprovalsQueueProvider.jsx';
import AdminCacheEvictor from '../data/AdminCacheEvictor.jsx';
import { findNavMeta } from '../navigation/nav.js';
import I from '../components/I.jsx';

const MOBILE_BREAKPOINT = 768;

function RouteFallback() {
  return (
    <div className="be-page is-padded" role="status" aria-label="Loading">
      <div className="adm-card be-pad-5 be-stack-2">
        <Skeleton width="30%" height="1.25rem" />
        <Skeleton width="100%" height="3rem" count={3} />
      </div>
    </div>
  );
}

function ShellFrame() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAdminSession();
  const { approvals } = useApprovalsQueue();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const meta = findNavMeta(location.pathname);
  const pageHeading = usePageHeading();
  const title = pageHeading?.title || meta.title;
  const crumbs = pageHeading?.crumb ? [...meta.crumbs, pageHeading.crumb] : meta.crumbs;
  const crumbPaths = pageHeading?.crumb
    ? [...meta.crumbPaths, location.pathname]
    : meta.crumbPaths;
  const isMobile = useBreakpoint(MOBILE_BREAKPOINT);
  const counts = { approvals: approvals.length };

  async function handleLogout() {
    await logout();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div
      className={`ash-app ${navCollapsed ? 'is-nav-collapsed' : ''} ${isMobile ? 'is-mobile' : ''}`}
      data-screen-label="Admin Console"
    >
      {!isMobile && (
        <>
          <Sidebar user={user} counts={counts} collapsed={navCollapsed} />
          <button
            type="button"
            className="ash-nav-collapse"
            onClick={() => setNavCollapsed((value) => !value)}
            aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!navCollapsed}
          >
            <I icon={navCollapsed ? PanelLeftOpen : PanelLeftClose} size={14} />
          </button>
        </>
      )}
      <main className="ash-main">
        <TopBar title={title} breadcrumbs={crumbs} crumbPaths={crumbPaths} onLogout={handleLogout} />
        {isMobile && <AdminDomainStrip user={user} />}
        {}
        <Outlet />
      </main>
      {isMobile && <AdminMobileNav user={user} counts={counts} />}
    </div>
  );
}

export default function AdminShell() {
  return (
    <ToastProvider>
      <ApprovalsQueueProvider>
        {}
        <AdminCacheEvictor />
        <PageHeadingProvider>
          <ShellFrame />
        </PageHeadingProvider>
      </ApprovalsQueueProvider>
    </ToastProvider>
  );
}
