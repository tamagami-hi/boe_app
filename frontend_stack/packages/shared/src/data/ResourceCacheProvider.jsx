import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

/**
 * A small request cache: shared reads, de-duplicated in-flight requests, explicit
 * staleness, and retained data during refresh.
 *
 * The problem it solves is not abstract. Every client page owned its own
 * `useEffect` + `useState` fetch, so:
 *
 *   - Dashboard issued five requests on every mount, and mounting happens on every
 *     tab switch. Going Home → Explore → Home re-fetched everything twice.
 *   - Two screens needing the same fund list fetched it twice, concurrently.
 *   - `useAppConfig` was instantiated independently by several pages, each with its
 *     own copy and its own request.
 *   - A refresh cleared the previous data first, so revisiting a screen showed a
 *     spinner where content had just been.
 *
 * Deliberately NOT a full query library. Adding one would be a dependency and a
 * migration; this is ~200 lines with the four behaviours that actually matter here
 * and no opinions about the rest.
 *
 * FINANCIAL SAFETY — the reason this file is careful rather than clever:
 * a cache that shows a stale balance as though it were live is worse than no cache.
 * So every entry carries `updatedAt`, `isStale` and `isRefreshing`, and the money
 * screens are expected to surface them. There is no global default stale time:
 * each caller states one, because the right answer for the FAQ list and the right
 * answer for a portfolio valuation are three orders of magnitude apart.
 */

const ResourceCacheContext = createContext(null);

/** Entry states. `data` may be present in every state except the first. */
export const RESOURCE_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
};

const emptyEntry = () => ({
  status: RESOURCE_STATUS.IDLE,
  data: undefined,
  error: null,
  updatedAt: null,
  isRefreshing: false,
});

/**
 * The cache itself, independent of React.
 *
 * Extracted as a factory for one specific reason: `useResource` must behave
 * correctly when no provider is mounted. An inert null-object would leave the hook
 * permanently in its loading state — a guard using it would render its placeholder
 * forever, which is a worse failure than throwing because it looks like a slow
 * network. So the provider-less path gets a real (module-level) store instead.
 */
export function createResourceStore() {
  const store = new Map();
  const inflight = new Map();
  const subscribers = new Map();

  const getEntry = (key) => store.get(key) || emptyEntry();

  const notify = (key) => {
    const listeners = subscribers.get(key);
    if (!listeners) return;
    for (const listener of listeners) listener();
  };

  const setEntry = (key, patch) => {
    const current = store.get(key) || emptyEntry();
    store.set(key, { ...current, ...patch });
    notify(key);
  };

  const subscribe = (key, listener) => {
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key).add(listener);
    return () => {
      const listeners = subscribers.get(key);
      listeners?.delete(listener);
      if (listeners && listeners.size === 0) subscribers.delete(key);
    };
  };

  /**
   * Fetch a key, or join the request already in flight for it.
   *
   * The de-dup is the point: three components mounting at once with the same key
   * produce one request. Previously each page fetched independently, so opening a
   * screen that showed the same fund list twice issued two identical requests.
   */
  const load = (key, fetcher, { force = false, staleTime = 0 } = {}) => {
    const existing = inflight.get(key);
    if (existing) return existing;

    const entry = store.get(key);
    const fresh = entry?.updatedAt != null && Date.now() - entry.updatedAt < staleTime;
    if (!force && fresh && entry.status === RESOURCE_STATUS.SUCCESS) {
      return Promise.resolve(entry.data);
    }

    const hasData = entry?.data !== undefined;
    setEntry(key, {
      // Retaining previous data through a refresh is what stops a revisit from
      // flashing a spinner over content the user was just looking at.
      status: hasData ? RESOURCE_STATUS.SUCCESS : RESOURCE_STATUS.LOADING,
      isRefreshing: true,
      error: hasData ? null : entry?.error ?? null,
    });

    const promise = Promise.resolve()
      .then(() => fetcher())
      .then((data) => {
        setEntry(key, {
          status: RESOURCE_STATUS.SUCCESS,
          data,
          error: null,
          updatedAt: Date.now(),
          isRefreshing: false,
        });
        return data;
      })
      .catch((error) => {
        setEntry(key, {
          // A failed refresh keeps the last good data and reports the error
          // alongside it. Replacing data with an empty state is how a timeout came
          // to look like "you have no transactions".
          status: hasData ? RESOURCE_STATUS.SUCCESS : RESOURCE_STATUS.ERROR,
          error,
          isRefreshing: false,
        });
        throw error;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  };

  /**
   * Mark keys stale so the next read refetches.
   *
   * Prefix matching is intentional: a mutation invalidates a domain
   * (`invalidate('portfolio:')`), not a hand-listed set of keys that will drift from
   * reality the first time someone adds a screen.
   */
  const invalidate = (keyOrPrefix, { exact = false } = {}) => {
    for (const key of store.keys()) {
      const matches = exact ? key === keyOrPrefix : key.startsWith(keyOrPrefix);
      if (!matches) continue;
      const current = store.get(key);
      // `updatedAt: null` means "stale" without discarding the data, so an
      // invalidated screen still shows its last known values while refetching.
      store.set(key, { ...current, updatedAt: null });
      notify(key);
    }
  };

  /** Drop keys entirely. For logout: another user's data must not survive. */
  const clear = (keyOrPrefix) => {
    for (const key of [...store.keys()]) {
      if (keyOrPrefix && !key.startsWith(keyOrPrefix)) continue;
      store.delete(key);
      notify(key);
    }
  };

  return { getEntry, subscribe, load, invalidate, clear };
}

/**
 * Fallback store for consumers rendered without a provider — tests, and any surface
 * where the provider is not mounted. Shared process-wide, which is acceptable
 * precisely because it is a fallback: the app mounts one provider at each root.
 */
let fallbackStore = null;
function getFallbackStore() {
  if (!fallbackStore) fallbackStore = createResourceStore();
  return fallbackStore;
}

/** Test-only: drop the fallback store so cases cannot leak into each other. */
export function __resetFallbackResourceStore() {
  fallbackStore = null;
}

export function ResourceCacheProvider({ children }) {
  // One store per provider instance, created once.
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createResourceStore();

  const value = useMemo(() => storeRef.current, []);

  return (
    <ResourceCacheContext.Provider value={value}>
      {children}
    </ResourceCacheContext.Provider>
  );
}

/**
 * Read the cache directly — for mutations that need to invalidate.
 * Falls back to a real module-level store when no provider is mounted, so a
 * component is never left waiting on a cache that will never answer.
 */
export function useResourceCache() {
  return useContext(ResourceCacheContext) ?? getFallbackStore();
}

/**
 * Subscribe to one cached resource.
 *
 * @param {string|null} key Cache key. `null` disables the resource entirely — use
 *   it for a request that depends on something not yet known (an id, a session).
 * @param {() => Promise<any>} fetcher
 * @param {object} [options]
 * @param {number} [options.staleTime] ms before a re-read refetches. MUST be chosen
 *   per domain: long for static content, short for money.
 * @param {boolean} [options.enabled]
 * @returns {{
 *   data: any, error: Error|null, status: string,
 *   isLoading: boolean, isRefreshing: boolean, isStale: boolean,
 *   updatedAt: number|null, refresh: () => Promise<any>
 * }}
 */
export function useResource(key, fetcher, { staleTime = 0, enabled = true } = {}) {
  const cache = useResourceCache();
  const [, forceRender] = useState(0);

  // The fetcher is almost always an inline arrow, so depending on its identity
  // would refetch on every render. The key is the identity that matters.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return undefined;
    return cache.subscribe(key, () => forceRender((n) => n + 1));
  }, [cache, key]);

  useEffect(() => {
    if (!key || !enabled) return;
    cache.load(key, () => fetcherRef.current(), { staleTime }).catch(() => {
      // The error is already on the entry; an unhandled rejection here would just
      // be noise in the console.
    });
  }, [cache, key, enabled, staleTime]);

  const entry = key ? cache.getEntry(key) : emptyEntry();

  const refresh = useCallback(() => {
    if (!key) return Promise.resolve();
    return cache.load(key, () => fetcherRef.current(), { force: true }).catch(() => {});
  }, [cache, key]);

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    // "Loading" means there is nothing to show yet. A refresh over existing data is
    // `isRefreshing`, which should not blank the screen.
    isLoading: entry.status === RESOURCE_STATUS.LOADING,
    isRefreshing: entry.isRefreshing,
    isStale: entry.updatedAt == null
      ? entry.status === RESOURCE_STATUS.SUCCESS
      : Date.now() - entry.updatedAt >= staleTime,
    updatedAt: entry.updatedAt,
    refresh,
  };
}

/**
 * Suggested stale times.
 *
 * Not defaults — callers pass one explicitly — but a single place to look so two
 * screens showing the same kind of data do not disagree about how old it may be.
 * The audit is explicit that staleness must be domain-specific.
 */
export const STALE_TIME = {
  /** Published content: FAQs, legal copy, app config. Changes on a deploy. */
  STATIC: 10 * 60 * 1000,
  /** Fund catalogue and research. Stale-while-revalidate is fine. */
  CATALOGUE: 2 * 60 * 1000,
  /** Eligibility. A UX cache only — the server re-checks on every write. */
  ELIGIBILITY: 60 * 1000,
  /** Money: portfolio, payments, mandates, transactions. Short, and always shown
   *  with its `updatedAt`. */
  MONEY: 15 * 1000,
  /** Never reuse. For a read that must be current at the moment of asking. */
  NONE: 0,
};
