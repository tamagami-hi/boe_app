import { useMemo, useState } from "react"
import type { ReactNode } from "react"

import { useAppConfigFeed } from "~/features/app-notice/appNoticeQuery"
import { readAppNotices } from "~/features/app-notice/appNotices"
import { useAppUpdateFeed } from "~/features/app-update/appUpdateQuery"
import { MandatoryUpdateScreen } from "~/features/app-update/MandatoryUpdateScreen"
import { OptionalUpdateSheet } from "~/features/app-update/OptionalUpdateSheet"
import { decideAppUpdate } from "~/features/app-update/updateDecision"
import { UpdatePromptProvider, type UpdatePrompt } from "~/features/app-update/updatePrompt"
import { useUpdateInstaller } from "~/features/app-update/useUpdateInstaller"

export type AppUpdateGateProps = Readonly<{ children: ReactNode }>

export const AppUpdateGate = ({ children }: AppUpdateGateProps): React.ReactElement => {
  const feed = useAppUpdateFeed()
  const config = useAppConfigFeed(false)
  const [dismissedVersionCode, setDismissedVersionCode] = useState<number | null>(null)

  const decision = decideAppUpdate(feed.data ?? null)
  const release = decision.kind === "none" ? null : decision.release
  const installer = useUpdateInstaller(release)
  const isOptional = decision.kind === "optional"
  const prompt = useMemo<UpdatePrompt>(
    () => ({
      isAvailable: isOptional,
      open: () => {
        setDismissedVersionCode(null)
      },
    }),
    [isOptional],
  )

  if (decision.kind === "mandatory") {
    return (
      <MandatoryUpdateScreen
        message={readAppNotices(config.data?.config ?? null, new Date()).updateMessage}
        release={decision.release}
        installer={installer}
        rechecking={feed.isFetching}
        onRecheck={() => {
          void feed.refetch()
        }}
      />
    )
  }

  return (
    <UpdatePromptProvider value={prompt}>
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
    </UpdatePromptProvider>
  )
}
