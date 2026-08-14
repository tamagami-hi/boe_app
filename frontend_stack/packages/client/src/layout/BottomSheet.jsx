import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlayBehavior } from '@beonedge/shared/overlay/useOverlayBehavior.js';

/**
 * The client bottom sheet.
 *
 * Keeps its existing `.be-sheet*` markup and classes — call sites and styling are
 * unchanged — but the behaviour now comes from the shared overlay hook. What that
 * fixes, all of which this component previously got wrong:
 *
 *   - **No portal.** It rendered inline, so any ancestor with a `transform`,
 *     `filter` or `overflow` clipped or repositioned it. The client CSS has a
 *     comment documenting exactly that hazard.
 *   - **No body-scroll lock.** The page scrolled behind the open sheet.
 *   - **`role="dialog"` on the backdrop.** Assistive technology treated the dimmed
 *     background as the dialog. It belongs on the panel.
 *   - **Its own Escape listener.** With three overlay implementations each adding
 *     one, a single Escape press closed all of them. Escape is now handled once,
 *     centrally, against the top of the overlay stack.
 *   - **Invisible to Android Back.** Registering with the overlay stack means Back
 *     closes the sheet instead of navigating the screen underneath it.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  showHandle = true,
  showClose = true,
  dismissible = true,
  className = '',
  ...rest
}) {
  const { panelRef } = useOverlayBehavior({ open, onClose, dismissible });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const sheetClasses = ['be-sheet', className].filter(Boolean).join(' ');
  const titleId = title ? `be-sheet-title-${String(title).replace(/\s+/g, '-').toLowerCase()}` : undefined;

  const sheet = (
    <div
      className="be-sheet-overlay is-open"
      onClick={dismissible ? onClose : undefined}
      {...rest}
    >
      <div
        ref={panelRef}
        className={sheetClasses}
        role="dialog"
        aria-modal="true"
        // Named by the rendered heading where there is one, so the name cannot
        // drift from what the user sees.
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : 'Dialog'}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {showHandle && <div className="be-sheet__handle" aria-hidden="true" />}
        {showClose && dismissible && (
          <button
            type="button"
            className="be-sheet__close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        )}
        {title && <h2 className="be-page-header__title" id={titleId}>{title}</h2>}
        {children}
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
