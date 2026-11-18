import { useRef } from "react"

import { useNetworkStatus } from "~/app/providers/NetworkStatusProvider"

import { CONNECTIVITY_BANNER } from "~/ui/recipes/feedbackShell"

import { useChromeOffset } from "./useChromeOffset"

export const ConnectivityBanner = (): React.ReactElement | null => {
  const { degraded } = useNetworkStatus()
  const banner = useRef<HTMLDivElement | null>(null)

  useChromeOffset(banner, degraded)

  if (!degraded) return null

  return (
    <div ref={banner} className={CONNECTIVITY_BANNER} role="status">
      BeOnEdge cannot be reached. Nothing has been lost. This screen updates once the connection is back, and anything marked Not confirmed waits for you to check it.
    </div>
  )
}
