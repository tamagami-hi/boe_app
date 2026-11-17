import { createContext, useContext, useEffect, useSyncExternalStore } from "react"

type Listener = () => void

type Holder = Readonly<{ isKeptOnPageOnly: boolean; survivesNavigation: boolean }>

export type HeldWriteKeeping = "none" | "tab" | "page"

const holders = new Map<symbol, Holder>()
const listeners = new Set<Listener>()

const SurvivesNavigationContext = createContext(false)

export const SurvivingHeldWriteScope = SurvivesNavigationContext.Provider

const notify = (): void => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const hasUnsettledHeldWrite = (): boolean => holders.size > 0

export const heldWriteKeepingOnLeave = (): HeldWriteKeeping => {
  const leaving = [...holders.values()].filter((holder) => !holder.survivesNavigation)
  if (leaving.length === 0) return "none"
  return leaving.some((holder) => holder.isKeptOnPageOnly) ? "page" : "tab"
}

const NO_KEEPING = (): HeldWriteKeeping => "none"
const NOTHING_HELD = (): boolean => false

export const useMarkUnsettledHeldWrite = (isUnsettled: boolean, isKeptOnPageOnly: boolean): void => {
  const survivesNavigation = useContext(SurvivesNavigationContext)
  useEffect(() => {
    if (!isUnsettled) return undefined
    const holder = Symbol("held-write")
    holders.set(holder, { isKeptOnPageOnly, survivesNavigation })
    notify()
    return () => {
      holders.delete(holder)
      notify()
    }
  }, [isUnsettled, isKeptOnPageOnly, survivesNavigation])
}

export const useHeldWriteKeepingOnLeave = (): HeldWriteKeeping =>
  useSyncExternalStore(subscribe, heldWriteKeepingOnLeave, NO_KEEPING)

export const useHasUnsettledHeldWrite = (): boolean =>
  useSyncExternalStore(subscribe, hasUnsettledHeldWrite, NOTHING_HELD)
