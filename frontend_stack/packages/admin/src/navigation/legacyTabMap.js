// Map of pre-redesign `?tab=` values onto the routed information architecture.
// Kept so bookmarks and deep links into the old console keep working.

export const LEGACY_TAB_MAP = {
  approvals: '/admin/users/approvals',
  userDetail: '/admin/users/directory',
  risk: '/admin/users/risk-profiles',
  payments: '/admin/users/payments',
  mandates: '/admin/users/subscriptions',
  funds: '/admin/ops/funds',
  holdings: '/admin/ops/holdings',
  ledger: '/admin/ops/ledger',
  transactions: '/admin/ops/transactions',
  requests: '/admin/ops/sip-control',
  appBuilder: '/admin/app/builder',
  support: '/admin/system/support',
  audit: '/admin/system/audit-log',
  env: '/admin/system/environment',
};

export function resolveLegacyLocation(searchParams) {
  const tab = searchParams.get('tab');
  if (!tab) return '/admin/overview';

  const base = LEGACY_TAB_MAP[tab] || '/admin/overview';
  const userId = searchParams.get('userId');
  if (tab === 'userDetail' && userId) {
    return `/admin/users/directory/${encodeURIComponent(userId)}`;
  }
  return base;
}
