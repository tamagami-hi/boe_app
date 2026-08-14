import React from 'react';
import { createPortal } from 'react-dom';
import { useOverlayBehavior } from '@beonedge/shared/overlay/useOverlayBehavior.js';

/**
 * The shell for the client pages' bottom sheets.
 *
 * Five pages — Transactions, Statements, MandateDetail, Security and Portfolio —
 * each hand-rolled this wrapper, and no two agreed:
 *
 *   - Transactions and Security put `role="dialog"` on the BACKDROP, so assistive
 *     technology treated the dimmed background as the dialog.
 *   - Portfolio closed on `onMouseDown`, so a drag that started inside the panel and
 *     ended outside it dismissed the sheet — losing a part-entered redemption.
 *   - None of them rendered through a portal, locked body scroll, trapped focus, or
 *     restored focus afterwards.
 *   - None of them were visible to Android Back, so Back navigated the screen
 *     underneath an open sheet.
 *
 * This component owns only the wrapper. Each page keeps its existing inner markup
 * and `.apk-sheet-*` classes, so the visual result is unchanged and the diff stays
 * reviewable — the point of this task is behaviour, not a repaint.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.label Accessible name. Required.
 * @param {boolean} [props.dismissible] false while a submit is in flight, so a
 *   stray tap or Back press cannot abandon it.
 * @param {string} [props.className] Extra classes on the panel.
 */
export default function PageSheet({
  open,
  onClose,
  label,
  dismissible = true,
  className = '',
  children,
}) {
  const { panelRef } = useOverlayBehavior({ open, onClose, dismissible });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const panelClasses = ['apk-sheet', className].filter(Boolean).join(' ');

  const sheet = (
    <div
      className="apk-sheet-overlay is-open"
      // `onClick`, never `onMouseDown` — see the note above.
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={panelClasses}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
