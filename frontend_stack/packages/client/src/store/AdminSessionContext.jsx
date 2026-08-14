import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../services/authApi.js';
import { hydrateSessionVault } from '../auth/sessionVault.js';
import {
  SESSION_STATUS,
  anonymousState,
  expiredState,
  authenticatedState,
  initialSessionState,
  isRestoreFailure,
} from './sessionState.js';

const AdminSessionContext = createContext({
  user: null,
  status: SESSION_STATUS.RESTORING,
  isLoading: true,
  error: null,
  login: async () => {},
  logout: async () => {},
});

export function AdminSessionProvider({ children }) {
  const [session, setSession] = useState(initialSessionState);

  useEffect(() => {
    let cancelled = false;

    // Same contract as the client provider. The admin APK also uses bearer tokens
    // from the vault; the browser admin uses cookies, where hydration is a cheap
    // no-op that still yields the cached principal and CSRF token.
    hydrateSessionVault()
      .then(() => authApi.currentUser({ scope: 'admin' }))
      .then((user) => {
        if (cancelled) return;
        setSession(user ? authenticatedState(user) : anonymousState());
      })
      .catch((error) => {
        if (cancelled) return;
        setSession(anonymousState(isRestoreFailure(error) ? error : null));
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onInvalidate(e) {
      if (e.detail?.scope === 'admin') {
        setSession(expiredState());
      }
    }
    window.addEventListener('boe:session-invalidated', onInvalidate);
    return () => window.removeEventListener('boe:session-invalidated', onInvalidate);
  }, []);

  const login = useCallback(async (creds) => {
    const user = await authApi.login(creds, { scope: 'admin' });
    setSession(authenticatedState(user));
    return user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout({ scope: 'admin' });
    setSession(anonymousState());
  }, []);

  // Memoized. The admin console polls approvals on a timer, and an unmemoized
  // context value made every one of those ticks re-render every consumer.
  const value = useMemo(() => ({
    user: session.user,
    status: session.status,
    error: session.error,
    endedReason: session.endedReason,
    isLoading: session.status === SESSION_STATUS.RESTORING,
    login,
    logout,
  }), [session, login, logout]);

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  return useContext(AdminSessionContext);
}
