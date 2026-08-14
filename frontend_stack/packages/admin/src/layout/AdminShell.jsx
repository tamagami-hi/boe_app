import { useState } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { useBreakpoint } from '@beonedge/shared';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import AdminMobileNav from './AdminMobileNav.jsx';
import AdminDomainStrip from './AdminDomainStrip.jsx';
import ToastProvider from '../components/ToastProvider.jsx';
import ApprovalsQueueProvider, { useApprovalsQueue } from '../data/ApprovalsQueueProvider.jsx';
import AdminCacheEvictor from '../data/AdminCacheEvictor.jsx';
import { findNavMeta } from '../navigation/nav.js';
import I from '../components/I.jsx';

const MOBILE_BREAKPOINT = 768;

function ShellFrame() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAdminSession();
  /*
   * The only shell-wide data left: the sidebar badge, so an operator on any screen
   * sees a new sign-up arrive. What used to be here fetched six collections on
   * mount of every admin route.
   */
  const { approvals } = useApprovalsQueue();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const meta = findNavMeta(location.pathname);
  // The phone gets a different information architecture, not a squeezed sidebar:
  // see AdminMobileNav. Rendering both and hiding one in CSS is what produced the
  // 13-destination scrolling strip, so the choice is made here instead.
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
        <TopBar title={meta.title} breadcrumbs={meta.crumbs} crumbPaths={meta.crumbPaths} onLogout={handleLogout} />
        {isMobile && <AdminDomainStrip user={user} />}
        {/* The global loadNote banner is gone with the provider that produced it;
            each screen now reports its own read failure via AdminReadError. */}
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
        {/* Clears cached admin collections when the operator changes or signs out. */}
        <AdminCacheEvictor />
        <ShellFrame />
      </ApprovalsQueueProvider>
    </ToastProvider>
  );
}
