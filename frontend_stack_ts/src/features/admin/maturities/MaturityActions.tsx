import { Modal } from "~/app/overlays/Modal"
import { useClientSipSchedules } from "~/features/admin/client-values/sipScheduleQueries"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { HeldWriteNotice } from "~/features/admin/users/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/users/useHeldWrite"
import { Button } from "~/ui/primitives/Button"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { MaturityConfirmDialog } from "./MaturityConfirmDialog"
import { formatMaturityDate } from "./maturityPresentation"
import { useWithdrawMaturityOffer, type MaturityOfferSummary, type MaturityScheduleItem } from "./maturityQueries"
import { MaturityResolveDialog } from "./MaturityResolveDialog"
import { MaturitySendDialog } from "./MaturitySendDialog"
import type { HoldingRead } from "./resolutionCopy"

export type MaturityActionKind = "resolve" | "send" | "confirm" | "withdraw"

export type MaturityAction = Readonly<{ schedule: MaturityScheduleItem; kind: MaturityActionKind }>

export type MaturityActionButtonsProps = Readonly<{
  schedule: MaturityScheduleItem
  onAct: (action: MaturityAction) => void
}>

export const MaturityActionButtons = ({ schedule, onAct }: MaturityActionButtonsProps): React.ReactElement | null => {
  if (schedule.state !== "scheduled") return null
  const offer = schedule.offer
  const reached = schedule.daysUntil <= 0
  const chosen = offer !== null && offer.chosenOption !== null
  const act = (kind: MaturityActionKind) => () => {
    onAct({ schedule, kind })
  }
  return (
    <span className={ACTION_ROW}>
      {chosen ? (
        <Button size="sm" disabled={!reached} onClick={act("confirm")}>
          Confirm choice
        </Button>
      ) : null}
      <Button size="sm" tone={chosen ? "secondary" : "primary"} disabled={!reached} onClick={act("resolve")}>
        Resolve
      </Button>
      <Button size="sm" tone="secondary" onClick={act("send")}>
        {offer === null ? "Send options to client" : "Send new options"}
      </Button>
      {offer === null ? null : (
        <Button size="sm" tone="ghost" onClick={act("withdraw")}>
          Withdraw options
        </Button>
      )}
    </span>
  )
}

type WithdrawProps = Readonly<{
  userId: string
  schedule: MaturityScheduleItem
  offer: MaturityOfferSummary
  onClose: () => void
}>

const MaturityWithdrawDialog = ({ userId, schedule, offer, onClose }: WithdrawProps): React.ReactElement => {
  const write = useHeldWrite(useWithdrawMaturityOffer(userId), "The withdrawal could not be sent. Reload the page and try again.")
  const locked = write.pending || write.outcome.kind === "unknown" || write.outcome.kind === "done"
  return (
    <Modal
      open
      title="Withdraw the options?"
      description={`${schedule.fundName}, maturing ${formatMaturityDate(schedule.maturityDate)}. The client stops seeing these options. No money moves, and you can send new options afterwards.`}
      onDismiss={() => {
        if (!write.pending) onClose()
      }}
      actions={
        write.outcome.kind === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button tone="secondary" disabled={write.pending} onClick={onClose}>
              Keep the options
            </Button>
            <Button
              tone="danger"
              disabled={locked}
              loading={write.pending}
              onClick={() => {
                write.submit({
                  scheduleId: schedule.scheduleId,
                  offerId: offer.offerId,
                  expectedVersion: schedule.version,
                  offerVersion: offer.version,
                })
              }}
            >
              Withdraw the options
            </Button>
          </>
        )
      }
    >
      {write.outcome.kind === "done" ? (
        <Alert tone="success" title="Options withdrawn">
          The client no longer sees them. The maturity is still open.
        </Alert>
      ) : (
        <HeldWriteNotice write={write} subject="the options were withdrawn" onReload={onClose} />
      )}
    </Modal>
  )
}

const ReadingModal = ({ onClose }: Readonly<{ onClose: () => void }>): React.ReactElement => (
  <Modal open title="Reading the holding" description="Reading the holding and its SIP schedules." onDismiss={onClose}>
    <div className={STACK_LG}>
      <Skeleton height="1rem" width="45%" />
      <Skeleton height="2rem" />
    </div>
  </Modal>
)

const ClosedOfferModal = ({ onClose }: Readonly<{ onClose: () => void }>): React.ReactElement => (
  <Modal open title="Options no longer open" onDismiss={onClose} actions={<Button onClick={onClose}>Close</Button>}>
    <Alert tone="info" title="Nothing to act on">
      These options were confirmed, withdrawn or replaced. Reload to see the latest.
    </Alert>
  </Modal>
)

export type MaturityActionDialogProps = Readonly<{ userId: string; action: MaturityAction; onClose: () => void }>

type PositionsRead = ReturnType<typeof useAdminInvestorPositions>

const holdingOf = (positions: PositionsRead, fundId: string): HoldingRead => {
  if (positions.data === undefined) return { state: "failed" }
  const row = positions.data.items.find((item) => item.fundId === fundId)
  return row === undefined ? { state: "none" } : { state: "read", figures: row }
}

export const MaturityActionDialog = ({ userId, action, onClose }: MaturityActionDialogProps): React.ReactElement => {
  const positions = useAdminInvestorPositions(userId)
  const sips = useClientSipSchedules(userId)
  const { schedule, kind } = action
  const offer = schedule.offer

  if ((kind === "confirm" || kind === "withdraw") && offer === null) return <ClosedOfferModal onClose={onClose} />
  if (kind === "withdraw" && offer !== null) {
    return <MaturityWithdrawDialog userId={userId} schedule={schedule} offer={offer} onClose={onClose} />
  }
  if (positions.isPending || sips.isPending) return <ReadingModal onClose={onClose} />

  const holding = holdingOf(positions, schedule.fundId)
  const activeSip =
    sips.data === undefined ? undefined : (sips.data.items.find((row) => row.fundId === schedule.fundId && row.state === "active") ?? null)
  const shared = {
    userId,
    schedule,
    activeSip,
    reload: {
      refreshing: positions.isFetching || sips.isFetching,
      onReload: () => {
        void positions.refetch()
        void sips.refetch()
      },
    },
    onClose,
  }
  if (kind === "send") return <MaturitySendDialog {...shared} />
  if (kind === "confirm" && offer !== null) return <MaturityConfirmDialog {...shared} offer={offer} holding={holding} />
  return <MaturityResolveDialog {...shared} holding={holding} />
}
