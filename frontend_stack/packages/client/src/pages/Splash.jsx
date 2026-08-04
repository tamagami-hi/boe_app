import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store/SessionContext.jsx';
import * as authApi from '../services/authApi.js';
import logoOnDark from '@beonedge/shared/assets/logo-on-dark.svg';

// The splash must stay visible this long on every launch, even when the
// backend answers immediately.
const SPLASH_MIN_VISIBLE_MS = 1600;

function isAdmin(user) {
  return (
    String(user?.role || '').toLowerCase() === 'admin' ||
    user?.roles?.some((value) => String(value).toLowerCase() === 'admin')
  );
}

export default function Splash() {
  const navigate = useNavigate();
  const { user, isLoading } = useSession();
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    if (isLoading) return undefined;
    let cancelled = false;
    let t;
    setUnreachable(false);
    authApi
      .checkReachability()
      .then((r) => {
        if (cancelled) return;
        if (!r?.ok) {
          setUnreachable(true);
          return;
        }
        const elapsed = Date.now() - mountedAtRef.current;
        const holdMs = Math.max(SPLASH_MIN_VISIBLE_MS - elapsed, 0);
        t = setTimeout(() => {
          if (cancelled) return;
          navigate(user ? (isAdmin(user) ? '/admin' : '/app/dashboard') : '/app/login', { replace: true });
        }, holdMs);
      })
      .catch(() => {
        if (!cancelled) setUnreachable(true);
      });
    return () => { cancelled = true; clearTimeout(t); };
  }, [navigate, user, isLoading, attempt]);

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
          <button type="button" className="be-btn be-btn-primary" onClick={() => setAttempt((n) => n + 1)}>
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
