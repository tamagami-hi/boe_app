import { useNetworkStatus } from "~/app/providers/NetworkStatusProvider"

import { CONNECTIVITY_BANNER } from "~/ui/recipes/feedbackShell"

export const ConnectivityBanner = (): React.ReactElement | null => {
  const { degraded } = useNetworkStatus()
  if (!degraded) return null
  return (
    <div className={CONNECTIVITY_BANNER} role="status">
      You are offline. Nothing has been lost — we will retry when the connection returns.
    </div>
  )
}
