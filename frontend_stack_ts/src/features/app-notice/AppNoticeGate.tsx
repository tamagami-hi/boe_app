import { useRef } from "react"
import type { ReactNode } from "react"

import { useChromeOffset } from "~/app/native/useChromeOffset"
import { useNetworkStatus } from "~/app/providers/NetworkStatusProvider"
import { formatDateTime } from "~/domain/dates"
import { NOTICE_BANNER } from "~/ui/recipes/feedbackShell"

import { useAppConfigFeed } from "./appNoticeQuery"
import { readAppNotices, type MaintenanceNotice } from "./appNotices"
import { MaintenanceScreen } from "./MaintenanceScreen"

const noticeText = (notice: MaintenanceNotice): string => {
  if (notice.active) return `Maintenance in progress. ${notice.message}`
  if (notice.scheduledFor === null) return notice.message
  return `Planned maintenance from ${formatDateTime(notice.scheduledFor)}. ${notice.message}`
}

const MaintenanceNoticeBanner = ({ notice }: Readonly<{ notice: MaintenanceNotice }>): React.ReactElement => {
  const banner = useRef<HTMLDivElement | null>(null)
  useChromeOffset(banner, true)
  return (
    <div ref={banner} className={NOTICE_BANNER} role="status">
      {noticeText(notice)}
    </div>
  )
}

export type AppNoticeGateProps = Readonly<{ children: ReactNode }>

export const AppNoticeGate = ({ children }: AppNoticeGateProps): React.ReactElement => {
  const { maintenance, degraded } = useNetworkStatus()
  const feed = useAppConfigFeed(maintenance)
  const notices = readAppNotices(feed.data?.config ?? null, new Date())

  if (maintenance) {
    return (
      <MaintenanceScreen
        checking={feed.isFetching}
        onCheck={() => {
          void feed.refetch()
        }}
      />
    )
  }

  return (
    <>
      {notices.maintenance !== null && !degraded ? <MaintenanceNoticeBanner notice={notices.maintenance} /> : null}
      {children}
    </>
  )
}
