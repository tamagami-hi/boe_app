import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import { TOAST_BASE, TOAST_REGION, TOAST_TONE } from "~/ui/recipes/feedbackShell"

export type ToastTone = "neutral" | "error"

export type Toast = Readonly<{
  id: string
  message: string
  tone: ToastTone
}>

export type ToastActions = Readonly<{
  show: (message: string, tone?: ToastTone) => void
  dismiss: (id: string) => void
  toasts: readonly Toast[]
}>

const ToastContext = createContext<ToastActions | null>(null)

const TOAST_LIFETIME_MS = 5000

export const ToastProvider = ({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement => {
  const [toasts, setToasts] = useState<readonly Toast[]>([])

  const dismiss = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((message: string, tone: ToastTone = "neutral"): void => {
    setToasts((current) => [...current, { id: crypto.randomUUID(), message, tone }])
  }, [])

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((toast) =>
      setTimeout(() => {
        dismiss(toast.id)
      }, TOAST_LIFETIME_MS),
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [toasts, dismiss])

  const value = useMemo<ToastActions>(() => ({ show, dismiss, toasts }), [show, dismiss, toasts])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={TOAST_REGION} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <output
            key={toast.id}
            className={cx(TOAST_BASE, toast.tone === "error" ? TOAST_TONE.error : TOAST_TONE.default)}
          >
            {toast.message}
          </output>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastActions => {
  const value = useContext(ToastContext)
  if (value === null) throw new Error("useToast requires a ToastProvider ancestor")
  return value
}
