import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { SESSION_STATUS } from '@beonedge/client/store/sessionState.js';
import { checkReachability } from '@beonedge/client/services/authApi.js';
import { LAUNCH_PHASE, useLaunchGate } from '@beonedge/shared/net/launchGate.js';
import { SYSTEM_BAR_STYLE, useSystemChrome } from '@beonedge/shared/platform/systemBarStyle.js';
import logoOnRed from '@beonedge/shared/assets/logo-on-red.svg';
import '@beonedge/client/styles/mobile/base.css';
import '@beonedge/client/styles/mobile/auth.css';
import '../styles/desktop/admin.css';

export default function AdminSplash() {
  const navigate = useNavigate();
  const { user, status } = useAdminSession();

  const probe = useCallback(async () => {
    const result = await checkReachability();
    return Boolean(result?.ok);
  }, []);

  useSystemChrome(SYSTEM_BAR_STYLE.DARK, '#FF0000');

  const { ready, phase, copy, retryNow } = useLaunchGate({
    probe,
    sessionSettled: status !== SESSION_STATUS.RESTORING,
  });

  useEffect(() => {
    if (!ready) return;
    navigate(user ? '/admin/overview' : '/admin/login', { replace: true });
  }, [ready, navigate, user]);

  return (
    <div className="apk-splash is-admin" role="status" aria-live="polite">
      <div className="apk-splash-brand">
        <img className="apk-logo-img apk-splash-logo" src={logoOnRed} alt="" aria-hidden="true" />
        <span className="apk-admin-wordmark">
          <span className="apk-splash-name-mask">
            <span className="apk-splash-name">BeOnEdge</span>
          </span>
          <span className="apk-splash-role">ADMIN</span>
        </span>
      </div>

      {copy ? (
        <div className="apk-splash-status" data-phase={phase}>
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

      <div className="apk-splash-disc">Internal operations console.</div>
    </div>
  );
}
