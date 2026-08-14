import { useEffect, useRef } from 'react';
import { useOverlayRegistration } from './OverlayStackContext.jsx';

/**
 * Everything an overlay must do, in one place.
 *
 * There were three overlay implementations in this codebase and no two of them did
 * the same set of things:
 *
 *   - the client `BottomSheet` trapped focus but had no portal and no body-scroll
 *     lock, so the page scrolled behind it and an ancestor `transform` could clip
 *     it (the client CSS even documents that hazard)
 *   - the admin `Drawer` had a portal, a lock and a trap, but its lock wrote
 *     `document.body.style.overflow` directly, so two nested overlays fought over
 *     it and the second one to close restored the wrong value
 *   - five page-level overlays had none of it, and each closed on a different
 *     event
 *
 * This hook is the single implementation: portal-ready, focus trap with restore,
 * REF-COUNTED body lock, and registration with the overlay stack so Android Back
 * and Escape close the top overlay only.
 *
 * It deliberately owns behaviour and not markup, because the sheet, the drawer and
 * the dialog need to look nothing like each other.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/*
 * Body-scroll lock, ref-counted across every overlay in the app.
 *
 * Naively setting and restoring `body.style.overflow` per overlay is wrong as soon
 * as two are open: closing the inner one restores "scrollable" while the outer one
 * is still up. The count means the lock lifts exactly once, when the last overlay
 * closes, and the original value is captured only on the first lock.
 */
let lockCount = 0;
let previousOverflow = '';
let previousPaddingRight = '';

function lockBodyScroll() {
  if (typeof document === 'undefined') return;
  lockCount += 1;
  if (lockCount > 1) return;

  const { body } = document;
  previousOverflow = body.style.overflow;
  previousPaddingRight = body.style.paddingRight;

  // Compensate for a disappearing scrollbar so the layout does not jump sideways
  // when the overlay opens. No-op on touch devices, which overlay their scrollbars.
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + scrollbarWidth}px`;
  }
  body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;

  document.body.style.overflow = previousOverflow;
  document.body.style.paddingRight = previousPaddingRight;
}

/** Test-only: reset the shared counter between cases. */
export function __resetBodyLockForTests() {
  lockCount = 0;
  previousOverflow = '';
  previousPaddingRight = '';
}

/**
 * @param {object} options
 * @param {boolean} options.open
 * @param {() => void} options.onClose
 * @param {boolean} [options.dismissible] false to absorb Back/Escape without
 *   closing — a step that must not be abandoned by accident.
 * @param {boolean} [options.lockScroll] default true.
 * @returns {{panelRef: React.RefObject}} attach to the panel element.
 */
export function useOverlayBehavior({ open, onClose, dismissible = true, lockScroll = true }) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Back and Escape are handled centrally by the overlay stack, so this hook does
  // NOT add its own keydown listener for Escape. Three separate Escape listeners
  // is how "one press closed every open overlay" happened.
  useOverlayRegistration(open, { onDismiss: onClose, dismissible });

  // Focus trap + restore.
  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;
    const panel = panelRef.current;

    // Move focus in, so a keyboard or screen-reader user is inside the overlay
    // rather than still on the page behind it. Falls back to the panel itself when
    // there is nothing focusable (a message-only dialog).
    const firstFocusable = panel?.querySelector(FOCUSABLE);
    if (firstFocusable) firstFocusable.focus();
    else panel?.focus?.();

    function onKeyDown(event) {
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll(FOCUSABLE))
        // A hidden control is not a real tab stop; including it sent focus
        // somewhere invisible. Checked via `hidden` and computed display/visibility
        // rather than `offsetParent`, which reports null for everything in jsdom
        // and would make this filter reject every element under test.
        .filter((el) => {
          if (el.hidden) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    // Listener on the panel, not the document: a Tab pressed outside an open
    // overlay is not this overlay's business.
    panel?.addEventListener('keydown', onKeyDown);

    return () => {
      panel?.removeEventListener('keydown', onKeyDown);
      // Restoring focus is what makes an overlay feel like part of the app: the
      // user returns to the control they opened it from.
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !lockScroll) return undefined;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open, lockScroll]);

  return { panelRef };
}
