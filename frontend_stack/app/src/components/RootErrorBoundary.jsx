import React from 'react';
import { ErrorBoundary } from '@beonedge/shared/components/ErrorBoundary.jsx';
import './RootErrorBoundary.css';

/**
 * Last-resort recovery for a crash that escaped every route boundary.
 *
 * The previous fallback offered exactly one action: `window.location.reload()`.
 * In a browser that is reasonable. In the APK it is the worst available option —
 * a reload restarts the WebView document, which re-runs native bootstrap, the
 * update gate and the full 1.6s splash. The user's own words for that are "the app
 * crashed and restarted", which is precisely the impression this whole effort
 * exists to remove.
 *
 * So recovery is offered in order of least destruction:
 *   1. Go to Home — a route change. Keeps the WebView, the session and the warm
 *      caches. Resolves the common case, where one screen threw and the rest of
 *      the app is fine.
 *   2. Reload — kept, but demoted to a secondary action for when the app really is
 *      wedged.
 *
 * Copy is plain and active, and does not tell the user to "refresh the page":
 * there is no page.
 */
function Fallback() {
  return (
    <div className="be-crash" role="alert">
      <div className="be-crash__card">
        <h1 className="be-crash__title">Something went wrong</h1>
        <p className="be-crash__body">
          This screen stopped working. Your account and investments are unaffected.
        </p>

        <div className="be-crash__actions">
          <button
            type="button"
            className="be-crash__btn be-crash__btn--primary"
            onClick={() => {
              // A full navigation rather than router state: the router is inside
              // the tree that just threw, so it cannot be trusted to still work.
              // `replace` keeps the broken entry out of the back stack.
              window.location.replace('/app/dashboard');
            }}
          >
            Go to Home
          </button>
          <button
            type="button"
            className="be-crash__btn"
            onClick={() => window.location.reload()}
          >
            Restart the app
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RootErrorBoundary({ children }) {
  return (
    <ErrorBoundary fallback={<Fallback />}>
      {children}
    </ErrorBoundary>
  );
}
