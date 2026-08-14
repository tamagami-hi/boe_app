import { useEffect, useRef } from 'react';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { useAdminCacheActions } from './adminResources.js';

// Mirrors ClientCacheEvictor: privileged admin collections must not outlive their
// session. Only a transition away from a known operator clears, so the initial
// null -> user of a session restore does not discard what the shell just read.
export default function AdminCacheEvictor() {
  const { user } = useAdminSession();
  const { clearAll } = useAdminCacheActions();
  const previousUserId = useRef(null);

  useEffect(() => {
    const currentId = user?.id ?? null;
    const previousId = previousUserId.current;
    previousUserId.current = currentId;
    if (previousId != null && previousId !== currentId) clearAll();
  }, [user?.id, clearAll]);

  return null;
}
