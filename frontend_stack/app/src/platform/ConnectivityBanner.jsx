import React, { useRef, useState } from 'react';
import { CONNECTIVITY, useNetworkStatus } from './NetworkStatusProvider.jsx';
import './ConnectivityBanner.css';

// The one place the app tells the user it cannot reach BeOnEdge. Nothing read the
// connectivity provider before this: every screen decided for itself, and most
// rendered a dropped connection as an empty list.
//
// Wording separates the two cases, because the fix differs: offline is the user's
// network, unreachable is ours.
const COPY = {
  [CONNECTIVITY.OFFLINE]: {
    title: 'No connection',
    body: 'Anything on screen was loaded earlier and may be out of date.',
  },
  [CONNECTIVITY.UNREACHABLE]: {
    title: 'Cannot reach BeOnEdge',
    body: 'Your connection is working but our service did not answer. Values shown may be out of date.',
  },
};

export default function ConnectivityBanner() {
  const { status, isDegraded, recheck } = useNetworkStatus();
  const [checking, setChecking] = useState(false);
  const lockRef = useRef(false);

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

  if (!isDegraded) return null;
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
