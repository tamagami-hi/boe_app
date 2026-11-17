import { useEffect, useSyncExternalStore } from "react"

type Listener = () => void

export type HeldWriteKeeping = "none" | "device" | "page"

const holders = new Map<symbol, boolean>()
const listeners = new Set<Listener>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const unsettledHeldWriteKeeping = (): HeldWriteKeeping => {
  if (holders.size === 0) return "none"
  return [...holders.values()].some((isPageOnly) => isPageOnly) ? "page" : "device"
}

const NO_KEEPING = (): HeldWriteKeeping => "none"

export const useMarkUnsettledHeldWrite = (isUnsettled: boolean, isKeptOnPageOnly: boolean): void => {
  useEffect(() => {
    if (!isUnsettled) return undefined
    const holder = Symbol("held-write")
    holders.set(holder, isKeptOnPageOnly)
    notify()
    return () => {
      holders.delete(holder)
      notify()
    }
  }, [isUnsettled, isKeptOnPageOnly])
}

export const useUnsettledHeldWriteKeeping = (): HeldWriteKeeping =>
  useSyncExternalStore(subscribe, unsettledHeldWriteKeeping, NO_KEEPING)

export const useHasUnsettledHeldWrite = (): boolean => useUnsettledHeldWriteKeeping() !== "none"
