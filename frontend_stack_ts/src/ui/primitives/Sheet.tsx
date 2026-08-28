import { useEffect, useId, useRef } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"

import styles from "./Overlay.module.css"

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
      className={styles.scrim}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
    >
      <div
        ref={panel}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
      >
        <span className={styles.grip} aria-hidden="true" />
        <div className={styles.head}>
          <h2 className={styles.title} id={`${id}-title`}>
            {title}
          </h2>
          {description === undefined ? null : (
            <p className={styles.description}>{description}</p>
          )}
        </div>
        {children === undefined ? null : <div className={styles.body}>{children}</div>}
        {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
