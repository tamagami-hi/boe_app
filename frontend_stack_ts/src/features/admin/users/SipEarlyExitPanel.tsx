import { useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { formatINR, toPaise } from "~/domain/money"
import {
  useExitSipEarly,
  useSipEarlyExitPreview,
  type AdminSipEarlyExitPreview,
} from "~/features/admin/client-values/earlyExitQueries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { HeldWriteNotice } from "./HeldWriteNotice"
import { useHeldWrite } from "./useHeldWrite"

const UNSENT = "The early exit could not be sent. Reload the schedules and try again."

const dateOf = (isoDate: string): string => formatDate(`${isoDate}T00:00:00Z`)

const maturityLine = (preview: AdminSipEarlyExitPreview): string =>
  preview.maturity === null
    ? "No maturity date is set on this holding."
    : `The maturity date ${dateOf(preview.maturity.maturityDate)} on this holding is cancelled.`

const ExitFigures = ({ preview }: Readonly<{ preview: AdminSipEarlyExitPreview }>): React.ReactElement => (
  <DataList split>
    <DetailRow label="Fund">{preview.fundName}</DetailRow>
    <DetailRow label="Returned to the client">
      <MoneyValue amount={toPaise(preview.currentValuePaise)} size="sm" showDecimals />
    </DetailRow>
    <DetailRow label="Of which invested">
      <MoneyValue amount={toPaise(preview.principalPortionPaise)} size="sm" showDecimals />
    </DetailRow>
    <DetailRow label="Of which growth">
      <MoneyValue amount={toPaise(preview.growthPortionPaise)} size="sm" showDecimals />
    </DetailRow>
    <DetailRow label="Dated">{dateOf(preview.effectiveDate)}</DetailRow>
    <DetailRow label="Maturity date">{maturityLine(preview)}</DetailRow>
  </DataList>
)

export type SipEarlyExitPanelProps = Readonly<{
  userId: string
  scheduleId: string
  onReload: () => void
  onClose: () => void
}>

export const SipEarlyExitPanel = ({ userId, scheduleId, onReload, onClose }: SipEarlyExitPanelProps): React.ReactElement => {
  const preview = useSipEarlyExitPreview(userId, scheduleId)
  const write = useHeldWrite(useExitSipEarly(userId), UNSENT)
  const [confirming, setConfirming] = useState(false)
  const done = write.outcome.kind === "done" ? write.outcome.result : null
  const locked = write.pending || write.outcome.kind === "unknown" || done !== null

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
              this fund, with no charge. The holding goes to zero, the client is told in the app and by email, and it cannot be
              undone.
            </p>
            <ExitFigures preview={data} />
            {data.refusal === null || done !== null ? null : (
              <Alert tone="warning" title="Cannot close early">
                {data.refusal.message}
              </Alert>
            )}
            {done === null ? null : (
              <Alert tone="success" title="Closed early">
                {`${formatINR(toPaise(done.amountPaise), { showDecimals: true })} is recorded as a pending payout. Record the bank transfer outcome under Early exits below once the money is sent.`}
              </Alert>
            )}
            <HeldWriteNotice write={write} subject="the SIP was closed early" onReload={onReload} />
            <span className={ACTION_ROW}>
              {done === null ? (
                <Button
                  tone="danger"
                  disabled={locked || data.refusal !== null}
                  loading={write.pending}
                  onClick={() => {
                    setConfirming(true)
                  }}
                >
                  Close early and return the value
                </Button>
              ) : null}
              <Button tone="ghost" disabled={write.pending || write.outcome.kind === "unknown"} onClick={onClose}>
                {done === null ? "Cancel" : "Done"}
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
              <ExitFigures preview={data} />
            </ConfirmDialog>
          </div>
        )}
      </AsyncBoundary>
    </Card>
  )
}
