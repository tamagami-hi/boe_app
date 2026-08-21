import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

const ResourceCacheContext = createContext(null);

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

  const invalidate = (keyOrPrefix, { exact = false } = {}) => {
    for (const key of store.keys()) {
      const matches = exact ? key === keyOrPrefix : key.startsWith(keyOrPrefix);
      if (!matches) continue;
      const current = store.get(key);
      store.set(key, { ...current, updatedAt: null });
      notify(key);
    }
  };

  const clear = (keyOrPrefix) => {
    for (const key of [...store.keys()]) {
      if (keyOrPrefix && !key.startsWith(keyOrPrefix)) continue;
      store.delete(key);
      notify(key);
    }
  };

  return { getEntry, subscribe, load, invalidate, clear };
}

let fallbackStore = null;
function getFallbackStore() {
  if (!fallbackStore) fallbackStore = createResourceStore();
  return fallbackStore;
}

export function __resetFallbackResourceStore() {
  fallbackStore = null;
}

export function ResourceCacheProvider({ children }) {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createResourceStore();

  const value = useMemo(() => storeRef.current, []);

  return (
    <ResourceCacheContext.Provider value={value}>
      {children}
    </ResourceCacheContext.Provider>
  );
}

export function useResourceCache() {
  return useContext(ResourceCacheContext) ?? getFallbackStore();
}

export function useResource(key, fetcher, { staleTime = 0, enabled = true } = {}) {
  const cache = useResourceCache();
  const [, forceRender] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return undefined;
    return cache.subscribe(key, () => forceRender((n) => n + 1));
  }, [cache, key]);

  useEffect(() => {
    if (!key || !enabled) return;
    cache.load(key, () => fetcherRef.current(), { staleTime }).catch(() => {});
  }, [cache, key, enabled, staleTime]);

  const entry = key ? cache.getEntry(key) : emptyEntry();

  const invalidated = entry.status === RESOURCE_STATUS.SUCCESS && entry.updatedAt == null;
  useEffect(() => {
    if (!key || !enabled || !invalidated) return;
    cache.load(key, () => fetcherRef.current(), { staleTime }).catch(() => {});
  }, [cache, key, enabled, staleTime, invalidated]);

  const refresh = useCallback(() => {
    if (!key) return Promise.resolve();
    return cache.load(key, () => fetcherRef.current(), { force: true }).catch(() => {});
  }, [cache, key]);

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    isLoading: entry.status === RESOURCE_STATUS.LOADING,
    isRefreshing: entry.isRefreshing,
    isStale: entry.updatedAt == null
      ? entry.status === RESOURCE_STATUS.SUCCESS
      : Date.now() - entry.updatedAt >= staleTime,
    updatedAt: entry.updatedAt,
    refresh,
  };
}

export const STALE_TIME = {
  STATIC: 10 * 60 * 1000,
  CATALOGUE: 2 * 60 * 1000,
  ELIGIBILITY: 60 * 1000,
  MONEY: 15 * 1000,
  NONE: 0,
};
