import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RESOURCE_STATUS,
  STALE_TIME,
  useResource,
  useResourceCache,
} from '@beonedge/shared/data/ResourceCacheProvider.jsx';

import { loadAdminCollection, loadAdminFundPage } from '../helpers/loadAdminData.js';

export const ADMIN_CACHE_PREFIX = 'admin:';

export const ADMIN_KEYS = {
  faqs: () => 'admin:faqs',
  funds: () => 'admin:funds',
  payments: () => 'admin:payments',
  investmentReviews: (state = 'pending') => `admin:investmentReviews:${state}`,
  refunds: (state = 'all') => `admin:refunds:${state}`,
  auditLogs: () => 'admin:auditLogs',
};

export const ADMIN_DOMAINS = {
  FAQS: 'admin:faqs',
  FUNDS: 'admin:funds',
  PAYMENTS: 'admin:payments',
  INVESTMENT_REVIEWS: 'admin:investmentReviews',
  REFUNDS: 'admin:refunds',
  AUDIT_LOGS: 'admin:auditLogs',
};

const ADMIN_PATHS = {
  faqs: '/v1/admin/faqs',
  payments: '/v1/admin/payments',
  auditLogs: '/v1/admin/audit-logs',
};

function useAdminCollection(key, path, { staleTime, enabled = true } = {}) {
  const resource = useResource(key, () => loadAdminCollection(path), { staleTime, enabled });
  return { ...resource, rows: Array.isArray(resource.data) ? resource.data : [] };
}

export const FUND_PAGE_LIMIT = 100;

const EMPTY_APPENDED = { key: null, rows: [], cursor: null, hasMore: false };

const EMPTY_SUMMARY = {
  total: 0,
  byState: { draft: 0, published: 0, paused: 0, archived: 0 },
};

export function useAdminFunds({ state = 'all', search = '' } = {}) {
  const trimmedSearch = search.trim();
  const stateFilter = state === 'all' ? '' : state;
  const key = `${ADMIN_KEYS.funds()}:${stateFilter || 'all'}:${trimmedSearch.toLowerCase()}`;

  const request = useMemo(
    () => ({
      limit: FUND_PAGE_LIMIT,
      ...(stateFilter ? { state: stateFilter } : {}),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    }),
    [stateFilter, trimmedSearch],
  );

  const resource = useResource(key, () => loadAdminFundPage(request), {
    staleTime: STALE_TIME.CATALOGUE,
  });

  const [appended, setAppended] = useState(EMPTY_APPENDED);
  const [loadingMore, setLoadingMore] = useState(false);

  const invalidated = resource.status === RESOURCE_STATUS.SUCCESS && resource.updatedAt === null;
  useEffect(() => {
    if (invalidated) setAppended(EMPTY_APPENDED);
  }, [invalidated]);

  const firstPage = resource.data ?? null;
  const sameSlice = appended.key === key;
  const rows = useMemo(
    () => [...(firstPage?.rows ?? []), ...(sameSlice ? appended.rows : [])],
    [firstPage, sameSlice, appended.rows],
  );

  const cursor = sameSlice && appended.cursor !== null
    ? appended.cursor
    : firstPage?.nextCursor ?? null;
  const hasMore = sameSlice && appended.cursor !== null
    ? appended.hasMore
    : firstPage?.hasMore === true;

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await loadAdminFundPage({ ...request, after: cursor });
      setAppended((previous) => {
        const base = previous.key === key ? previous.rows : [];
        return { key, rows: [...base, ...next.rows], cursor: next.nextCursor, hasMore: next.hasMore };
      });
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, key, loadingMore, request]);

  const refresh = useCallback(() => {
    setAppended(EMPTY_APPENDED);
    return resource.refresh();
  }, [resource]);

  return {
    ...resource,
    rows,
    summary: firstPage?.summary ?? EMPTY_SUMMARY,
    hasMore,
    loadMore,
    loadingMore,
    refresh,
  };
}

export function useAdminFaqs(options) {
  return useAdminCollection(ADMIN_KEYS.faqs(), ADMIN_PATHS.faqs, {
    staleTime: STALE_TIME.STATIC,
    ...options,
  });
}

export function useAdminPayments(options) {
  return useAdminCollection(ADMIN_KEYS.payments(), ADMIN_PATHS.payments, {
    staleTime: STALE_TIME.MONEY,
    ...options,
  });
}

export function useAdminInvestmentReviews(state = 'pending', options) {
  return useAdminCollection(
    ADMIN_KEYS.investmentReviews(state),
    `/v1/admin/investment-reviews?state=${encodeURIComponent(state)}`,
    { staleTime: STALE_TIME.MONEY, ...options },
  );
}

export function useAdminRefunds(state = 'all', options) {
  const query = state === 'all' ? '' : `?state=${encodeURIComponent(state)}`;
  return useAdminCollection(ADMIN_KEYS.refunds(state), `/v1/admin/refunds${query}`, {
    staleTime: STALE_TIME.MONEY,
    ...options,
  });
}

export function useAdminAuditLogs(options) {
  return useAdminCollection(ADMIN_KEYS.auditLogs(), ADMIN_PATHS.auditLogs, {
    staleTime: STALE_TIME.MONEY,
    ...options,
  });
}

export function useAdminCacheActions() {
  const cache = useResourceCache();

  const invalidate = useCallback((prefix) => cache.invalidate(prefix), [cache]);

  const invalidateFunds = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.FUNDS);
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  const invalidateReviews = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.INVESTMENT_REVIEWS);
    cache.invalidate(ADMIN_DOMAINS.REFUNDS);
    cache.invalidate(ADMIN_DOMAINS.PAYMENTS);
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  const invalidateAum = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.FUNDS);
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  const invalidateClientGrowth = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  const invalidateFaqs = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.FAQS);
  }, [cache]);

  const clearAll = useCallback(() => cache.clear(ADMIN_CACHE_PREFIX), [cache]);

  return {
    invalidate,
    invalidateFaqs,
    invalidateFunds,
    invalidateReviews,
    invalidateAum,
    invalidateClientGrowth,
    clearAll,
  };
}
