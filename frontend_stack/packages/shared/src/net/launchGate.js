import { useCallback, useEffect, useRef, useState } from 'react';

export const SPLASH_MIN_VISIBLE_MS = 1600;

export const LAUNCH_PHASE = {
  PROBING: 'probing',
  SLOW: 'slow',
  UNREACHABLE: 'unreachable',
  READY: 'ready',
};

export const SLOW_AFTER_MS = 2500;

let launchOwners = 0;
const launchListeners = new Set();

export function isLaunchInProgress() {
  return launchOwners > 0;
}

export function subscribeToLaunch(listener) {
  launchListeners.add(listener);
  return () => launchListeners.delete(listener);
}

function setLaunchOwned(owned) {
  const before = launchOwners;
  launchOwners = Math.max(0, launchOwners + (owned ? 1 : -1));
  if ((before > 0) !== (launchOwners > 0)) {
    for (const listener of launchListeners) listener(launchOwners > 0);
  }
}

export const RETRY_BACKOFF_MS = [800, 1600, 3200, 6400, 10000];

export function backoffFor(attempt) {
  if (attempt < 1) return RETRY_BACKOFF_MS[0];
  const index = Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1);
  return RETRY_BACKOFF_MS[index];
}

export const LAUNCH_COPY = {
  [LAUNCH_PHASE.PROBING]: null,
  [LAUNCH_PHASE.SLOW]: {
    title: 'Connecting…',
    body: 'Taking longer than usual.',
  },
  [LAUNCH_PHASE.UNREACHABLE]: {
    title: 'Cannot reach BeOnEdge',
    body: 'Your connection may be offline, or our service is not answering. Retrying automatically.',
  },
};

export function useLaunchGate({ probe, sessionSettled, minVisibleMs = SPLASH_MIN_VISIBLE_MS }) {
  const mountedAtRef = useRef(Date.now());
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);
  const timersRef = useRef([]);

  const [reachable, setReachable] = useState(false);
  const [failures, setFailures] = useState(0);
  const [slow, setSlow] = useState(false);
  const [held, setHeld] = useState(minVisibleMs <= 0);
  const [ready, setReady] = useState(false);

  const track = useCallback((timer) => {
    timersRef.current.push(timer);
    return timer;
  }, []);

  const runProbe = useCallback(() => {
    if (cancelledRef.current || !probe) return;
    attemptRef.current += 1;
    const attempt = attemptRef.current;

    Promise.resolve()
      .then(() => probe())
      .then((ok) => {
        if (cancelledRef.current) return;
        if (ok) {
          setReachable(true);
          return;
        }
        setFailures(attempt);
        track(setTimeout(runProbe, backoffFor(attempt)));
      })
      .catch(() => {
        if (cancelledRef.current) return;
        setFailures(attempt);
        track(setTimeout(runProbe, backoffFor(attempt)));
      });
  }, [probe, track]);

  useEffect(() => {
    cancelledRef.current = false;

    if (!probe) {
      setReachable(true);
    } else {
      runProbe();
    }

    const slowTimer = track(setTimeout(() => {
      if (!cancelledRef.current) setSlow(true);
    }, SLOW_AFTER_MS));

    const holdTimer = minVisibleMs > 0
      ? track(setTimeout(() => {
        if (!cancelledRef.current) setHeld(true);
      }, Math.max(minVisibleMs - (Date.now() - mountedAtRef.current), 0)))
      : null;

    return () => {
      cancelledRef.current = true;
      for (const timer of timersRef.current) clearTimeout(timer);
      timersRef.current = [];
      clearTimeout(slowTimer);
      if (holdTimer) clearTimeout(holdTimer);
    };
  }, [probe, runProbe, track, minVisibleMs]);

  useEffect(() => {
    setLaunchOwned(true);
    return () => setLaunchOwned(false);
  }, []);

  useEffect(() => {
    if (held && reachable && sessionSettled) setReady(true);
  }, [held, reachable, sessionSettled]);

  const retryNow = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
    runProbe();
  }, [runProbe]);

  let phase = LAUNCH_PHASE.PROBING;
  if (ready) phase = LAUNCH_PHASE.READY;
  else if (failures > 0) phase = LAUNCH_PHASE.UNREACHABLE;
  else if (slow) phase = LAUNCH_PHASE.SLOW;

  return {
    ready,
    phase,
    copy: LAUNCH_COPY[phase] || null,
    failures,
    reachable,
    retryNow,
  };
}
