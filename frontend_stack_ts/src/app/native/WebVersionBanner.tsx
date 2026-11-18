import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

import { qk } from "~/api/queryKeys"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useNetworkStatus } from "~/app/providers/NetworkStatusProvider"
import { useHasUnsettledHeldWrite } from "~/features/admin/shared/unsettledHeldWrites"
import type { AppConfigFeed } from "~/features/app-notice/appNoticeQuery"
import { readAppNotices } from "~/features/app-notice/appNotices"
import { cx } from "~/lib/cx"
import { appTarget, buildVersion } from "~/lib/env"
import { watchWebVersion } from "~/platform/webVersion"
import { Button } from "~/ui/primitives/Button"
import { NOTICE_BANNER } from "~/ui/recipes/feedbackShell"

import { useChromeOffset } from "./useChromeOffset"

const BANNER_ROW = "flex flex-wrap items-center justify-center gap-x-3 gap-y-1"

const RELOAD_WITH_HELD_WRITE =
  "A save marked Not confirmed has not been checked yet. If it is kept on its page only, reloading clears it and it cannot be checked again. Check it first, then reload."

const reloadPage = (): void => {
  window.location.reload()
}

const useReplacedBuild = (): boolean => {
  const [isReplaced, setReplaced] = useState(false)

  useEffect(
    () =>
      watchWebVersion({
        running: { version: buildVersion(), target: appTarget() },
        onDeployed: (deployed) => {
          setReplaced(deployed === "replaced")
        },
      }),
    [],
  )

  return isReplaced
}

const useCachedAppConfig = (): AppConfigFeed | undefined => {
  const client = useQueryClient()
  const subscribe = useCallback((onChange: () => void) => client.getQueryCache().subscribe(onChange), [client])
  return useSyncExternalStore(subscribe, () => client.getQueryData<AppConfigFeed>(qk.app.config()))
}

export const WebVersionBanner = (): React.ReactElement | null => {
  const { degraded, maintenance } = useNetworkStatus()
  const isReplaced = useReplacedBuild()
  const isHoldingWrite = useHasUnsettledHeldWrite()
  const appConfig = useCachedAppConfig()
  const [isAsking, setAsking] = useState(false)
  const banner = useRef<HTMLDivElement | null>(null)
  const isNoticeShown = !maintenance && readAppNotices(appConfig?.config ?? null, new Date()).maintenance !== null
  const isShown = isReplaced && !degraded && !isNoticeShown

  useChromeOffset(banner, isShown)

  useEffect(() => {
    if (!isHoldingWrite || !isShown) setAsking(false)
  }, [isHoldingWrite, isShown])

  if (!isShown) return null

  return (
    <>
      <div ref={banner} className={cx(NOTICE_BANNER, BANNER_ROW)} role="status">
        <span>A newer version of BeOnEdge is available.</span>
        <Button
          tone="secondary"
          size="sm"
          onClick={() => {
            if (isHoldingWrite) setAsking(true)
            else reloadPage()
          }}
        >
          Reload
        </Button>
      </div>
      <ConfirmDialog
        open={isAsking}
        title="Reload now?"
        description={RELOAD_WITH_HELD_WRITE}
        confirmLabel="Reload anyway"
        confirmTone="danger"
        cancelLabel="Stay"
        onConfirm={reloadPage}
        onCancel={() => {
          setAsking(false)
        }}
      />
    </>
  )
}
