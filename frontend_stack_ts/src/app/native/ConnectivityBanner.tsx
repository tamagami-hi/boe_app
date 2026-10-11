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
      You are offline. Nothing has been lost — we will retry when the connection returns.
    </div>
  )
}
