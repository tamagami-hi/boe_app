// Admin reads, one cache key per domain. Replaces LegacyAdminDataProvider, which
// fetched six collections on mount of ANY admin route and re-read all six after any
// fund mutation. Approvals are not here — see ApprovalsQueueProvider.
//
// Cache discipline for the investment model (spec §12.2):
//   - An AUM commit invalidates the admin catalogue (which carries published AUM)
//     and the audit log. It NEVER touches client portfolio data — AUM growth does
//     not change any client value, so no client-value read may be refreshed as a
//     side effect of an AUM write.
//   - A client-growth commit invalidates the audit log only. It never invalidates
//     the fund catalogue: client growth does not change published AUM.
//   - A review decision invalidates the review queues, the refund register and the
//     payment evidence (the payment leaves `succeeded` on a reject), plus the
//     audit log.

import { useCallback } from 'react';
import {
  STALE_TIME,
  useResource,
  useResourceCache,
} from '@beonedge/shared/data/ResourceCacheProvider.jsx';

import { loadAdminCollection } from '../helpers/loadAdminData.js';

export const ADMIN_CACHE_PREFIX = 'admin:';

export const ADMIN_KEYS = {
  funds: () => 'admin:funds',
  payments: () => 'admin:payments',
  investmentReviews: (state = 'pending') => `admin:investmentReviews:${state}`,
  refunds: (state = 'all') => `admin:refunds:${state}`,
  auditLogs: () => 'admin:auditLogs',
};

export const ADMIN_DOMAINS = {
  FUNDS: 'admin:funds',
  PAYMENTS: 'admin:payments',
  INVESTMENT_REVIEWS: 'admin:investmentReviews',
  REFUNDS: 'admin:refunds',
  AUDIT_LOGS: 'admin:auditLogs',
};

const ADMIN_PATHS = {
  funds: '/v1/admin/funds',
  payments: '/v1/admin/payments',
  auditLogs: '/v1/admin/audit-logs',
};

// `rows` is always an array so tables need no null guard; `error` stays separate so a
// screen can say the read failed rather than showing an empty table.
function useAdminCollection(key, path, { staleTime, enabled = true } = {}) {
  const resource = useResource(key, () => loadAdminCollection(path), { staleTime, enabled });
  return { ...resource, rows: Array.isArray(resource.data) ? resource.data : [] };
}

export function useAdminFunds(options) {
  // Changes only on publish, which invalidates explicitly.
  return useAdminCollection(ADMIN_KEYS.funds(), ADMIN_PATHS.funds, {
    staleTime: STALE_TIME.CATALOGUE,
    ...options,
  });
}

export function useAdminPayments(options) {
  // Settlement moves without the operator acting; this is the oversight trail.
  return useAdminCollection(ADMIN_KEYS.payments(), ADMIN_PATHS.payments, {
    staleTime: STALE_TIME.MONEY,
    ...options,
  });
}

// The private review queue, keyed per review state (`pending`, `accepted`).
// Created when PhonePe confirms a payment; decided here and nowhere else.
export function useAdminInvestmentReviews(state = 'pending', options) {
  return useAdminCollection(
    ADMIN_KEYS.investmentReviews(state),
    `/v1/admin/investment-reviews?state=${encodeURIComponent(state)}`,
    { staleTime: STALE_TIME.MONEY, ...options },
  );
}

// The refund register. `refund_failed` is the exception queue; retry and reconcile
// are the only actions, and they never change client value or AUM.
export function useAdminRefunds(state = 'all', options) {
  const query = state === 'all' ? '' : `?state=${encodeURIComponent(state)}`;
  return useAdminCollection(ADMIN_KEYS.refunds(state), `/v1/admin/refunds${query}`, {
    staleTime: STALE_TIME.MONEY,
    ...options,
  });
}

export function useAdminAuditLogs(options) {
  // Read right after an action, so it must not be minutes old.
  return useAdminCollection(ADMIN_KEYS.auditLogs(), ADMIN_PATHS.auditLogs, {
    staleTime: STALE_TIME.MONEY,
    ...options,
  });
}

export function useAdminCacheActions() {
  const cache = useResourceCache();

  const invalidate = useCallback((prefix) => cache.invalidate(prefix), [cache]);

  // A fund catalogue write changes the catalogue and is audited. Nothing else.
  const invalidateFunds = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.FUNDS);
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  // A review decision moves the queue, can start a refund, changes the payment's
  // evidence state, and is audited. It changes no AUM cache: acceptance creates no
  // AUM record, so the catalogue stays exactly as it was.
  const invalidateReviews = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.INVESTMENT_REVIEWS);
    cache.invalidate(ADMIN_DOMAINS.REFUNDS);
    cache.invalidate(ADMIN_DOMAINS.PAYMENTS);
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  // An AUM commit republishes the catalogue's AUM figures and is audited. It must
  // never invalidate client portfolio/value data: AUM growth is not a client event.
  const invalidateAum = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.FUNDS);
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  // A client-growth commit is audited. It must never invalidate the fund
  // catalogue's AUM: client growth is not an AUM event.
  const invalidateClientGrowth = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  // Sign-out: drop, not invalidate — invalidated entries keep their data.
  const clearAll = useCallback(() => cache.clear(ADMIN_CACHE_PREFIX), [cache]);

  return {
    invalidate,
    invalidateFunds,
    invalidateReviews,
    invalidateAum,
    invalidateClientGrowth,
    clearAll,
  };
}
