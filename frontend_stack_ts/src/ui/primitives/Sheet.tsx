import { useCallback, useEffect, useId, useRef } from "react"
import type { KeyboardEvent, ReactNode } from "react"
import { createPortal } from "react-dom"

import {
  SCRIM,
  SHEET_ACTIONS,
  SHEET_BODY,
  SHEET_CLOSE,
  SHEET_DESCRIPTION,
  SHEET_GRIP,
  SHEET_HEAD,
  SHEET_HEAD_ROW,
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

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

const focusableWithin = (root: HTMLElement): readonly HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.getClientRects().length > 0,
  )

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
  const restoreTo = useRef<HTMLElement | null>(null)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (!open) return

    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const node = panel.current
    if (node !== null) {
      const first = focusableWithin(node)[0]
      if (first === undefined) node.focus()
      else first.focus()
    }

    const body = document.body
    const previousOverflow = body.style.overflow
    body.style.overflow = "hidden"

    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      dismiss.current()
    }
    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      body.style.overflow = previousOverflow
      restoreTo.current?.focus()
    }
  }, [open])

  const trapFocus = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") return
    const node = panel.current
    if (node === null) return
    const focusable = focusableWithin(node)
    if (focusable.length === 0) {
      event.preventDefault()
      node.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) return
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === node)) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

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
        {...(description === undefined ? {} : { "aria-describedby": `${id}-description` })}
        tabIndex={-1}
        onKeyDown={trapFocus}
      >
        <span className={SHEET_GRIP} aria-hidden="true" />
        <div className={SHEET_HEAD_ROW}>
          <div className={SHEET_HEAD}>
            <h2 className={SHEET_TITLE} id={`${id}-title`}>
              {title}
            </h2>
            {description === undefined ? null : (
              <p className={SHEET_DESCRIPTION} id={`${id}-description`}>
                {description}
              </p>
            )}
          </div>
          <button type="button" className={SHEET_CLOSE} aria-label="Close" onClick={onDismiss}>
            <svg
              className="size-icon-md"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5 5l10 10" />
              <path d="M15 5L5 15" />
            </svg>
          </button>
        </div>
        {children === undefined ? null : <div className={SHEET_BODY}>{children}</div>}
        {actions === undefined ? null : <div className={SHEET_ACTIONS}>{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
