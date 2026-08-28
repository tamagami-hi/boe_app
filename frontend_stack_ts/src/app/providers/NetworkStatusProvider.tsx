import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import type { TransportOutcome } from "~/api/http"

export type NetworkStatus = Readonly<{
  online: boolean
  lastOutcome: TransportOutcome | null
  degraded: boolean
  report: (outcome: TransportOutcome) => void
}>

const NetworkStatusContext = createContext<NetworkStatus | null>(null)

const initialOnline = (): boolean =>
  typeof navigator === "undefined" ? true : navigator.onLine

export const NetworkStatusProvider = ({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement => {
  const [online, setOnline] = useState(initialOnline)
  const [lastOutcome, setLastOutcome] = useState<TransportOutcome | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    const goOnline = (): void => {
      setOnline(true)
    }
    const goOffline = (): void => {
      setOnline(false)
    }
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [])

  const report = useCallback((outcome: TransportOutcome): void => {
    setLastOutcome(outcome)
    if (outcome.kind === "offline") setOnline(false)
    if (outcome.ok) setOnline(true)
  }, [])

  const value = useMemo<NetworkStatus>(
    () => ({
      online,
      lastOutcome,
      degraded: !online || lastOutcome?.kind === "offline" || lastOutcome?.kind === "timeout",
      report,
    }),
    [online, lastOutcome, report],
  )

  return (
    <NetworkStatusContext.Provider value={value}>{children}</NetworkStatusContext.Provider>
  )
}

export const useNetworkStatus = (): NetworkStatus => {
  const value = useContext(NetworkStatusContext)
  if (value === null) {
    throw new Error("useNetworkStatus requires a NetworkStatusProvider ancestor")
  }
  return value
}
