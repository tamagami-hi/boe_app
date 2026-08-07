export function fmtInt(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : '0';
}

export function initials(name, fallback = 'AD') {
  if (!name) return fallback;
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function displayRole(user) {
  const role = String(user?.role || user?.accountType || user?.roles?.[0] || 'admin').trim();
  return role ? role.charAt(0).toUpperCase() + role.slice(1).toLowerCase() : 'Admin';
}

/**
 * A signup timestamp in a form an operator can read at a glance.
 *
 * The approvals table used to print the raw ISO string the API returns
 * ("2026-08-07T10:05:15.239Z"), which is 24 characters of mostly noise and wraps
 * onto two lines in a phone-width column. Locale formatting is deliberately
 * avoided in favour of a fixed short form so the column width is predictable.
 */
export function fmtDateTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('en-GB', { month: 'short' });
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const year = date.getFullYear();
  const thisYear = new Date().getFullYear();
  return year === thisYear ? `${day} ${month}, ${time}` : `${day} ${month} ${year}`;
}

export function collectionKey(path) {
  return String(path || '').split('/').filter(Boolean).pop();
}

export function normalizeApprovalRow(row = {}) {
  return {
    id: row.id || row.userId || '',
    userId: row.userId || row.id || '',
    name: row.name || row.fullName || 'Unknown',
    email: row.email || '',
    phone: row.phone || '',
    status: row.status || 'pending',
    kycStatus: row.kycStatus || 'pending',
    riskProfileStatus: row.riskProfileStatus || 'pending',
    createdAt: row.createdAt || row.registeredAt || '',
    updatedAt: row.updatedAt || '',
  };
}

// The canonical `/v1/admin/funds` projection is catalogue-shaped (slug + current
// published version + latest NAV/AUM snapshots). The AUM screens were written
// against the legacy fund document, so map once here instead of rewriting them:
// paise -> rupees for the pool size, the published state as the lifecycle stage,
// and the version's minimums/risk band as flat fields.
export function normalizeFundRow(row = {}) {
  // Option B: a pool's size is the latest published monthly closing AUM. There is
  // no NAV and no unit price to surface.
  const aumPaise = Number(row.aum?.closingPaise ?? 0);
  return {
    ...row,
    id: row.id || '',
    slug: row.slug || '',
    name: row.name || row.slug || 'Untitled fund',
    status: row.status || 'draft',
    lifecycleStage: row.status || 'draft',
    tagline: row.objective || '',
    category: row.category || '',
    riskLabel: row.riskLevel || '',
    returnTier: row.returnTier || null,
    totalPoolSize: Number.isFinite(aumPaise) ? aumPaise / 100 : 0,
    aumPeriodStart: row.aum?.periodStart ?? null,
    aumUpdatedAt: row.aum?.updatedAt ?? null,
    stockCount: row.stockCount ?? 0,
    minSip: row.minimumSipPaise === null || row.minimumSipPaise === undefined
      ? null
      : Number(row.minimumSipPaise) / 100,
    minLumpsum: row.minimumPurchasePaise === null || row.minimumPurchasePaise === undefined
      ? null
      : Number(row.minimumPurchasePaise) / 100,
    currentVersion: row.currentVersion ?? null,
    analytics: { totalInvested: 0 },
    sectors: [],
    investments: [],
  };
}

// `GET /v1/admin/audit-logs` emits the canonical event shape. The audit screen
// filters on `action`/`adminId`/`reason`, so alias them here rather than in the
// backend projection, which stays faithful to `audit_events`.
export function normalizeAuditRow(row = {}) {
  return {
    ...row,
    action: row.action || row.command || '',
    adminId: row.actorEmail || row.actorUserId || '',
    reason: row.reasonCode || '',
    createdAt: row.createdAt || row.occurredAt || '',
  };
}

export function normalizeAdminCollection(rows, path) {
  const key = collectionKey(path);
  if (key === 'approvals') return rows.map(normalizeApprovalRow);
  if (key === 'funds') return rows.map(normalizeFundRow);
  if (key === 'audit-logs') return rows.map(normalizeAuditRow);
  return rows;
}

export function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function csvNumbers(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
}


