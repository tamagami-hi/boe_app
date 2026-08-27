import { fmtMoney } from '@beonedge/shared/format.js';
import { paiseToRupees } from '@beonedge/shared/money.js';

export { paiseToRupees } from '@beonedge/shared/money.js';

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

export function fmtPaise(value, decimals = 2) {
  return fmtMoney(paiseToRupees(value), { decimals });
}

export function fmtPaiseSigned(value, decimals = 2) {
  return fmtMoney(paiseToRupees(value), { decimals, sign: true });
}

export function humanizeState(value) {
  const text = String(value || '').replace(/[_-]+/gu, ' ').trim();
  if (!text) return 'Unknown';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
    settledAt: row.succeededAt || row.failedAt || null,
  };
}

export function normalizeAdminCollection(rows, path) {
  const key = collectionKey(path);
  if (key === 'approvals') return rows.map(normalizeApprovalRow);
  if (key === 'funds') return rows.map(normalizeFundRow);
  if (key === 'audit-logs') return rows.map(normalizeAuditRow);
  if (key === 'payments') return rows.map(normalizePaymentRow);
  return rows;
}

export function normalizeApprovalRow(row = {}) {
  return {
    id: row.id || row.userId || '',
    userId: row.userId || row.id || '',
    name: row.name || row.fullName || 'Unknown',
    email: row.email || '',
    phone: row.phone || '',
    status: row.status || 'pending',
    emailVerificationStatus: row.emailVerificationStatus || 'not_started',
    riskProfileStatus: row.riskProfileStatus || 'pending',
    createdAt: row.createdAt || row.registeredAt || '',
    updatedAt: row.updatedAt || '',
  };
}

export function normalizeFundRow(row = {}) {
  const aumPaise = row.aum?.aumPaise ?? null;
  return {
    ...row,
    id: row.id || '',
    slug: row.slug || '',
    name: row.name || row.slug || 'Untitled fund',
    status: row.status || 'draft',
    category: row.category || '',
    objective: row.objective || '',
    riskLevel: row.riskLevel || '',
    returnTier: row.returnTier || null,
    aumPaise,
    aumAsOfDate: row.aum?.asOfDate ?? null,
    aumUpdatedAt: row.aum?.updatedAt ?? null,
    stockCount: row.stockCount ?? 0,
    currentVersion: row.currentVersion ?? null,
  };
}

export function normalizeAuditRow(row = {}) {
  return {
    ...row,
    action: row.action || row.command || '',
    adminId: row.actorEmail || row.actorUserId || '',
    reason: row.reasonCode || '',
    createdAt: row.createdAt || row.occurredAt || '',
  };
}

export function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function csvNumbers(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
}
