import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store/SessionContext.jsx';
import { SESSION_STATUS } from '../store/sessionState.js';
import * as authApi from '../services/authApi.js';
import { HOME_PATH } from '../navigation/routes.js';
import logoOnDark from '@beonedge/shared/assets/logo-on-dark.svg';

/**
 * The splash must stay visible this long on every launch, even when everything
 * answers immediately.
 *
 * INTENTIONAL PRODUCT CONSTRAINT — do not shorten or make conditional. The point
 * of the work below is to fit bootstrap *inside* this window, not to shrink it.
 */
const SPLASH_MIN_VISIBLE_MS = 1600;

function isAdmin(user) {
  return (
    String(user?.role || '').toLowerCase() === 'admin' ||
    user?.roles?.some((value) => String(value).toLowerCase() === 'admin')
  );
}

export default function Splash() {
  const navigate = useNavigate();
  const { user, status } = useSession();
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mountedAtRef = useRef(Date.now());

  // Reachability result for the current attempt: null = still in flight.
  const [reachable, setReachable] = useState(null);

  /*
   * Reachability starts on mount, NOT after the session settles.
   *
   * It used to be chained onto the session probe, so the two network round trips
   * ran back to back and the launch cost session + reachability before the 1.6s
   * hold could even be evaluated. On a slow connection that pushed the first
   * usable screen well past the intended window, and the hold — which is supposed
   * to be the floor — became an addition on top.
   *
   * They are independent: the session probe needs no reachability answer, and
   * reachability needs no session. Running them concurrently means the launch
   * costs the slower of the two, and on any healthy start both finish inside the
   * 1.6s the splash is showing anyway, so the hold is the only thing the user
   * waits for.
   */
  useEffect(() => {
    let cancelled = false;
    setReachable(null);
    setUnreachable(false);

    authApi
      .checkReachability()
      .then((result) => {
        if (cancelled) return;
        const ok = Boolean(result?.ok);
        setReachable(ok);
        if (!ok) setUnreachable(true);
      })
      .catch(() => {
        if (cancelled) return;
        setReachable(false);
        setUnreachable(true);
      });

    return () => { cancelled = true; };
  }, [attempt]);

  // Hand off once BOTH bootstrap tasks have settled, never before the hold.
  useEffect(() => {
    const sessionSettled = status !== SESSION_STATUS.RESTORING;
    if (!sessionSettled || reachable !== true) return undefined;

    const elapsed = Date.now() - mountedAtRef.current;
    // Measured from mount, so concurrent work that finished early costs nothing
    // and the splash is shown for exactly its minimum.
    const holdMs = Math.max(SPLASH_MIN_VISIBLE_MS - elapsed, 0);

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      const destination = user
        ? (isAdmin(user) ? '/admin' : HOME_PATH)
        : '/app/login';
      navigate(destination, { replace: true });
    }, holdMs);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [navigate, user, status, reachable]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <div className="apk-splash">
      <div className="apk-splash-brand">
        <img className="apk-logo-img apk-splash-logo" src={logoOnDark} alt="BeOnEdge" />
        <span className="apk-splash-name-mask">
          <span className="apk-splash-name">BeOnEdge</span>
        </span>
      </div>
      {unreachable ? (
        <div className="apk-splash-error" role="alert">
          <p>BeOnEdge servers are not reachable right now. Check your connection and try again.</p>
          <button type="button" className="be-btn be-btn-primary" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <div className="apk-splash-spinner" aria-hidden="true" />
      )}
      <div className="apk-splash-disc">Investments are subject to market risk.</div>
    </div>
  );
}
