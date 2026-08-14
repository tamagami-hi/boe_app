import { useEffect, useRef } from 'react';
import { useSession } from '../store/SessionContext.jsx';
import { useClientCacheActions } from './clientResources.js';

/**
 * Drops the cached client data when the signed-in principal goes away or changes.
 *
 * Without this, a cache that survives the session is a data-leak: sign out on a
 * shared device, sign in as someone else, and the previous investor's portfolio
 * valuation is still sitting in the store, ready to be rendered by the first screen
 * that reads it before its own request lands. `clear` (not `invalidate`) is
 * deliberate — invalidated entries keep their data while refetching, which is
 * exactly the wrong behaviour here.
 *
 * Mounted INSIDE both SessionProvider and ResourceCacheProvider, as a component
 * rather than logic in SessionContext, because the session provider sits above the
 * cache in the tree and must not depend on it.
 *
 * Renders nothing.
 */
export default function ClientCacheEvictor() {
  const { user } = useSession();
  const { clearAll } = useClientCacheActions();

  // Only a transition AWAY FROM a known user clears. The initial
  // `null -> user` of a session restore must not, or a cold start would discard
  // whatever the launch path had already fetched.
  const previousUserId = useRef(null);

  useEffect(() => {
    const currentId = user?.id ?? null;
    const previousId = previousUserId.current;
    previousUserId.current = currentId;

    if (previousId != null && previousId !== currentId) {
      clearAll();
    }
  }, [user?.id, clearAll]);

  return null;
}
