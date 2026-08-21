import { apiRequest, useHttpApi } from '@beonedge/client/services/_util.js';
import { listPendingApprovals } from '@beonedge/client/services/authApi.js';
import { listPendingApplications } from '@beonedge/client/services/adminApplicationsApi.js';
import { fixtureCollection } from '../fixtures/adminCollections.js';
import { parseFundRow, parseFundSummary } from '../data/fundContracts.js';
import { collectionKey, normalizeAdminCollection, normalizeApprovalRow } from './formatters.js';

function toApprovalRow(application) {
  return {
    ...normalizeApprovalRow({
      id: application.applicationId,
      name: application.fullName,
      email: application.email,
      phone: application.phone,
      status: application.status,
      createdAt: application.createdAt,
    }),
    applicationId: application.applicationId,
    version: application.version,
    isPiiTombstoned: application.isPiiTombstoned ?? false,
  };
}

function extractAdminCollection(payload, path) {
  const key = collectionKey(path);
  const data = payload?.data ?? payload ?? [];
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data[key])) return data[key];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

export async function loadAdminCollection(path) {
  if (!useHttpApi()) {
    if (path.endsWith('/approvals')) return listPendingApprovals();
    const rows = fixtureCollection(path);
    if (rows === null) return [];
    return normalizeAdminCollection(rows, path);
  }
  if (path.endsWith('/approvals')) {
    return (await loadApprovals()).rows;
  }
  const payload = await apiRequest(path, { scope: 'admin' });
  return normalizeAdminCollection(extractAdminCollection(payload, path), path);
}

const EMPTY_FUND_SUMMARY = {
  total: 0,
  byState: { draft: 0, published: 0, paused: 0, archived: 0 },
};

export async function loadAdminFundPage(query = {}) {
  if (!useHttpApi()) {
    return { rows: [], nextCursor: null, hasMore: false, summary: EMPTY_FUND_SUMMARY };
  }
  const params = new URLSearchParams();
  params.set('limit', String(query.limit ?? 100));
  if (query.state) params.set('state', query.state);
  if (query.search) params.set('search', query.search);
  if (query.after) params.set('after', query.after);

  const payload = await apiRequest(`/v1/admin/funds?${params.toString()}`, {
    scope: 'admin',
    envelope: true,
  });
  const data = payload?.data ?? payload ?? {};
  const page = payload?.meta?.page ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) parseFundRow(item);
  return {
    rows: normalizeAdminCollection(items, '/v1/admin/funds'),
    nextCursor: page.nextCursor ?? null,
    hasMore: page.hasMore === true,
    summary: parseFundSummary(data.summary) ?? EMPTY_FUND_SUMMARY,
  };
}

export async function loadApprovals({ maxPages } = {}) {
  if (!useHttpApi()) {
    return { rows: await listPendingApprovals(), truncated: false };
  }
  const { items, truncated } = await listPendingApplications(
    maxPages === undefined ? {} : { maxPages },
  );
  return { rows: items.map(toApprovalRow), truncated };
}
