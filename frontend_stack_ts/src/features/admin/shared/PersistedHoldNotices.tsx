import { useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"

import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "./HeldWriteNotice"
import type { HeldWrite, HeldWriteOutcome } from "./useHeldWrite"
import { useUnloadGuard } from "./useUnloadGuard"

type PersistedWrite = Pick<HeldWrite<never, unknown>, "outcome" | "pending" | "checkAgain" | "unreadable" | "expired" | "reset"> &
  Pick<HeldWrite<object, unknown>, "held" | "persisted">

const IDLE: HeldWriteOutcome<never> = { kind: "idle" }
const RESTART_LABEL = "Start a new attempt"

export const isHeldOrUnreadable = (write: Pick<PersistedWrite, "held" | "unreadable">): boolean =>
  write.held !== null || write.unreadable

export type PersistedHoldNoticesProps = Readonly<{
  write: PersistedWrite
  subject: string
  reloadLabel: string
  onReload: () => void
  restartWarning: string
}>

export const PersistedHoldNotices = ({
  write,
  subject,
  reloadLabel,
  onReload,
  restartWarning,
}: PersistedHoldNoticesProps): React.ReactElement => {
  const [isAsking, setIsAsking] = useState(false)
  useUnloadGuard(isUnsavedHold(write))
  const isStale = write.unreadable || write.expired

  return (
    <>
      <HeldWriteNotice
        write={{
          outcome: write.outcome.kind === "rejected" ? IDLE : write.outcome,
          pending: write.pending,
          checkAgain: write.checkAgain,
          unreadable: write.unreadable,
          expired: write.expired,
        }}
        subject={subject}
        reloadLabel={isStale ? RESTART_LABEL : reloadLabel}
        onReload={
          isStale
            ? () => {
                setIsAsking(true)
              }
            : onReload
        }
      />
      <UnsavedHoldNotice write={write} />
      <ConfirmDialog
        open={isAsking}
        title="Start a new attempt?"
        description={restartWarning}
        confirmLabel={RESTART_LABEL}
        confirmTone="danger"
        cancelLabel="Keep the held request"
        onConfirm={() => {
          setIsAsking(false)
          write.reset()
        }}
        onCancel={() => {
          setIsAsking(false)
        }}
      />
    </>
  )
}
