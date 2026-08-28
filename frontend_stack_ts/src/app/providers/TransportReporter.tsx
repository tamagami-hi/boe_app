import { useEffect } from "react"

import { useNetworkStatus } from "~/app/providers/NetworkStatusProvider"
import type { TransportOutcome } from "~/api/http"

export type TransportReporterProps = Readonly<{
  bind: (report: (outcome: TransportOutcome) => void) => void
}>

export const TransportReporter = ({ bind }: TransportReporterProps): null => {
  const { report } = useNetworkStatus()

  useEffect(() => {
    bind(report)
  }, [bind, report])

  return null
}
