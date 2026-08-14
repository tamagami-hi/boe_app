import React, { useEffect, useRef, useState } from 'react';
import { isLaunchInProgress, subscribeToLaunch } from '@beonedge/shared/net/launchGate.js';
import { CONNECTIVITY, useNetworkStatus } from './NetworkStatusProvider.jsx';
import './ConnectivityBanner.css';

const COPY = {
  [CONNECTIVITY.OFFLINE]: {
    title: 'No connection',
    body: 'Anything on screen was loaded earlier and may be out of date.',
  },
  [CONNECTIVITY.UNREACHABLE]: {
    title: 'Cannot reach BeOnEdge',
    body: 'Your connection may be down, or our service is not answering. Values shown may be out of date.',
  },
};

export default function ConnectivityBanner() {
  const { status, isDegraded, recheck } = useNetworkStatus();
  const [checking, setChecking] = useState(false);
  const [launching, setLaunching] = useState(isLaunchInProgress);
  const lockRef = useRef(false);

  useEffect(() => {
    setLaunching(isLaunchInProgress());
    return subscribeToLaunch(setLaunching);
  }, []);

  async function onRetry() {
    if (lockRef.current) return;
    lockRef.current = true;
    setChecking(true);
    try {
      await recheck();
    } finally {
      lockRef.current = false;
      setChecking(false);
    }
  }

  if (launching || !isDegraded) return null;
  const copy = COPY[status] || COPY[CONNECTIVITY.UNREACHABLE];

  return (
    <div className="be-netbar" role="status" aria-live="polite">
      <div className="be-netbar__text">
        <strong className="be-netbar__title">{copy.title}</strong>
        <span className="be-netbar__body">{copy.body}</span>
      </div>
      <button type="button" className="be-netbar__retry" onClick={onRetry} disabled={checking}>
        {checking ? 'Checking…' : 'Try again'}
      </button>
    </div>
  );
}
