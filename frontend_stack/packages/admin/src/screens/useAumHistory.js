import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@beonedge/client/services/_util.js';

const PAGE_LIMIT = 100;

function readPage(payload) {
  const data = payload?.data ?? payload ?? {};
  const page = payload?.meta?.page ?? {};
  const items = Array.isArray(data) ? data : data.items ?? [];
  return {
    items: Array.isArray(items) ? items : [],
    nextCursor: page.nextCursor ?? null,
    hasMore: page.hasMore === true,
  };
}

export default function useAumHistory(fundId) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchPage = useCallback(async (after) => {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (after) params.set('after', after);
    const payload = await apiRequest(
      `/v1/admin/aum/funds/${encodeURIComponent(fundId)}/history?${params.toString()}`,
      { scope: 'admin', envelope: true },
    );
    return readPage(payload);
  }, [fundId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchPage(null);
      setRows(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError('');
      return true;
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the AUM history.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      setRows((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load more history.');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, fetchPage, loadingMore]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, loading, loadingMore, error, hasMore, loadMore, reload };
}
