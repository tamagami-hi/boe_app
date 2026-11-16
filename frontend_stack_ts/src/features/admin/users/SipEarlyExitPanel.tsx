import { useEffect, useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { formatINR, toPaise } from "~/domain/money"
import {
  useExitSipEarly,
  useSipEarlyExitPreview,
  type AdminSipEarlyExitItem,
  type AdminSipEarlyExitPreview,
} from "~/features/admin/client-values/earlyExitQueries"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

const UNSENT = "The early exit could not be sent. Reload the schedules and try again."

const dateOf = (isoDate: string): string => formatDate(`${isoDate}T00:00:00Z`)

type ExitFigureValues = Readonly<{
  fundName: string
  amountPaise: string
  principalPortionPaise: string
  growthPortionPaise: string
  effectiveDate: string
  maturityLine: string
}>

const previewFigures = (preview: AdminSipEarlyExitPreview): ExitFigureValues => ({
  fundName: preview.fundName,
  amountPaise: preview.currentValuePaise,
  principalPortionPaise: preview.principalPortionPaise,
  growthPortionPaise: preview.growthPortionPaise,
  effectiveDate: preview.effectiveDate,
  maturityLine:
    preview.maturity === null
      ? "No maturity date is set on this holding."
      : `The maturity date ${dateOf(preview.maturity.maturityDate)} on this holding is cancelled.`,
})

const confirmedFigures = (done: AdminSipEarlyExitItem): ExitFigureValues => ({
  fundName: done.fundName,
  amountPaise: done.amountPaise,
  principalPortionPaise: done.payout.principalPortionPaise,
  growthPortionPaise: done.payout.growthPortionPaise,
  effectiveDate: done.effectiveDate,
  maturityLine:
    done.cancelledMaturityDate === null
      ? "No maturity date was set on this holding."
      : `The maturity date ${dateOf(done.cancelledMaturityDate)} on this holding was cancelled.`,
})

const ExitFigures = ({ values }: Readonly<{ values: ExitFigureValues }>): React.ReactElement => (
  <DataList split>
    <DetailRow label="Fund">{values.fundName}</DetailRow>
    <DetailRow label="Returned to the client">
      <MoneyValue amount={toPaise(values.amountPaise)} size="sm" showDecimals />
    </DetailRow>
    <DetailRow label="Of which invested">
      <MoneyValue amount={toPaise(values.principalPortionPaise)} size="sm" showDecimals />
    </DetailRow>
    <DetailRow label="Of which growth">
      <MoneyValue amount={toPaise(values.growthPortionPaise)} size="sm" showDecimals />
    </DetailRow>
    <DetailRow label="Dated">{dateOf(values.effectiveDate)}</DetailRow>
    <DetailRow label="Maturity date">{values.maturityLine}</DetailRow>
  </DataList>
)

const ClosedEarly = ({ done, onClose }: Readonly<{ done: AdminSipEarlyExitItem; onClose: () => void }>): React.ReactElement => (
  <Card elevated>
    <div className={STACK_LG}>
      <ExitFigures values={confirmedFigures(done)} />
      <Alert tone="success" title="Closed early">
        {`${formatINR(toPaise(done.amountPaise), { showDecimals: true })} is recorded as a pending payout. Record the bank transfer outcome under Early exits below once the money is sent.`}
      </Alert>
      <span className={ACTION_ROW}>
        <Button tone="ghost" onClick={onClose}>
          Done
        </Button>
      </span>
    </div>
  </Card>
)

export type SipEarlyExitPanelProps = Readonly<{
  userId: string
  scheduleId: string
  onReload: () => void
  onClose: () => void
  onHoldChange?: (holding: boolean) => void
}>

export const SipEarlyExitPanel = ({
  userId,
  scheduleId,
  onReload,
  onClose,
  onHoldChange,
}: SipEarlyExitPanelProps): React.ReactElement => {
  const preview = useSipEarlyExitPreview(userId, scheduleId)
  const write = useHeldWrite(useExitSipEarly(userId), UNSENT)
  const [confirming, setConfirming] = useState(false)
  const done = write.outcome.kind === "done" ? write.outcome.result : null
  const holding = write.pending || write.outcome.kind === "unknown"

  useEffect(() => {
    onHoldChange?.(holding)
    return () => {
      onHoldChange?.(false)
    }
  }, [holding, onHoldChange])

  if (done !== null) return <ClosedEarly done={done} onClose={onClose} />

  const confirm = (data: AdminSipEarlyExitPreview): void => {
    setConfirming(false)
    write.submit({ scheduleId, expectedVersion: data.scheduleVersion, expectedValuePaise: data.currentValuePaise })
  }

  return (
    <Card elevated>
      <AsyncBoundary
        query={preview}
        skeleton={
          <>
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="4rem" />
          </>
        }
      >
        {(data) => (
          <div className={STACK_LG}>
            <p className={PROSE_SM}>
              Closing early ends this SIP before its last month and returns the full current value of the client&apos;s holding in
              this fund, with no charge. The holding&apos;s value goes to zero. If the value is below the amount invested, the
              invested amount it does not cover stays on record. The client is told in the app and by email, and it cannot be
              undone.
            </p>
            <ExitFigures values={previewFigures(data)} />
            {data.refusal === null ? null : (
              <Alert tone="warning" title="Cannot close early">
                {data.refusal.message}
              </Alert>
            )}
            <HeldWriteNotice write={write} subject="the SIP was closed early" onReload={onReload} />
            <span className={ACTION_ROW}>
              <Button
                tone="danger"
                disabled={holding || data.refusal !== null}
                loading={write.pending}
                onClick={() => {
                  setConfirming(true)
                }}
              >
                Close early and return the value
              </Button>
              <Button tone="ghost" disabled={holding} onClick={onClose}>
                Cancel
              </Button>
            </span>
            <ConfirmDialog
              open={confirming}
              title="Close this SIP early?"
              description="The schedule closes for good, the full current value below is withdrawn from the holding as a pending payout, and the client is told. There is no undo."
              confirmLabel="Close early"
              confirmTone="danger"
              onConfirm={() => {
                confirm(data)
              }}
              onCancel={() => {
                setConfirming(false)
              }}
            >
              <ExitFigures values={previewFigures(data)} />
            </ConfirmDialog>
          </div>
        )}
      </AsyncBoundary>
    </Card>
  )
}
