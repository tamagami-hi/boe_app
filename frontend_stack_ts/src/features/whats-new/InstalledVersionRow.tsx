import { useEffect, useState } from "react"

import { buildVersion } from "~/lib/env"
import { canCheckForUpdates, readInstalledApp } from "~/platform/appUpdate"
import { DetailRow } from "~/ui/patterns/DataList"

const useAppVersion = (): string | null => {
  const [version, setVersion] = useState<string | null>(() =>
    canCheckForUpdates() ? null : buildVersion(),
  )

  useEffect(() => {
    if (!canCheckForUpdates()) return undefined
    let cancelled = false
    const settle = (versionName: string): void => {
      if (!cancelled) setVersion(versionName === "" ? buildVersion() : versionName)
    }
    void readInstalledApp()
      .then((installed) => {
        settle(installed.versionName.trim())
      })
      .catch(() => {
        settle("")
      })
    return () => {
      cancelled = true
    }
  }, [])

  return version
}

export type InstalledVersionRowProps = Readonly<{ label: string }>

export const InstalledVersionRow = ({ label }: InstalledVersionRowProps): React.ReactElement => (
  <DetailRow label={label}>{useAppVersion() ?? "Checking"}</DetailRow>
)
