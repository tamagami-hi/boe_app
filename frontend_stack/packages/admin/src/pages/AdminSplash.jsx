import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import logoOnRed from '@beonedge/shared/assets/logo-on-red.svg';
import '@beonedge/client/styles/mobile/index.css';
import '../styles/desktop/admin.css';

// The admin launch screen. Deliberately mirrors the client splash
// (packages/client/src/pages/Splash.jsx) in structure and timing, and reuses its
// .apk-splash* classes, so the two apps feel like one product — with the red
// treatment that distinguishes an admin build from a client one everywhere else
// (launcher icon, native splash).
//
// The red must be the exact #FF0000 the native splash uses. Android shows that
// native image first and this screen replaces it, so any difference in shade
// would read as a flash at handoff rather than a continuous launch.

// Held for the same duration as the client splash, so a fast backend does not
// produce a screen that flickers past unread.
const SPLASH_MIN_VISIBLE_MS = 1600;

export default function AdminSplash() {
  const navigate = useNavigate();
  const { user, isLoading } = useAdminSession();
  const mountedAtRef = useRef(Date.now());
  const [held, setHeld] = useState(false);

  useEffect(() => {
    // Wait for the session probe to settle before deciding where to go, so an
    // already-signed-in admin is not bounced through the login screen.
    if (isLoading) return undefined;

    const elapsed = Date.now() - mountedAtRef.current;
    const holdMs = Math.max(SPLASH_MIN_VISIBLE_MS - elapsed, 0);
    const timer = setTimeout(() => {
      setHeld(true);
      navigate(user ? '/admin/overview' : '/admin/login', { replace: true });
    }, holdMs);

    return () => clearTimeout(timer);
  }, [navigate, user, isLoading]);

  return (
    <div className="apk-splash is-admin" role="status" aria-live="polite">
      <div className="apk-splash-brand">
        {/* Decorative: "BeOnEdge" is stated as text beside it, so announcing the
            mark again would just repeat it to a screen reader. */}
        <img className="apk-logo-img apk-splash-logo" src={logoOnRed} alt="" aria-hidden="true" />
        <span className="apk-admin-wordmark">
          <span className="apk-splash-name-mask">
            <span className="apk-splash-name">BeOnEdge</span>
          </span>
          {/* Sits under the wordmark and flush with its right edge — a small
              qualifier on the brand, not a second brand. */}
          <span className="apk-splash-role">ADMIN</span>
        </span>
      </div>
      {held ? null : <div className="apk-splash-spinner" aria-hidden="true" />}
      <div className="apk-splash-disc">Internal operations console.</div>
    </div>
  );
}
