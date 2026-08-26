import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store/SessionContext.jsx';
import { SESSION_STATUS } from '../store/sessionState.js';
import * as authApi from '../services/authApi.js';
import { LAUNCH_PHASE, useLaunchGate } from '@beonedge/shared/net/launchGate.js';
import { SYSTEM_BAR_STYLE, useSystemChrome } from '@beonedge/shared/platform/systemBarStyle.js';
import { HOME_PATH } from '../navigation/routes.js';
import logoOnDark from '@beonedge/shared/assets/logo-on-dark.svg';
import { hasRole } from '@beonedge/shared/auth/roles.js';

export default function Splash() {
  const navigate = useNavigate();
  const { user, status } = useSession();

  const probe = useCallback(async () => {
    const result = await authApi.checkReachability();
    return Boolean(result?.ok);
  }, []);

  useSystemChrome(SYSTEM_BAR_STYLE.DARK, '#1800AD');

  const { ready, phase, copy, retryNow } = useLaunchGate({
    probe,
    sessionSettled: status !== SESSION_STATUS.RESTORING,
  });

  useEffect(() => {
    if (!ready) return;
    const destination = user
      ? (hasRole(user, 'admin') ? '/admin' : HOME_PATH)
      : '/app/login';
    navigate(destination, { replace: true });
  }, [ready, navigate, user]);

  return (
    <div className="apk-splash">
      <div className="apk-splash-brand">
        <img className="apk-logo-img apk-splash-logo" src={logoOnDark} alt="BeOnEdge" />
        <span className="apk-splash-name-mask">
          <span className="apk-splash-name">BeOnEdge</span>
        </span>
      </div>

      {copy ? (
        <div
          className="apk-splash-status"
          role="status"
          aria-live="polite"
          data-phase={phase}
        >
          <p className="apk-splash-status-title">{copy.title}</p>
          <p className="apk-splash-status-body">{copy.body}</p>
          {phase === LAUNCH_PHASE.UNREACHABLE ? (
            <button type="button" className="be-btn be-btn-primary" onClick={retryNow}>
              Try now
            </button>
          ) : null}
        </div>
      ) : (
        <div className="apk-splash-spinner" aria-hidden="true" />
      )}

      <div className="apk-splash-disc">Investments are subject to market risk.</div>
    </div>
  );
}
