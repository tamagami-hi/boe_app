import { useEffect, useId, useRef } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"

import {
  SCRIM,
  SHEET_ACTIONS,
  SHEET_BODY,
  SHEET_DESCRIPTION,
  SHEET_GRIP,
  SHEET_HEAD,
  SHEET_PANEL,
  SHEET_TITLE,
} from "~/ui/recipes/overlay"

export type SheetProps = Readonly<{
  open: boolean
  title: string
  description?: string
  actions?: ReactNode
  onDismiss: () => void
  children?: ReactNode
}>

export const Sheet = ({
  open,
  title,
  description,
  actions,
  onDismiss,
  children,
}: SheetProps): React.ReactElement | null => {
  const id = useId()
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
  }, [open])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      className={SCRIM}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <div
        ref={panel}
        className={SHEET_PANEL}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
      >
        <span className={SHEET_GRIP} aria-hidden="true" />
        <div className={SHEET_HEAD}>
          <h2 className={SHEET_TITLE} id={`${id}-title`}>
            {title}
          </h2>
          {description === undefined ? null : (
            <p className={SHEET_DESCRIPTION}>{description}</p>
          )}
        </div>
        {children === undefined ? null : <div className={SHEET_BODY}>{children}</div>}
        {actions === undefined ? null : <div className={SHEET_ACTIONS}>{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
