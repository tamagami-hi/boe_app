import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '@beonedge/shared';
// Mounted from two places: ClientApp's in-shell wildcard (where the mobile CSS
// barrel is already loaded by ClientApp) and ClientRoot's top-level wildcard,
// which renders *outside* ClientApp and therefore outside that import. Pull the
// barrel in here so an unknown path is styled either way. Route-level CSS
// splitting is a later task; this import is deliberately the whole barrel
// rather than a partial set that would silently drift.
import '../styles/mobile/index.css';

/**
 * NotFound — the recoverable state for a path that matches no client route.
 *
 * This exists because both wildcards used to redirect to `/app/splash`, which
 * in the APK is indistinguishable from the app relaunching itself: a bad tap
 * looked like a crash and the actual broken link stayed invisible. A dead end
 * must be explainable and recoverable instead.
 *
 * Deliberately NOT the error-boundary fallback: that one offers a full document
 * reload, which on Android re-runs native bootstrap and the 1.6s splash — the
 * exact "this is a website" feel being removed. A route miss is not a crash.
 */
export default function NotFound() {
  const navigate = useNavigate();
  const location = useLocation();

  // The attempted path is the one thing that makes this screen diagnosable when
  // a user reports it, and it is safe to show: it is already in the URL bar and
  // carries no credential or payload. Query/hash are dropped — they are the part
  // most likely to carry identifiers.
  const attemptedPath = location.pathname;

  return (
    <div className="apk-screen">
      <span className="be-eyebrow">Not found</span>
      <h1 className="apk-h">We couldn&apos;t find that screen</h1>

      <EmptyState
        icon={<Compass size={40} strokeWidth={1.5} />}
        title="This link doesn't lead anywhere"
        description="The link may be out of date, or the screen may have moved. Your account and investments are unaffected."
        action={
          /* `apk-actions` is an existing primitive: a wrapping flex row. With
             `be-btn-block` children it stacks full-width buttons at the standard
             gap, so this needs no new CSS class. */
          <div className="apk-actions">
            <button
              type="button"
              className="be-btn be-btn-primary be-btn-block"
              onClick={() => navigate('/app/dashboard', { replace: true })}
            >
              Go to Home
            </button>
            <button
              type="button"
              className="be-btn be-btn-secondary be-btn-block"
              onClick={() => navigate(-1)}
            >
              Go back
            </button>
          </div>
        }
      />

      <p className="be-disclosure">Attempted address: {attemptedPath}</p>
    </div>
  );
}
