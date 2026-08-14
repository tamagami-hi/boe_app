import React from 'react';
import './BootstrapShell.css';

/**
 * The one thing rendered while the app works out who is signed in.
 *
 * Replaces `return null` in the auth guards. A blank frame is the single most
 * app-unlike thing the APK did: the shell disappeared, then reappeared, which on a
 * phone is indistinguishable from a crash-and-relaunch. This keeps the surface
 * painted in the launch colour so the native splash → WebView → React → app
 * sequence is one continuous colour with no flash.
 *
 * Deliberately not a spinner. Session restore is normally faster than the eye can
 * register, and a spinner that appears for 80ms reads as jank. There is a
 * progress indicator, but it only fades in after a delay (see the CSS), so a fast
 * restore shows nothing but the brand surface.
 *
 * @param {object} props
 * @param {string} [props.label] Announced to assistive technology.
 */
export default function BootstrapShell({ label = 'Starting BeOnEdge' }) {
  return (
    <div className="be-bootstrap" role="status" aria-live="polite" aria-label={label}>
      <div className="be-bootstrap__mark" aria-hidden="true" />
      <span className="be-bootstrap__hint">{label}</span>
    </div>
  );
}
