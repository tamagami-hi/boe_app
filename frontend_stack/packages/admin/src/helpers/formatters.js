// Admin display formatters. Money goes through the shared formatter so the console
// and the client never disagree about how a rupee figure looks.
import { fmtMoney } from '@beonedge/shared/format.js';

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

/**
 * Paise (a bigint serialised as a string) to rupees.
 *
 * Returns null for a missing value rather than 0. On these screens a zero is read
 * as "this payment was for nothing", so the absence has to stay visible.
 */
export function paiseToRupees(value) {
  if (value === null || value === undefined || value === '') return null;
  const paise = Number(value);
  return Number.isFinite(paise) ? paise / 100 : null;
}

/** Rupees to an INR string, via the shared formatter. Kept as one call so paise
 * can never reach a cell unconverted, and a missing value can never read as ₹0. */
export function fmtPaise(value, decimals = 2) {
  return fmtMoney(paiseToRupees(value), { decimals });
}

/** Signed variant, for a return that can be negative. */
export function fmtPaiseSigned(value, decimals = 2) {
  return fmtMoney(paiseToRupees(value), { decimals, sign: true });
}

/** A backend state token in operator language: `provider_pending` -> `Provider pending`. */
export function humanizeState(value) {
  const text = String(value || '').replace(/[_-]+/gu, ' ').trim();
  if (!text) return 'Unknown';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * `GET /v1/admin/payments` emits the canonical payment shape
 * (`amountPaise`/`state`->`status`/`providerReference`/`succeededAt`). The screen was
 * written against a legacy mock shape — `amount`, `resolvedAmount`, `mode`, `time`,
 * `fundId`, `fundName`, `userName` — none of which the endpoint sends, so every
 * amount rendered as ₹0 and every pool as "Unmapped fund". Map once here.
 */
export function normalizePaymentRow(row = {}) {
  return {
    ...row,
    id: row.id || '',
    orderId: row.orderId || '',
    userId: row.userId || '',
    userEmail: row.userEmail || '',
    status: row.status || row.state || 'unknown',
    amount: paiseToRupees(row.amountPaise),
    provider: row.provider || '',
    providerReference: row.providerReference || '',
    attemptCount: Number.isFinite(Number(row.attemptCount)) ? Number(row.attemptCount) : 0,
    succeededAt: row.succeededAt || null,
    failedAt: row.failedAt || null,
    createdAt: row.createdAt || '',
    // The moment the payment reached its outcome, if it has one.
    settledAt: row.succeededAt || row.failedAt || null,
  };
}

/*
 * Same story for `GET /v1/admin/mandates`. The register read `user`, `amount`,
 * `day`, `last` and `next`; the endpoint sends `userEmail`, `maxAmountPaise`,
 * `debitDay`, `validFrom` and `validTo`, so five of the eight columns were blank on
 * every row. There is no last-debit or next-debit field to map — see the screen.
 */
export function normalizeMandateRow(row = {}) {
  return {
    ...row,
    id: row.id || '',
    userId: row.userId || '',
    userEmail: row.userEmail || '',
    provider: row.provider || '',
    providerMandateId: row.providerMandateId || '',
    status: row.status || row.state || 'unknown',
    maxAmount: paiseToRupees(row.maxAmountPaise),
    frequency: row.frequency || '',
    debitDay: Number.isFinite(Number(row.debitDay)) ? Number(row.debitDay) : null,
    sipCount: Number.isFinite(Number(row.sipCount)) ? Number(row.sipCount) : 0,
    validFrom: row.validFrom || null,
    validTo: row.validTo || null,
    createdAt: row.createdAt || '',
  };
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
  if (key === 'payments') return rows.map(normalizePaymentRow);
  if (key === 'mandates') return rows.map(normalizeMandateRow);
  return rows;
}

export function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function csvNumbers(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
}


