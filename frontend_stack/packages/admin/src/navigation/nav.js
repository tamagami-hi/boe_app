import {
  LayoutDashboard, UserCheck, Users, CreditCard,
  HelpCircle,
  Layers, PieChart, History, Inbox, TrendingUp, ShieldCheck,
  LayoutGrid, Settings,
} from 'lucide-react';

export const NAV_DOMAINS = [
  {
    id: 'overview',
    label: 'Overview',
    mobile: { primary: true, order: 1, shortLabel: 'Overview', icon: LayoutDashboard },
    items: [
      {
        path: '/admin/overview',
        label: 'Overview',
        icon: LayoutDashboard,
        title: 'Overview',
        permissions: [],
      },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    mobile: { primary: true, order: 3, shortLabel: 'Users', icon: Users },
    items: [
      {
        path: '/admin/users/approvals',
        label: 'Approvals',
        icon: UserCheck,
        badge: 'approvals',
        title: 'User approvals',
        permissions: ['applications.read'],
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
    id: 'funds',
    label: 'Funds',
    mobile: { primary: true, order: 4, shortLabel: 'Funds', icon: Layers },
    items: [
      {
        path: '/admin/funds',
        label: 'Issued catalogue',
        icon: Layers,
        title: 'Issued fund catalogue',
        permissions: ['funds.read'],
      },
    ],
  },
  {
    id: 'funds-received',
    label: 'Funds received',
    mobile: { primary: true, order: 2, shortLabel: 'Receipts', icon: ShieldCheck },
    items: [
      {
        path: '/admin/funds-received/awaiting',
        label: 'Awaiting acknowledgement',
        icon: ShieldCheck,
        title: 'Awaiting fund acknowledgement',
        permissions: ['funds.receipts.read'],
      },
      {
        path: '/admin/funds-received/acknowledged',
        label: 'Acknowledged',
        icon: UserCheck,
        title: 'Acknowledged funds',
        permissions: ['funds.receipts.read'],
      },
      {
        path: '/admin/funds-received/refunds',
        label: 'Refunds and exceptions',
        icon: CreditCard,
        title: 'Refunds and exceptions',
        permissions: ['funds.receipts.read', 'refunds.write'],
      },
    ],
  },
  {
    id: 'client-values',
    label: 'Client values',
    mobile: { primary: false, shortLabel: 'Values', icon: TrendingUp },
    items: [
      {
        path: '/admin/client-values/detail',
        label: 'Client detail',
        icon: Users,
        title: 'Client values — client detail',
        permissions: ['client_values.read', 'users.read', 'users.read_limited'],
      },
      {
        path: '/admin/client-values/individual',
        label: 'Individual growth',
        icon: TrendingUp,
        title: 'Individual client growth',
        permissions: ['client_growth.write'],
      },
      {
        path: '/admin/client-values/collective',
        label: 'Collective growth by fund',
        icon: Layers,
        title: 'Collective client growth by fund',
        permissions: ['client_growth.write'],
      },
    ],
  },
  {
    id: 'aum',
    label: 'AUM',
    mobile: { primary: false, shortLabel: 'AUM', icon: PieChart },
    items: [
      {
        path: '/admin/aum/current',
        label: 'Current published AUM',
        icon: PieChart,
        title: 'Current published AUM',
        permissions: ['aum.read'],
        requiresAll: ['funds.read'],
      },
      {
        path: '/admin/aum/manage',
        label: 'Adjust one fund',
        icon: TrendingUp,
        title: 'Adjust one fund',
        permissions: ['aum.write'],
        requiresAll: ['funds.read', 'aum.read'],
      },
      {
        path: '/admin/aum/collective',
        label: 'Collective fund growth',
        icon: Layers,
        title: 'Collective fund AUM growth',
        permissions: ['aum.write'],
        requiresAll: ['funds.read'],
      },
      {
        path: '/admin/aum/history',
        label: 'History and corrections',
        icon: History,
        title: 'AUM history and corrections',
        permissions: ['aum.read'],
        requiresAll: ['funds.read'],
      },
    ],
  },
  {
    id: 'payments',
    label: 'Payments',
    mobile: { primary: false, shortLabel: 'Payments', icon: CreditCard },
    items: [
      {
        path: '/admin/payments/mandates',
        label: 'SIP AutoPay',
        icon: History,
        title: 'SIP AutoPay mandates',
        permissions: ['payments.read'],
      },
      {
        path: '/admin/payments',
        label: 'PhonePe evidence',
        icon: CreditCard,
        title: 'Payments — PhonePe evidence',
        permissions: ['payments.read'],
      },
    ],
  },
  {
    id: 'audit',
    label: 'Audit',
    mobile: { primary: false, shortLabel: 'Audit', icon: History },
    items: [
      {
        path: '/admin/audit',
        label: 'Audit log',
        icon: History,
        title: 'Audit log',
        permissions: ['audit.read'],
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
    id: 'system',
    label: 'System',
    mobile: { primary: false, shortLabel: 'System', icon: Settings },
    items: [
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

export function hasAnyPermission(user, codes) {
  if (!Array.isArray(codes) || codes.length === 0) return true;
  const held = Array.isArray(user?.permissions) ? user.permissions : [];
  if (held.length === 0) return false;
  return codes.some((code) => held.includes(code));
}

export function hasAllPermissions(user, codes) {
  if (!Array.isArray(codes) || codes.length === 0) return true;
  const held = Array.isArray(user?.permissions) ? user.permissions : [];
  if (held.length === 0) return false;
  return codes.every((code) => held.includes(code));
}

export function canAccessItem(user, item) {
  if (!item) return true;
  return hasAnyPermission(user, item.permissions) && hasAllPermissions(user, item.requiresAll);
}

const ROUTE_PERMISSION_OVERRIDES = [
  {
    path: '/admin/funds/new',
    permissions: ['funds.write'],
    requiresAll: ['funds.write', 'aum.write'],
  },
];

export function canAccessPath(user, pathname) {
  const override = ROUTE_PERMISSION_OVERRIDES.find((entry) => entry.path === pathname);
  if (override) return canAccessItem(user, override);
  const meta = findNavMeta(pathname);
  if (!meta.item) return true;
  return canAccessItem(user, meta.item);
}

export function visibleNavDomains(user) {
  return NAV_DOMAINS
    .map((domain) => ({ ...domain, items: domain.items.filter((item) => canAccessItem(user, item)) }))
    .filter((domain) => domain.items.length > 0);
}

export function allNavPermissions() {
  return [...new Set(NAV_DOMAINS.flatMap((d) => d.items.flatMap((i) => i.permissions)))].sort();
}

export function findNavDomain(pathname) {
  for (const domain of NAV_DOMAINS) {
    for (const item of domain.items) {
      if (pathname === item.path || pathname.startsWith(`${item.path}/`)) return domain;
    }
  }
  return null;
}

export function mobileNavModel(user) {
  const visible = visibleNavDomains(user);
  const primary = visible
    .filter((domain) => domain.mobile?.primary)
    .sort((a, b) => (a.mobile.order ?? 99) - (b.mobile.order ?? 99));
  const primaryIds = new Set(primary.map((domain) => domain.id));
  const more = visible.filter((domain) => !primaryIds.has(domain.id));
  return { primary, more };
}

export function domainEntryPath(domain) {
  return domain?.items?.[0]?.path ?? '/admin/overview';
}

export function aumEntryPathFor(user) {
  const domain = NAV_DOMAINS.find((entry) => entry.id === 'aum');
  const permitted = (domain?.items ?? []).find((item) => canAccessItem(user, item));
  return permitted?.path ?? '/admin/aum/current';
}
