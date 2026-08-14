import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  CONNECTIVITY,
  getConnectivity,
  reportTransportOutcome,
  setConnectivity,
  subscribeToConnectivity,
} from '@beonedge/shared/net/connectivity.js';

// One place that knows whether the app can reach BeOnEdge. State lives in the shared
// module store (net/connectivity.js) so the transport can report into it; this
// provider mirrors it into React and feeds OS events back.
//
// Two signals, because neither alone is enough: navigator.onLine is instant but only
// means "the OS has an interface", and a probe is authoritative but costs a round
// trip, so it runs only when something already went wrong or we just came back.

export { CONNECTIVITY };

const NetworkStatusContext = createContext(null);

/**
 * @param {object} props
 * @param {() => Promise<boolean>} [props.probe] Resolves true when the API answered.
 */
export default function NetworkStatusProvider({ probe, children }) {
  const [snapshot, setSnapshot] = useState(getConnectivity);

  useEffect(() => {
    setSnapshot(getConnectivity());
    return subscribeToConnectivity(setSnapshot);
  }, []);

  // `offline` is trustworthy in the negative direction, so it applies immediately.
  // `online` only means an interface appeared, so it triggers a probe rather than
  // declaring success.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onOffline = () => setConnectivity(CONNECTIVITY.OFFLINE);
    const onOnline = () => {
      if (!probe) {
        setConnectivity(CONNECTIVITY.ONLINE);
        return;
      }
      probe()
        .then((ok) => reportTransportOutcome(ok))
        .catch(() => reportTransportOutcome(false));
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [probe]);

  /** Manual retry, for a "Try again" button. */
  const recheck = useCallback(async () => {
    if (!probe) return getConnectivity().status === CONNECTIVITY.ONLINE;
    try {
      const ok = await probe();
      reportTransportOutcome(ok);
      return ok;
    } catch {
      reportTransportOutcome(false);
      return false;
    }
  }, [probe]);

  const value = useMemo(() => ({
    status: snapshot.status,
    isOnline: snapshot.status === CONNECTIVITY.ONLINE,
    /** Offline AND unreachable: both mean anything on screen may be stale. */
    isDegraded: snapshot.status !== CONNECTIVITY.ONLINE,
    lastChangeAt: snapshot.changedAt,
    lastSuccessAt: snapshot.lastSuccessAt,
    reportTransportFailure: () => reportTransportOutcome(false),
    reportTransportSuccess: () => reportTransportOutcome(true),
    recheck,
  }), [snapshot, recheck]);

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

/** Reads the store directly without a provider, so it works in tests and on web. */
export function useNetworkStatus() {
  const fromContext = useContext(NetworkStatusContext);
  if (fromContext) return fromContext;
  const snapshot = getConnectivity();
  return {
    status: snapshot.status,
    isOnline: snapshot.status === CONNECTIVITY.ONLINE,
    isDegraded: snapshot.status !== CONNECTIVITY.ONLINE,
    lastChangeAt: snapshot.changedAt,
    lastSuccessAt: snapshot.lastSuccessAt,
    reportTransportFailure: () => reportTransportOutcome(false),
    reportTransportSuccess: () => reportTransportOutcome(true),
    recheck: async () => snapshot.status === CONNECTIVITY.ONLINE,
  };
}
