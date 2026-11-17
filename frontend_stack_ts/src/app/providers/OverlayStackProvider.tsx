import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

export type OverlayEntry = Readonly<{
  id: string
  dismiss: () => void
}>

export type OverlayStack = Readonly<{
  register: (entry: OverlayEntry) => () => void
  dismissTop: () => boolean
  depth: number
  topId: string | null
}>

const OverlayStackContext = createContext<OverlayStack | null>(null)

const SCROLL_LOCK_ATTRIBUTE = "data-be-scroll-locked"

export const OverlayStackProvider = ({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement => {
  const [ids, setIds] = useState<readonly string[]>([])
  const entries = useRef(new Map<string, OverlayEntry>())
  const order = useRef<readonly string[]>([])

  const reorder = useCallback((next: readonly string[]): void => {
    order.current = next
    setIds(next)
  }, [])

  const register = useCallback((entry: OverlayEntry): (() => void) => {
    entries.current.set(entry.id, entry)
    const current = order.current
    if (current.at(-1) !== entry.id) reorder([...current.filter((id) => id !== entry.id), entry.id])
    return () => {
      entries.current.delete(entry.id)
      if (order.current.includes(entry.id)) reorder(order.current.filter((id) => id !== entry.id))
    }
  }, [reorder])

  const dismissTop = useCallback((): boolean => {
    const topId = order.current.at(-1)
    if (topId === undefined) return false
    entries.current.get(topId)?.dismiss()
    return true
  }, [])

  useEffect(() => {
    if (typeof document === "undefined") return
    const { body } = document
    if (ids.length > 0) {
      body.setAttribute(SCROLL_LOCK_ATTRIBUTE, "true")
      body.style.overflow = "hidden"
    } else {
      body.removeAttribute(SCROLL_LOCK_ATTRIBUTE)
      body.style.removeProperty("overflow")
    }
    return () => {
      body.removeAttribute(SCROLL_LOCK_ATTRIBUTE)
      body.style.removeProperty("overflow")
    }
  }, [ids])

  useEffect(() => {
    if (typeof window === "undefined") return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || order.current.length === 0) return
      event.preventDefault()
      dismissTop()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [dismissTop])

  const value = useMemo<OverlayStack>(
    () => ({ register, dismissTop, depth: ids.length, topId: ids.at(-1) ?? null }),
    [register, dismissTop, ids],
  )

  return <OverlayStackContext.Provider value={value}>{children}</OverlayStackContext.Provider>
}

export const useOverlayStack = (): OverlayStack => {
  const value = useContext(OverlayStackContext)
  if (value === null) throw new Error("useOverlayStack requires an OverlayStackProvider ancestor")
  return value
}
