import { useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import { refetchFailedReads } from "~/api/failedReads"
import type { TransportOutcome } from "~/api/http"
import { qk } from "~/api/queryKeys"

export type NetworkStatus = Readonly<{
  online: boolean
  lastOutcome: TransportOutcome | null
  degraded: boolean
  maintenance: boolean
  report: (outcome: TransportOutcome) => void
}>

type Connectivity = Readonly<{
  deviceOnline: boolean
  lastOutcome: TransportOutcome | null
}>

const RECOVERY_PROBE_INTERVAL_MS = 10_000
const RECOVERY_PROBE_KEY = qk.app.config()

const NetworkStatusContext = createContext<NetworkStatus | null>(null)

const initialConnectivity = (): Connectivity => ({
  deviceOnline: typeof navigator === "undefined" ? true : navigator.onLine,
  lastOutcome: null,
})

const isConnectionLost = (outcome: TransportOutcome | null): boolean =>
  outcome?.kind === "offline" || outcome?.kind === "timeout"

const isDegraded = ({ deviceOnline, lastOutcome }: Connectivity): boolean =>
  !deviceOnline || isConnectionLost(lastOutcome)

const afterDeviceOnline = ({ lastOutcome }: Connectivity): Connectivity => ({
  deviceOnline: true,
  lastOutcome: isConnectionLost(lastOutcome) ? null : lastOutcome,
})

const afterDeviceOffline = ({ lastOutcome }: Connectivity): Connectivity => ({
  deviceOnline: false,
  lastOutcome,
})

const afterOutcome = ({ deviceOnline }: Connectivity, outcome: TransportOutcome): Connectivity => ({
  deviceOnline: deviceOnline || !isConnectionLost(outcome),
  lastOutcome: outcome,
})

const probeReachability = (client: QueryClient): Promise<void> =>
  client.refetchQueries({ queryKey: RECOVERY_PROBE_KEY, exact: true }, { cancelRefetch: false })

const useRefetchOnRecovery = (client: QueryClient, degraded: boolean): void => {
  const wasDegraded = useRef(degraded)

  useEffect(() => {
    const recovered = wasDegraded.current && !degraded
    wasDegraded.current = degraded
    if (recovered) void refetchFailedReads(client)
  }, [client, degraded])
}

const useReachabilityProbe = (client: QueryClient, isProbing: boolean): void => {
  useEffect(() => {
    if (!isProbing) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      void probeReachability(client)
    }, RECOVERY_PROBE_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [client, isProbing])
}

export const NetworkStatusProvider = ({
  children,
}: Readonly<{ children: ReactNode }>): React.ReactElement => {
  const queryClient = useQueryClient()
  const [connectivity, setConnectivity] = useState(initialConnectivity)

  useEffect(() => {
    if (typeof window === "undefined") return
    const goOnline = (): void => {
      setConnectivity(afterDeviceOnline)
    }
    const goOffline = (): void => {
      setConnectivity(afterDeviceOffline)
    }
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    return () => {
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
    }
  }, [])

  const report = useCallback((outcome: TransportOutcome): void => {
    setConnectivity((current) => afterOutcome(current, outcome))
  }, [])

  const degraded = isDegraded(connectivity)
  useRefetchOnRecovery(queryClient, degraded)
  useReachabilityProbe(queryClient, degraded)

  const { deviceOnline, lastOutcome } = connectivity
  const value = useMemo<NetworkStatus>(
    () => ({
      online: deviceOnline && lastOutcome?.kind !== "offline",
      lastOutcome,
      degraded,
      maintenance: lastOutcome?.kind === "maintenance",
      report,
    }),
    [deviceOnline, lastOutcome, degraded, report],
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
