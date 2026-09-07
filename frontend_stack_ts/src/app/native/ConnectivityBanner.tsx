import { useLayoutEffect, useRef } from "react"

import { useNetworkStatus } from "~/app/providers/NetworkStatusProvider"

import { CONNECTIVITY_BANNER } from "~/ui/recipes/feedbackShell"

const CHROME_OFFSET = "--be-chrome-offset"
const CHROME_SAFE_TOP = "--be-chrome-safe-top"

export const ConnectivityBanner = (): React.ReactElement | null => {
  const { degraded } = useNetworkStatus()
  const banner = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const node = banner.current
    if (!degraded || node === null) return

    const root = document.documentElement
    const publish = (): void => {
      const height = node.getBoundingClientRect().height
      root.style.setProperty(CHROME_OFFSET, `${String(Math.round(height * 10) / 10)}px`)
      root.style.setProperty(CHROME_SAFE_TOP, "0px")
    }

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)

    return () => {
      observer.disconnect()
      root.style.removeProperty(CHROME_OFFSET)
      root.style.removeProperty(CHROME_SAFE_TOP)
    }
  }, [degraded])

  if (!degraded) return null

  return (
    <div ref={banner} className={CONNECTIVITY_BANNER} role="status">
      You are offline. Nothing has been lost — we will retry when the connection returns.
    </div>
  )
}
