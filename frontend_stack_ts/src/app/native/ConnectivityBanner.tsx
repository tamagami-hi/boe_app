import { useNetworkStatus } from "~/app/providers/NetworkStatusProvider"

import styles from "./ConnectivityBanner.module.css"

export const ConnectivityBanner = (): React.ReactElement | null => {
  const { degraded } = useNetworkStatus()
  if (!degraded) return null
  return (
    <div className={styles.banner} role="status">
      You are offline. Nothing has been lost — we will retry when the connection returns.
    </div>
  )
}
