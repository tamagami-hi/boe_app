import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as authApi from '../services/authApi.js';

const SessionContext = createContext({ user: null, isLoading: true, login: async () => {}, logout: async () => {} });

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    authApi.currentUser({ scope: 'client' })
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onInvalidate(e) {
      if (e.detail?.scope === 'client' || !e.detail?.scope) {
        setUser(null);
        setIsLoading(false);
      }
    }
    window.addEventListener('boe:session-invalidated', onInvalidate);
    return () => window.removeEventListener('boe:session-invalidated', onInvalidate);
  }, []);

  const login = useCallback(async (creds) => {
    const u = await authApi.login(creds, { scope: 'client' });
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout({ scope: 'client' });
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() { return useContext(SessionContext); }
