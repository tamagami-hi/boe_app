import {
  LayoutDashboard, UserCheck, Users, CreditCard, Repeat,
  HelpCircle,
  Layers, PieChart, History, BookOpen, Inbox, RotateCcw,
  LayoutGrid, Settings,
} from 'lucide-react';

// Single source of truth for the admin information architecture.
// Sidebar groups, breadcrumbs, page titles and permission gating all derive from
// this tree.
//
// `permissions` is a REQUIRED-ANY list, mirroring the backend's
// `requireAnyPermission(principal, [...])`. The codes are copied from the actual
// route handlers in backend_controller/src/routes/admin*Routes.ts — not invented —
// so a destination is hidden exactly when every call it would make returns 403.
//
// THIS GATING IS PRESENTATION ONLY. The backend is the authority and enforces the
// same codes on every request. Hiding a nav entry is a courtesy so an operator is
// not sent to a screen that can only fail; it is not a security boundary, and
// nothing here may ever be treated as one. An empty list means "any admin".

export const NAV_DOMAINS = [
  {
    id: 'overview',
    label: 'Overview',
    // `mobile` drives the phone information architecture. Four domain entries sit
    // on the bottom bar; everything else is reached through More. The console used
    // to put all 13 destinations in ONE horizontally scrolling strip at 40px
    // targets, so finding a screen meant scrolling a bar you could not see the end
    // of. See AdminMobileNav.
    mobile: { primary: true, order: 1, shortLabel: 'Overview', icon: LayoutDashboard },
    items: [
      {
        path: '/admin/overview',
        label: 'Overview',
        icon: LayoutDashboard,
        title: 'Overview',
        // The landing page. It aggregates whatever counts the principal is allowed
        // to read and degrades per widget, so it must never be hidden — hiding it
        // would leave a limited admin with no entry point at all.
        permissions: [],
      },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    mobile: { primary: true, order: 2, shortLabel: 'Users', icon: Users },
    items: [
      {
        path: '/admin/users/approvals',
        label: 'Approvals',
        icon: UserCheck,
        badge: 'approvals',
        title: 'User approvals',
        // Reading the queue needs applications.read; deciding needs
        // applications.decide, which the screen's own actions check.
        permissions: ['applications.read'],
      },
      {
        path: '/admin/users/subscriptions',
        label: 'Subscriptions',
        icon: Repeat,
        title: 'Subscriptions',
        permissions: ['finance.read'],
      },
      {
        path: '/admin/users/payments',
        label: 'Payments',
        icon: CreditCard,
        title: 'Payments',
        permissions: ['finance.read'],
      },
      {
        path: '/admin/users/directory',
        label: 'Directory',
        icon: Users,
        title: 'User directory',
        permissions: ['users.read', 'users.read_limited'],
      },
    ],
  },
  {
    id: 'site',
    label: 'Support Content',
    mobile: { primary: false, shortLabel: 'Content', icon: HelpCircle },
    items: [
      {
        path: '/admin/site/faqs',
        label: 'FAQs',
        icon: HelpCircle,
        title: 'FAQs',
        permissions: ['content.read', 'content.publish'],
      },
    ],
  },
  {
    id: 'app',
    label: 'App Management',
    mobile: { primary: false, shortLabel: 'App', icon: LayoutGrid },
    items: [
      {
        path: '/admin/app/builder',
        label: 'App builder',
        icon: LayoutGrid,
        title: 'App builder',
        permissions: ['config.read', 'config.publish'],
      },
    ],
  },
  {
    id: 'ops',
    label: 'Operations',
    mobile: { primary: true, order: 3, shortLabel: 'Ops', icon: Layers },
    items: [
      {
        path: '/admin/ops/funds',
        label: 'AUM pools',
        icon: Layers,
        title: 'AUM pools',
        permissions: ['funds.read', 'finance.read'],
      },
      {
        path: '/admin/ops/holdings',
        label: 'Holdings',
        icon: PieChart,
        title: 'Holdings',
        permissions: ['funds.read', 'finance.read'],
      },
      {
        path: '/admin/ops/transactions',
        label: 'Transactions',
        icon: BookOpen,
        title: 'Transactions',
        permissions: ['finance.read'],
      },
      {
        // Was a tab inside the fund editor. Releasing money is its own task, and
        // burying it three levels down is why it was hard to find.
        path: '/admin/ops/redemptions',
        label: 'Withdrawals',
        icon: RotateCcw,
        title: 'Redemption requests',
        permissions: ['finance.read'],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    mobile: { primary: false, shortLabel: 'System', icon: Settings },
    items: [
      {
        path: '/admin/system/audit-log',
        label: 'Audit log',
        icon: History,
        title: 'Audit log',
        permissions: ['audit.read'],
      },
      {
        path: '/admin/system/emails',
        label: 'Email log',
        icon: Inbox,
        title: 'Email deliveries',
        permissions: ['email_deliveries.read', 'email_deliveries.read_masked'],
      },
      {
        path: '/admin/system/environment',
        label: 'Environment',
        icon: Settings,
        title: 'Environment',
        permissions: ['config.read', 'config.publish'],
      },
    ],
  },
];

// Fallback for a pathname that matches no nav item. It must NOT claim to be
// Overview: the shell renders Not Found for unknown paths, and a TopBar reading
// "Overview" over a Not Found body is the same silent-redirect confusion in a
// different place. `/admin` itself lands here for the one render before
// LegacyTabRedirect resolves, so the copy stays neutral rather than alarming.
const DEFAULT_META = {
  title: 'Admin console',
  crumbs: ['BeOnEdge'],
  crumbPaths: ['/admin/overview'],
};

export function findNavMeta(pathname) {
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.items) {
      if (pathname === item.path || pathname.startsWith(`${item.path}/`)) {
        const crumbs = domain.id === 'overview'
          ? ['BeOnEdge', item.label]
          : ['BeOnEdge', domain.label, item.label];
        const domainPath = domain.items[0]?.path || '/admin/overview';
        const crumbPaths = domain.id === 'overview'
          ? ['/admin/overview', item.path]
          : ['/admin/overview', domainPath, item.path];
        return { title: item.title, crumbs, crumbPaths, domainId: domain.id, item };
      }
    }
  }
  return DEFAULT_META;
}

/* -------------------------------------------------------------------------- */
/* permissions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Does this principal hold at least one of `codes`?
 *
 * Mirrors the backend's `requireAnyPermission` semantics exactly: OR across the
 * list, and FAIL CLOSED on a missing or malformed permissions array. An empty
 * `codes` means the destination has no permission requirement.
 *
 * Note the role check cannot substitute for this: `authApi.toAdminUser` injects
 * `'admin'` into `roles` unconditionally, so every admin principal passes a role
 * test. Permissions are the only meaningful distinction on the frontend.
 */
export function hasAnyPermission(user, codes) {
  if (!Array.isArray(codes) || codes.length === 0) return true;
  const held = Array.isArray(user?.permissions) ? user.permissions : [];
  if (held.length === 0) return false;
  return codes.some((code) => held.includes(code));
}

/** Can this principal reach the destination that owns `pathname`? */
export function canAccessPath(user, pathname) {
  const meta = findNavMeta(pathname);
  // An unmatched path has no permission requirement to check — it is Not Found,
  // which is a different answer from Forbidden and must not be conflated.
  if (!meta.item) return true;
  return hasAnyPermission(user, meta.item.permissions);
}

/**
 * The nav tree with unauthorised items removed, and domains that end up empty
 * dropped entirely — an expandable group containing nothing is worse than no
 * group.
 */
export function visibleNavDomains(user) {
  return NAV_DOMAINS
    .map((domain) => ({ ...domain, items: domain.items.filter((item) => hasAnyPermission(user, item.permissions)) }))
    .filter((domain) => domain.items.length > 0);
}

/** Every permission code referenced by the tree. Used by tests and tooling. */
export function allNavPermissions() {
  return [...new Set(NAV_DOMAINS.flatMap((d) => d.items.flatMap((i) => i.permissions)))].sort();
}

/* -------------------------------------------------------------------------- */
/* mobile information architecture                                            */
/* -------------------------------------------------------------------------- */

/** The domain that owns `pathname`, or null. */
export function findNavDomain(pathname) {
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.items) {
      if (pathname === item.path || pathname.startsWith(`${item.path}/`)) return domain;
    }
  }
  return null;
}

/**
 * The phone navigation model: a few primary domains plus everything else behind
 * More.
 *
 * Both lists are permission-filtered, so an operator never sees a tab whose every
 * destination would 403. A primary domain with no visible items is DEMOTED rather
 * than shown empty, and `more` therefore holds whatever is left — including a
 * primary domain that lost all its items.
 *
 * @returns {{ primary: object[], more: object[] }}
 */
export function mobileNavModel(user) {
  const visible = visibleNavDomains(user);
  const primary = visible
    .filter((domain) => domain.mobile?.primary)
    .sort((a, b) => (a.mobile.order ?? 99) - (b.mobile.order ?? 99));
  const primaryIds = new Set(primary.map((domain) => domain.id));
  const more = visible.filter((domain) => !primaryIds.has(domain.id));
  return { primary, more };
}

/** Where a domain tab lands: its first destination the principal may reach. */
export function domainEntryPath(domain) {
  return domain?.items?.[0]?.path ?? '/admin/overview';
}
