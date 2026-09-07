import { useCallback, useEffect, useRef, useState } from "react"

import {
  canInstallUpdates,
  downloadUpdate,
  installUpdate,
  onDownloadProgress,
  requestInstallPermission,
} from "~/platform/appUpdate"
import type { VerifiedDownload } from "~/platform/appUpdate"

import type { UpdateRelease } from "./updateDecision"

export type InstallerState =
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "downloading"; percent: number | null }>
  | Readonly<{ phase: "ready"; download: VerifiedDownload }>
  | Readonly<{ phase: "needs-permission"; download: VerifiedDownload; settingsOpened: boolean }>
  | Readonly<{ phase: "installing" }>
  | Readonly<{ phase: "failed"; message: string }>

export type UpdateInstaller = Readonly<{
  state: InstallerState
  start: () => void
  install: () => void
  allowInstalls: () => void
}>

const DOWNLOAD_FAILED = "We couldn't download the update. Check your connection and try again."

const INSTALL_FAILED = "We couldn't start the installer. Please try again."

const PERMISSION_FAILED = "We couldn't open the permission setting. Please try again."

export const useUpdateInstaller = (release: UpdateRelease | null): UpdateInstaller => {
  const [state, setState] = useState<InstallerState>({ phase: "idle" })
  const busy = useRef(false)
  const mounted = useRef(true)

  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const settle = useCallback((next: InstallerState): void => {
    if (!mounted.current) return
    setState(next)
  }, [])

  const afterDownload = useCallback(
    async (download: VerifiedDownload): Promise<void> => {
      const granted = download.canInstall || (await canInstallUpdates())
      settle(
        granted
          ? { phase: "ready", download }
          : { phase: "needs-permission", download, settingsOpened: false },
      )
    },
    [settle],
  )

  const start = useCallback((): void => {
    if (release === null || busy.current) return
    busy.current = true
    settle({ phase: "downloading", percent: null })

    const stopProgress = onDownloadProgress((progress) => {
      settle({ phase: "downloading", percent: progress.percent })
    })

    void downloadUpdate({
      url: release.url,
      sha256: release.sha256,
      sizeBytes: release.sizeBytes,
    })
      .then(afterDownload)
      .catch(() => {
        settle({ phase: "failed", message: DOWNLOAD_FAILED })
      })
      .finally(() => {
        stopProgress()
        busy.current = false
      })
  }, [release, settle, afterDownload])

  const install = useCallback((): void => {
    if (state.phase !== "ready" && state.phase !== "needs-permission") return
    const { download } = state
    if (busy.current) return
    busy.current = true
    settle({ phase: "installing" })

    void canInstallUpdates()
      .then(async (granted) => {
        if (!granted) {
          settle({ phase: "needs-permission", download, settingsOpened: false })
          return
        }
        await installUpdate(download)
        settle({ phase: "ready", download })
      })
      .catch(() => {
        settle({ phase: "failed", message: INSTALL_FAILED })
      })
      .finally(() => {
        busy.current = false
      })
  }, [state, settle])

  const allowInstalls = useCallback((): void => {
    if (state.phase !== "needs-permission") return
    const { download } = state
    void requestInstallPermission()
      .then((granted) => {
        settle(
          granted
            ? { phase: "ready", download }
            : { phase: "needs-permission", download, settingsOpened: true },
        )
      })
      .catch(() => {
        settle({ phase: "failed", message: PERMISSION_FAILED })
      })
  }, [state, settle])

  return { state, start, install, allowInstalls }
}
