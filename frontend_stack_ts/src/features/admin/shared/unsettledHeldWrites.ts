import { useEffect, useSyncExternalStore } from "react"

type Listener = () => void

const holders = new Set<symbol>()
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

const hasUnsettledHeldWrite = (): boolean => holders.size > 0

export const useMarkUnsettledHeldWrite = (isUnsettled: boolean): void => {
  useEffect(() => {
    if (!isUnsettled) return undefined
    const holder = Symbol("held-write")
    holders.add(holder)
    notify()
    return () => {
      holders.delete(holder)
      notify()
    }
  }, [isUnsettled])
}

export const useHasUnsettledHeldWrite = (): boolean =>
  useSyncExternalStore(subscribe, hasUnsettledHeldWrite, () => false)
