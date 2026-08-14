import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import logo from '@beonedge/shared/assets/logo.svg';
import { visibleNavDomains } from '../navigation/nav.js';
import { initials, displayRole } from '../helpers/formatters.js';
import I from '../components/I.jsx';

const OPEN_GROUPS_KEY = 'boe.admin.nav.openGroups';

function readOpenGroups() {
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // localStorage unavailable: fall through to defaults
  }
  return {};
}

function persistOpenGroups(next) {
  try {
    window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
  } catch {
    // best effort only
  }
}

// Desktop only. AdminShell does not mount the sidebar on a phone at all, so the
// former `mobile` variant of this chip (a pill that shared the horizontal nav
// scroller with the destinations) is gone.
function AdminUserChip({ user, collapsed = false, className = '' }) {
  const displayName = user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Admin';

  return (
    <div className={`ash-side-user ${collapsed ? 'is-collapsed' : ''} ${className}`} aria-label="Signed in as">
      <div className="ash-avatar">{user?.avatarInitials || initials(displayName)}</div>
      {!collapsed && (
        <div className="ash-side-user-meta">
          <div className="ash-side-user-name">{displayName}</div>
          <div className="ash-side-user-role">{displayRole(user)}</div>
        </div>
      )}
    </div>
  );
}

function SidebarGroup({ domain, counts, isOpen, onToggle, isCollapsed }) {
  const isSingleItem = domain.items.length === 1;

  if (isSingleItem) {
    const item = domain.items[0];
    return (
      <div className="ash-nav-group">
        <SidebarItem item={item} counts={counts} />
      </div>
    );
  }

  return (
    <div className="ash-nav-group">
      {!isCollapsed && (
        <button
          type="button"
          className="ash-nav-group-toggle"
          aria-expanded={isOpen}
          onClick={onToggle}
        >
          <span>{domain.label}</span>
          <I icon={ChevronDown} size={13} className={`ash-nav-chevron ${isOpen ? 'is-open' : 'is-collapsed'}`} />
        </button>
      )}
      {(isOpen || isCollapsed) && domain.items.map((item) => (
        <SidebarItem key={item.path} item={item} counts={counts} />
      ))}
    </div>
  );
}

function SidebarItem({ item, counts }) {
  const count = item.badge ? Number(counts[item.badge]) : 0;
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) => `ash-nav-item ${isActive ? 'is-active' : ''}`}
    >
      {item.icon && <I icon={item.icon} size={15} />}
      <span className="ash-nav-item-label">{item.label}</span>
      {count > 0 && <span className="ash-nav-count">{count}</span>}
    </NavLink>
  );
}

export default function Sidebar({ user, counts = {}, collapsed = false }) {
  const [openGroups, setOpenGroups] = useState(readOpenGroups);
  const isCollapsed = collapsed;

  // Only destinations this principal can actually use, and only domains that
  // still have items. The sidebar previously rendered all 13 destinations to
  // every admin, so a limited role was invited into screens whose every request
  // returns 403 — the operator learns their permissions by hitting errors.
  //
  // Presentation only: the backend enforces the same codes and remains the
  // authority. Direct URLs are handled by the route gate, which renders Forbidden.
  const domains = useMemo(() => visibleNavDomains(user), [user]);

  function toggleGroup(domainId) {
    setOpenGroups((prev) => {
      const next = { ...prev, [domainId]: prev[domainId] === false };
      persistOpenGroups(next);
      return next;
    });
  }

  return (
    <aside className={`ash-side ${isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="ash-brand">
        <img src={logo} height="22" alt="BeOnEdge" />
        <span className="ash-brand-tag">ADMIN</span>
      </div>
      <nav className="ash-nav" aria-label="Admin sections">
        {domains.map((domain) => (
          <SidebarGroup
            key={domain.id}
            domain={domain}
            counts={counts}
            isOpen={openGroups[domain.id] !== false}
            onToggle={() => toggleGroup(domain.id)}
            isCollapsed={isCollapsed}
          />
        ))}
      </nav>
      <div className="ash-side-foot">
        <AdminUserChip user={user} collapsed={isCollapsed} />
      </div>
    </aside>
  );
}
