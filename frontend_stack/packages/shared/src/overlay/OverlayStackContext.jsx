import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * A LIFO registry of open overlays — sheets, dialogs, drawers, confirmations.
 *
 * Overlays in this app are page state, not router state: a bottom sheet opens by
 * flipping a boolean, so the URL does not change. That is a reasonable choice, but
 * it makes every overlay invisible to Android's Back button, which then navigates
 * the page *underneath* the open sheet. The user's mental model — "Back closes
 * this" — is violated by the one gesture Android users rely on most.
 *
 * Moving every dialog into the router would be a much larger change and would put
 * transient UI in the address bar. Instead each overlay registers itself here
 * while open, and the back coordinator asks this stack first. Escape handling is
 * centralised for the same reason: it belongs to whichever overlay is on top, not
 * to all of them at once.
 */

const OverlayStackContext = createContext(null);

let nextOverlayId = 0;

export function OverlayStackProvider({ children }) {
  // The array is state so consumers can react to depth; the ref mirrors it so the
  // back handler reads the current stack without being re-registered on every
  // change (a stale closure here means Back stops closing overlays).
  const [overlays, setOverlays] = useState([]);
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;

  const register = useCallback((entry) => {
    const id = `overlay-${nextOverlayId += 1}`;
    setOverlays((current) => [...current, { id, ...entry }]);
    return id;
  }, []);

  const unregister = useCallback((id) => {
    setOverlays((current) => current.filter((entry) => entry.id !== id));
  }, []);

  /**
   * Dismiss the top overlay.
   * @returns {boolean} true if something was dismissed, so the caller (Back or
   *   Escape) knows whether to keep looking for something else to do.
   */
  const dismissTop = useCallback(() => {
    const stack = overlaysRef.current;
    if (stack.length === 0) return false;

    const top = stack[stack.length - 1];

    // An overlay can refuse to be dismissed by Back — a payment confirmation
    // mid-submit, for instance. It stays on the stack and reports handled, so Back
    // does not fall through and navigate away from a transaction in progress.
    if (top.dismissible === false) return true;

    try {
      top.onDismiss?.();
    } catch {
      // A throwing dismiss handler must not wedge the back button.
    }
    unregister(top.id);
    return true;
  }, [unregister]);

  // One Escape listener for the whole app, targeting only the top overlay. Each
  // overlay adding its own listener meant Escape closed all of them at once.
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      if (overlaysRef.current.length === 0) return;
      event.preventDefault();
      dismissTop();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismissTop]);

  const value = useMemo(() => ({
    overlays,
    depth: overlays.length,
    hasOverlay: overlays.length > 0,
    register,
    unregister,
    dismissTop,
  }), [overlays, register, unregister, dismissTop]);

  return (
    <OverlayStackContext.Provider value={value}>
      {children}
    </OverlayStackContext.Provider>
  );
}

/**
 * Read the overlay stack.
 *
 * Returns a null-object when no provider is mounted rather than throwing: overlay
 * components are rendered in tests and in the browser builds where the native root
 * may be absent, and an overlay must not become unopenable just because Back
 * coordination is unavailable.
 */
export function useOverlayStack() {
  return useContext(OverlayStackContext) ?? {
    overlays: [],
    depth: 0,
    hasOverlay: false,
    register: () => null,
    unregister: () => {},
    dismissTop: () => false,
  };
}

/**
 * Register an open overlay for the lifetime of the component.
 *
 * @param {boolean} isOpen Registered only while true.
 * @param {object} options
 * @param {() => void} options.onDismiss Called when Back or Escape dismisses it.
 * @param {boolean} [options.dismissible] false to absorb Back without closing —
 *   for a step that must not be abandoned by accident.
 */
export function useOverlayRegistration(isOpen, { onDismiss, dismissible = true } = {}) {
  const { register, unregister } = useOverlayStack();

  // Kept in a ref so a re-created callback does not unregister and re-register the
  // overlay, which would reorder the stack and break LIFO.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!isOpen) return undefined;
    const id = register({
      dismissible,
      onDismiss: () => dismissRef.current?.(),
    });
    return () => unregister(id);
  }, [isOpen, dismissible, register, unregister]);
}
