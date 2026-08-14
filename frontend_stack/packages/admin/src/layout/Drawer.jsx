import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlayBehavior } from '@beonedge/shared/overlay/useOverlayBehavior.js';
import I from '../components/I.jsx';

/**
 * Right-side editing panel: the standard editing surface for the redesigned admin.
 *
 * Markup and `.ash-drawer*` classes are unchanged. The behaviour moved to the
 * shared overlay hook, which fixes two things this component had subtly wrong:
 *
 *   - **The body-scroll lock was not ref-counted.** It wrote
 *     `document.body.style.overflow` directly and restored the value it captured,
 *     so with two overlays open the inner one's close restored "scrollable" while
 *     the outer was still up. The shared lock counts, and lifts once.
 *   - **It owned its own Escape handler.** Combined with the other overlay
 *     implementations, one Escape press closed several overlays at once. Escape is
 *     now handled centrally against the top of the stack.
 *
 * Registering with the overlay stack also means Android Back closes the drawer —
 * relevant now that the admin console is used on a phone.
 */
export default function Drawer({ open, title, onClose, footer, children, wide = false, dismissible = true }) {
  const { panelRef } = useOverlayBehavior({ open, onClose, dismissible });

  if (!open) return null;

  const titleId = `ash-drawer-title-${String(title || 'panel').replace(/\s+/g, '-').toLowerCase()}`;

  const drawer = (
    <div className="ash-drawer-overlay" onClick={dismissible ? onClose : undefined}>
      <div
        ref={panelRef}
        className={`ash-drawer ${wide ? 'ash-drawer-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ash-drawer-head">
          <h2 className="ash-drawer-title" id={titleId}>{title}</h2>
          {dismissible && (
            <button type="button" className="ash-icon-btn" onClick={onClose} aria-label="Close panel">
              <I icon={X} size={16} />
            </button>
          )}
        </div>
        <div className="ash-drawer-body">{children}</div>
        {footer && <div className="ash-drawer-foot">{footer}</div>}
      </div>
    </div>
  );

  // Portal to body so no ancestor stacking context can clip the panel.
  return createPortal(drawer, document.body);
}
