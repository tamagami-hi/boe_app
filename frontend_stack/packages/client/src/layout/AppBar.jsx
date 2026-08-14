import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HOME_PATH, parentPathOf } from '../navigation/routes.js';

/**
 * The app bar for pushed (secondary) screens.
 *
 * The back affordance used to be an unconditional `navigate(-1)`. That is only
 * correct when the user arrived by tapping through the app. It breaks whenever they
 * did not:
 *
 *   - opened from a notification deep link — no history entry, so Back did nothing,
 *     or worse left the app
 *   - arrived after a redirect — Back returned to the screen that redirected, which
 *     redirected again: a loop the user cannot escape
 *   - landed here from a completed transaction — Back re-entered the finished flow
 *
 * So Back now resolves the route's declared parent from the manifest and navigates
 * there. History is still preferred when it exists and agrees, because popping
 * preserves the parent's scroll position and cached state; the parent path is the
 * guarantee that Back always does something sensible.
 *
 * An explicit `onLeft` still wins — a multi-step flow legitimately needs its own
 * back semantics.
 */
export default function AppBar({ title, leftIcon, onLeft, rightIcon, onRight, rightAriaLabel = 'Action', ...rest }) {
  const navigate = useNavigate();
  const location = useLocation();
  const Left = leftIcon || ArrowLeft;

  function goBack() {
    const parent = parentPathOf(location.pathname);

    // `window.history.state.idx` is React Router's own index into its history
    // stack. 0 means this is the first entry — nothing to pop — which is exactly
    // the deep-link case.
    const historyIndex = typeof window !== 'undefined' ? window.history?.state?.idx : undefined;
    const canPop = typeof historyIndex === 'number' && historyIndex > 0;

    if (canPop) {
      navigate(-1);
      return;
    }
    // No history: go to the logical parent, or Home for a route with no parent.
    navigate(parent || HOME_PATH, { replace: true });
  }

  const handleLeft = onLeft || goBack;

  return (
    <header className="apk-appbar" {...rest}>
      <button type="button" className="apk-appbar-icon" aria-label="Back" onClick={handleLeft}>
        <Left size={22} strokeWidth={1.5} />
      </button>
      <div className="apk-appbar-title">{title}</div>
      {rightIcon ? (
        <button type="button" className="apk-appbar-icon" aria-label={rightAriaLabel} onClick={onRight}>
          {React.createElement(rightIcon, { size: 22, strokeWidth: 1.5 })}
        </button>
      ) : (
        <div className="apk-appbar-spacer" />
      )}
    </header>
  );
}
