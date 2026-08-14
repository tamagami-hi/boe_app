// Admin reads, one cache key per domain. Replaces LegacyAdminDataProvider, which
// fetched six collections on mount of ANY admin route and re-read all six after any
// fund mutation. Approvals are not here — see ApprovalsQueueProvider.
//
// Note: the old provider also fetched /v1/admin/transactions, which no screen used
// (TransactionsScreen paginates via useAdminList). Not reinstated.

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
  mandates: () => 'admin:mandates',
  auditLogs: () => 'admin:auditLogs',
};

export const ADMIN_DOMAINS = {
  FUNDS: 'admin:funds',
  PAYMENTS: 'admin:payments',
  MANDATES: 'admin:mandates',
  AUDIT_LOGS: 'admin:auditLogs',
};

const ADMIN_PATHS = {
  funds: '/v1/admin/funds',
  payments: '/v1/admin/payments',
  mandates: '/v1/admin/mandates',
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

export function useAdminMandates(options) {
  return useAdminCollection(ADMIN_KEYS.mandates(), ADMIN_PATHS.mandates, {
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

  // A fund write changes the catalogue and is audited. Nothing else.
  const invalidateFunds = useCallback(() => {
    cache.invalidate(ADMIN_DOMAINS.FUNDS);
    cache.invalidate(ADMIN_DOMAINS.AUDIT_LOGS);
  }, [cache]);

  // Sign-out: drop, not invalidate — invalidated entries keep their data.
  const clearAll = useCallback(() => cache.clear(ADMIN_CACHE_PREFIX), [cache]);

  return { invalidate, invalidateFunds, clearAll };
}
