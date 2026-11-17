import { useEffect, useState } from "react"

import { readInstalledApp } from "~/platform/appUpdate"
import { DetailRow } from "~/ui/patterns/DataList"

type InstalledVersion =
  | Readonly<{ state: "reading" }>
  | Readonly<{ state: "read"; versionName: string }>
  | Readonly<{ state: "unreadable" }>

const useInstalledVersion = (): InstalledVersion => {
  const [version, setVersion] = useState<InstalledVersion>({ state: "reading" })

  useEffect(() => {
    let cancelled = false
    void readInstalledApp()
      .then((installed) => {
        const versionName = installed.versionName.trim()
        if (cancelled) return
        setVersion(versionName === "" ? { state: "unreadable" } : { state: "read", versionName })
      })
      .catch(() => {
        if (!cancelled) setVersion({ state: "unreadable" })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return version
}

const versionText = (version: InstalledVersion): string => {
  switch (version.state) {
    case "reading":
      return "Checking"
    case "read":
      return version.versionName
    case "unreadable":
      return "This device did not report it"
  }
}

export type InstalledVersionRowProps = Readonly<{ label: string }>

export const InstalledVersionRow = ({ label }: InstalledVersionRowProps): React.ReactElement => (
  <DetailRow label={label}>{versionText(useInstalledVersion())}</DetailRow>
)
