import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, isFixtureModeError, listFromPayload, useHttpApi } from '@beonedge/client/services/_util.js';
import { fixtureCollection } from '../fixtures/adminCollections.js';

// Per-collection loading for redesigned pages: each page fetches only the
// data it shows, with a stale-response guard for fast navigation.
//
// Mode-aware: in fixture mode the hook serves local rows instead of calling
// `apiRequest` (which refuses to touch the network off http mode), so the screen
// renders offline rather than showing a request failure. `source` tells the
// screen which it got, and mutations are rejected with a clear message.

export default function useAdminCollection(path) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [source, setSource] = useState(useHttpApi() ? 'http' : 'fixture');
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    const reqId = ++reqRef.current;
    setLoading(true);
    setError('');

    if (!useHttpApi()) {
      const rows = fixtureCollection(path);
      if (reqId !== reqRef.current) return;
      setSource('fixture');
      setItems(rows ?? []);
      setError(rows === null ? 'No offline data for this screen. Start the backend and set VITE_BEO_API_MODE=http.' : '');
      setLoading(false);
      return;
    }

    try {
      const payload = await apiRequest(path, { scope: 'admin' });
      if (reqId !== reqRef.current) return;
      setSource('http');
      setItems(listFromPayload(payload));
      setLoading(false);
    } catch (requestError) {
      if (reqId !== reqRef.current) return;
      // Defensive: a mode flip between the guard and the call lands here.
      if (isFixtureModeError(requestError)) {
        const rows = fixtureCollection(path);
        setSource('fixture');
        setItems(rows ?? []);
        setError(rows === null ? requestError.message : '');
        setLoading(false);
        return;
      }
      setError(requestError?.message || 'Could not load data.');
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { items, loading, error, reload, source };
}
