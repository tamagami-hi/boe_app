import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlayBehavior } from './useOverlayBehavior.js';
import useBreakpoint from '../hooks/useBreakpoint.js';
import './AdaptiveDialog.css';

/**
 * One overlay contract, two presentations.
 *
 * On a phone it docks to the bottom of the screen — reachable with a thumb, and the
 * convention Android users already know. On a wide viewport it centres as a dialog,
 * because a full-width sheet on a desktop admin screen looks like a mistake.
 *
 * This replaces five hand-rolled overlays in the client pages, each of which had a
 * different subset of the required behaviour and closed on a different event (one
 * on `onMouseDown`, one only on backdrop click, one not at all). All the behaviour
 * lives in `useOverlayBehavior`: portal, focus trap and restore, ref-counted body
 * lock, and registration with the overlay stack so Android Back and Escape close
 * the top overlay and nothing else.
 *
 * Accessibility details that were wrong before and are fixed here:
 *   - `role="dialog"` and `aria-modal` belong on the PANEL, not the backdrop. The
 *     client sheet put them on the backdrop, so assistive technology treated the
 *     dimmed background as the dialog.
 *   - The accessible name comes from the rendered title via `aria-labelledby`
 *     rather than a duplicated `aria-label` string that could drift from it.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.title Required: an unnamed dialog is unusable with a screen reader.
 * @param {React.ReactNode} [props.footer] Sticky action area, safe-area padded.
 * @param {boolean} [props.dismissible] false to require an explicit action.
 * @param {'sheet'|'dialog'|'auto'} [props.presentation]
 * @param {'default'|'destructive'} [props.tone]
 */
export default function AdaptiveDialog({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  dismissible = true,
  presentation = 'auto',
  tone = 'default',
  className = '',
}) {
  const isNarrow = useBreakpoint(768);
  const { panelRef } = useOverlayBehavior({ open, onClose, dismissible });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const mode = presentation === 'auto' ? (isNarrow ? 'sheet' : 'dialog') : presentation;
  const titleId = `be-dialog-title-${title.replace(/\s+/g, '-').toLowerCase()}`;
  const descriptionId = description ? `${titleId}-desc` : undefined;

  const overlay = (
    <div
      className={`be-dialog-backdrop be-dialog-backdrop--${mode}`}
      // Backdrop dismissal is `onClick`, not `onMouseDown`: one page used mousedown,
      // which closed the overlay when a drag started inside the panel and ended
      // outside it — losing whatever the user had typed.
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={`be-dialog be-dialog--${mode} be-dialog--${tone} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {mode === 'sheet' && <div className="be-dialog__handle" aria-hidden="true" />}

        <div className="be-dialog__head">
          <h2 className="be-dialog__title" id={titleId}>{title}</h2>
          {dismissible && (
            <button type="button" className="be-dialog__close" onClick={onClose} aria-label="Close">
              <X size={20} strokeWidth={1.5} />
            </button>
          )}
        </div>

        {description && (
          <p className="be-dialog__description" id={descriptionId}>{description}</p>
        )}

        <div className="be-dialog__body">{children}</div>

        {footer && <div className="be-dialog__foot">{footer}</div>}
      </div>
    </div>
  );

  // Portal to body so no ancestor `transform`, `filter` or `overflow` can clip or
  // reposition the overlay. The client CSS documents having hit exactly that.
  return createPortal(overlay, document.body);
}
