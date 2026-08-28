import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, listFromPayload } from '@beonedge/client/services/_util.js';

// Cursor-paginated admin list loader.
//
// The canonical `/v1/admin/*` list endpoints page with an authenticated opaque
// keyset cursor (`?after=&limit=`) and report `meta.page.nextCursor` — not
// offset/total. This hook owns that protocol so screens only deal with `items`
// plus `loadMore()` over the canonical backend transport.
//
//   const { items, loading, error, hasMore, loadMore, reload } =
//     useAdminList('/v1/admin/users', { status: 'active', q: search });

export default function useAdminList(path, filters = {}, { limit = 25 } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState(null);
  const reqRef = useRef(0);

  // Serialize filters so the effect only re-runs when a value really changes.
  // `all` and empty values mean "no filter" and are dropped from the query.
  const filterKey = JSON.stringify(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all')
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  const activeFilters = useMemo(() => Object.fromEntries(JSON.parse(filterKey)), [filterKey]);

  const fetchPage = useCallback(
    async (after) => {
      const reqId = ++reqRef.current;
      setLoading(true);
      setError('');

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      for (const [key, value] of Object.entries(activeFilters)) params.set(key, String(value));
      if (after) params.set('after', after);

      try {
        const payload = await apiRequest(`${path}?${params.toString()}`, {
          scope: 'admin',
          envelope: true,
        });
        if (reqId !== reqRef.current) return;
        const rows = listFromPayload(payload?.data);
        setItems((previous) => (after ? [...previous, ...rows] : rows));
        setNextCursor(payload?.meta?.page?.nextCursor ?? null);
        setLoading(false);
      } catch (requestError) {
        if (reqId !== reqRef.current) return;
        if (!after) setItems([]);
        setNextCursor(null);
        setError(requestError?.message || 'Could not load data.');
        setLoading(false);
      }
    },
    [path, limit, activeFilters],
  );

  const loadMore = useCallback(() => {
    if (nextCursor === null || loading) return;
    void fetchPage(nextCursor);
  }, [fetchPage, loading, nextCursor]);

  const reload = useCallback(() => {
    void fetchPage(null);
  }, [fetchPage]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, loading, error, hasMore: nextCursor !== null, loadMore, reload };
}
