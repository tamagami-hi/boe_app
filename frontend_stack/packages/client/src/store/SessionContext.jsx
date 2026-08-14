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

const SessionContext = createContext({
  user: null,
  status: SESSION_STATUS.RESTORING,
  isLoading: true,
  error: null,
  login: async () => {},
  logout: async () => {},
});

export function SessionProvider({ children }) {
  const [session, setSession] = useState(initialSessionState);

  useEffect(() => {
    let cancelled = false;

    // The vault must be read before the first authenticated request: on native the
    // tokens live in Secure Storage, which is async, and `apiRequest` reads them
    // synchronously. Racing the two produced an unauthenticated probe on a cold
    // start with a perfectly valid stored session.
    hydrateSessionVault()
      .then(() => authApi.currentUser({ scope: 'client' }))
      .then((user) => {
        if (cancelled) return;
        setSession(user ? authenticatedState(user) : anonymousState());
      })
      .catch((error) => {
        if (cancelled) return;
        // A timeout or a 5xx is not a logout. Keeping the reason lets the UI say
        // the app could not reach the backend instead of implying the user was
        // signed out.
        setSession(anonymousState(isRestoreFailure(error) ? error : null));
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onInvalidate(e) {
      if (e.detail?.scope === 'client' || !e.detail?.scope) {
        setSession(expiredState());
      }
    }
    window.addEventListener('boe:session-invalidated', onInvalidate);
    return () => window.removeEventListener('boe:session-invalidated', onInvalidate);
  }, []);

  const login = useCallback(async (creds) => {
    const user = await authApi.login(creds, { scope: 'client' });
    setSession(authenticatedState(user));
    return user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout({ scope: 'client' });
    setSession(anonymousState());
  }, []);

  // Memoized: an unmemoized object literal re-rendered every consumer of this
  // context on any parent render, which for the client shell is the whole app.
  const value = useMemo(() => ({
    user: session.user,
    status: session.status,
    error: session.error,
    endedReason: session.endedReason,
    // Retained for the existing call sites. `status` is the richer signal and is
    // what new code should branch on.
    isLoading: session.status === SESSION_STATUS.RESTORING,
    login,
    logout,
  }), [session, login, logout]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() { return useContext(SessionContext); }
