import { useState } from "react"
import type { ReactNode } from "react"

import { useAppUpdateFeed } from "~/features/app-update/appUpdateQuery"
import { MandatoryUpdateScreen } from "~/features/app-update/MandatoryUpdateScreen"
import { OptionalUpdateSheet } from "~/features/app-update/OptionalUpdateSheet"
import { decideAppUpdate } from "~/features/app-update/updateDecision"
import { useUpdateInstaller } from "~/features/app-update/useUpdateInstaller"

export type AppUpdateGateProps = Readonly<{ children: ReactNode }>

export const AppUpdateGate = ({ children }: AppUpdateGateProps): React.ReactElement => {
  const feed = useAppUpdateFeed()
  const [dismissedVersionCode, setDismissedVersionCode] = useState<number | null>(null)

  const decision = decideAppUpdate(feed.data ?? null)
  const release = decision.kind === "none" ? null : decision.release
  const installer = useUpdateInstaller(release)

  if (decision.kind === "mandatory") {
    return (
      <MandatoryUpdateScreen
        release={decision.release}
        minimumSupportedVersion={decision.minimumSupportedVersion}
        installer={installer}
        rechecking={feed.isFetching}
        onRecheck={() => {
          void feed.refetch()
        }}
      />
    )
  }

  return (
    <>
      {children}
      {decision.kind === "optional" ? (
        <OptionalUpdateSheet
          open={dismissedVersionCode !== decision.release.versionCode}
          release={decision.release}
          installer={installer}
          onDismiss={() => {
            setDismissedVersionCode(decision.release.versionCode)
          }}
        />
      ) : null}
    </>
  )
}
