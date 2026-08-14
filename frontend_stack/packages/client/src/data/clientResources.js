/**
 * The client app's cache keys and domain hooks — one place, so two screens cannot
 * disagree about what a resource is called or how old it may be.
 *
 * Before this, every page owned its own `useEffect` + `useState` fetch. The
 * consequences were visible:
 *
 *   - Dashboard issued five requests per mount, and a bottom-nav tap remounts.
 *     Home -> Explore -> Home fetched the fund list three times.
 *   - Explore and Dashboard both read `listFunds()` and `getResearchContext()`,
 *     concurrently and independently.
 *   - Portfolio re-read the portfolio that Dashboard had just read.
 *   - Transactions cleared its list to `null` on every tab change, so returning to
 *     a tab you had already loaded showed a skeleton again.
 *
 * Keys are namespaced `client:<domain>[:<id>]` so `invalidate('client:')` on logout
 * and `invalidate('client:portfolio')` after a write both work by prefix, with no
 * hand-maintained list of keys to drift.
 *
 * STALENESS IS DECLARED PER DOMAIN, ON PURPOSE. There is no global default. A fund
 * catalogue may be two minutes old without misleading anyone; a portfolio valuation
 * may not. Money resources use STALE_TIME.MONEY and the screens that show them are
 * expected to surface `updatedAt`.
 *
 * NOT CARRIED OVER: the pages used to key their fetch effect on
 * `appConfig.publishedAt`, so publishing app config refetched funds and research.
 * That coupling was incidental — app config governs which components render and
 * what they say, not where fund data comes from — and `useAppConfig` already
 * re-renders its consumers when a publish lands, so copy still updates. Data
 * freshness is now `staleTime`'s job alone.
 */

import { useCallback } from 'react';
import {
  STALE_TIME,
  useResource,
  useResourceCache,
} from '@beonedge/shared/data/ResourceCacheProvider.jsx';

import * as portfolioApi from '../services/portfolioApi.js';
import * as fundsApi from '../services/fundsApi.js';
import * as researchApi from '../services/researchApi.js';
import * as ordersApi from '../services/ordersApi.js';
import * as transactionsApi from '../services/transactionsApi.js';
import { getInvestingEligibility } from '../services/eligibilityApi.js';

/** Everything this app caches lives under here, so logout can drop it in one call. */
export const CLIENT_CACHE_PREFIX = 'client:';

export const CLIENT_KEYS = {
  portfolio: () => 'client:portfolio',
  funds: () => 'client:funds',
  fund: (fundId) => `client:fund:${fundId}`,
  research: () => 'client:research',
  sipPlans: () => 'client:sips',
  /** Scoped by user id: another principal's eligibility must never be reused. */
  eligibility: (userId) => `client:eligibility:${userId}`,
  transactions: (filter) => `client:transactions:${filter}`,
  paymentQueue: (kind) => `client:payments:${kind}`,
};

/**
 * Domain prefixes for invalidation after a write. Prefix-matched, so
 * `MONEY` below invalidates every transaction filter and payment queue at once
 * rather than naming them.
 */
export const CLIENT_DOMAINS = {
  PORTFOLIO: 'client:portfolio',
  TRANSACTIONS: 'client:transactions',
  PAYMENTS: 'client:payments',
  SIP_PLANS: 'client:sips',
  CATALOGUE: 'client:fund',
  ELIGIBILITY: 'client:eligibility',
};

/* ── Reads ─────────────────────────────────────────────────────────────────── */

/**
 * Portfolio valuation. Short stale time and the caller MUST show `updatedAt`:
 * a cached balance presented as live is worse than a spinner.
 */
export function usePortfolio({ enabled = true } = {}) {
  return useResource(CLIENT_KEYS.portfolio(), portfolioApi.getPortfolio, {
    staleTime: STALE_TIME.MONEY,
    enabled,
  });
}

/** The fund catalogue. Read by Dashboard, Explore and Portfolio — now once. */
export function useFundList({ enabled = true } = {}) {
  return useResource(CLIENT_KEYS.funds(), fundsApi.listFunds, {
    staleTime: STALE_TIME.CATALOGUE,
    enabled,
  });
}

/**
 * The fund catalogue as an id -> fund map. Derived from the SAME cache entry as
 * `useFundList`, so a screen needing lookups does not fetch a second copy.
 */
export function useFundsById(options) {
  const result = useFundList(options);
  const funds = Array.isArray(result.data) ? result.data : [];
  return {
    ...result,
    // Rebuilt per render rather than memoised: the list is small, and memoising on
    // `data` identity would still rebuild on every cache notification anyway.
    data: Object.fromEntries(funds.map((f) => [f.id, f])),
    funds,
  };
}

/** Published research context. Editorial content; catalogue staleness is fine. */
export function useResearchContext({ enabled = true } = {}) {
  return useResource(CLIENT_KEYS.research(), researchApi.getResearchContext, {
    staleTime: STALE_TIME.CATALOGUE,
    enabled,
  });
}

/**
 * SIP plans. Note this reads the SIP endpoint, not orders: a plan's state
 * (draft / pending mandate / active / paused) lives on the plan, not on the orders
 * it generates.
 */
export function useSipPlans({ enabled = true } = {}) {
  return useResource(CLIENT_KEYS.sipPlans(), ordersApi.listSips, {
    staleTime: STALE_TIME.MONEY,
    enabled,
  });
}

/**
 * Investing eligibility, keyed by user.
 *
 * A UX cache only. The server re-derives eligibility on every write, so a stale
 * `true` here cannot authorise anything — at most it lets someone reach a form
 * whose submit is then refused.
 */
export function useEligibility(userId) {
  return useResource(
    // A null key disables the resource entirely: no request, and nothing cached
    // under a session that does not exist yet.
    userId ? CLIENT_KEYS.eligibility(userId) : null,
    getInvestingEligibility,
    { staleTime: STALE_TIME.ELIGIBILITY },
  );
}

const PAYMENT_QUEUE_LOADERS = {
  pending: ordersApi.listPendingPayments,
  failed: ordersApi.listFailedPayments,
  approval: ordersApi.listApprovalPayments,
};

/** Transaction history for one filter. Each filter is its own cache entry. */
export function useTransactions(filter = 'all', { enabled = true } = {}) {
  return useResource(
    CLIENT_KEYS.transactions(filter),
    () => transactionsApi.listTransactions({ filter }),
    { staleTime: STALE_TIME.MONEY, enabled },
  );
}

/**
 * A payment queue: `pending`, `failed` or `approval`. An unknown kind yields a
 * disabled resource rather than a request that cannot be built.
 */
export function usePaymentQueue(kind, { enabled = true } = {}) {
  const loader = PAYMENT_QUEUE_LOADERS[kind];
  return useResource(
    loader ? CLIENT_KEYS.paymentQueue(kind) : null,
    loader || (() => Promise.resolve([])),
    { staleTime: STALE_TIME.MONEY, enabled },
  );
}

/* ── Writes ────────────────────────────────────────────────────────────────── */

/**
 * Invalidation for mutations.
 *
 * Invalidation marks entries stale WITHOUT discarding their data, so an
 * invalidated screen keeps showing its last known values while refetching instead
 * of flashing an empty state. `clearAll` does discard, which is what logout needs.
 *
 * A write invalidates a DOMAIN, not a list of keys: a redemption affects the
 * portfolio and the transaction history, and enumerating every transaction filter
 * here would drift the first time a tab is added.
 */
export function useClientCacheActions() {
  const cache = useResourceCache();

  const invalidate = useCallback((prefix) => cache.invalidate(prefix), [cache]);

  /** After any movement of money: valuation, history and payment queues. */
  const invalidateMoney = useCallback(() => {
    cache.invalidate(CLIENT_DOMAINS.PORTFOLIO);
    cache.invalidate(CLIENT_DOMAINS.TRANSACTIONS);
    cache.invalidate(CLIENT_DOMAINS.PAYMENTS);
    cache.invalidate(CLIENT_DOMAINS.SIP_PLANS);
  }, [cache]);

  /** Logout / user switch: drop it, do not merely mark it stale. */
  const clearAll = useCallback(() => cache.clear(CLIENT_CACHE_PREFIX), [cache]);

  return { invalidate, invalidateMoney, clearAll };
}
