import { useEffect, useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatYearMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paiseToRupeeText, parsePositiveRupees } from "~/features/admin/client-values/rupeeAmount"
import {
  useCloseSipSchedule,
  useEditSipSchedule,
  type AdminSipScheduleItem,
} from "~/features/admin/client-values/sipScheduleQueries"
import { parseMonthCount } from "~/features/admin/client-values/sipScheduleMonths"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

const UNSENT = "The change could not be sent. Reload the schedules and try again."

export type SipScheduleEditorProps = Readonly<{
  userId: string
  schedule: AdminSipScheduleItem
  onReload: () => void
  onClose: () => void
  onHoldChange?: (holding: boolean) => void
}>

export const SipScheduleEditor = ({
  userId,
  schedule,
  onReload,
  onClose,
  onHoldChange,
}: SipScheduleEditorProps): React.ReactElement => {
  const edit = useHeldWrite(useEditSipSchedule(userId), UNSENT)
  const close = useHeldWrite(useCloseSipSchedule(userId), UNSENT)
  const [rupees, setRupees] = useState(paiseToRupeeText(schedule.monthlyAmountPaise))
  const [months, setMonths] = useState(String(schedule.monthCount))
  const [confirmingClose, setConfirmingClose] = useState(false)

  const amountPaise = parsePositiveRupees(rupees)
  const monthCount = parseMonthCount(months)
  const active = schedule.state === "active"
  const pending = edit.pending || close.pending
  const unresolved = edit.outcome.kind === "unknown" || close.outcome.kind === "unknown"
  const locked = pending || unresolved
  const changed = amountPaise !== schedule.monthlyAmountPaise || monthCount !== schedule.monthCount
  const done = edit.outcome.kind === "done" ? edit.outcome.result : close.outcome.kind === "done" ? close.outcome.result : null

  useEffect(() => {
    onHoldChange?.(locked)
    return () => {
      onHoldChange?.(false)
    }
  }, [locked, onHoldChange])

  const save = (): void => {
    if (amountPaise === null || monthCount === null) return
    close.reset()
    edit.submit({
      scheduleId: schedule.scheduleId,
      expectedVersion: schedule.version,
      ...(amountPaise === schedule.monthlyAmountPaise ? {} : { monthlyAmountPaise: amountPaise }),
      ...(monthCount === schedule.monthCount ? {} : { monthCount }),
    })
  }

  const reopen = (): void => {
    close.reset()
    edit.submit({ scheduleId: schedule.scheduleId, expectedVersion: schedule.version, state: "active" })
  }

  const confirmClose = (): void => {
    setConfirmingClose(false)
    edit.reset()
    close.submit({ scheduleId: schedule.scheduleId, expectedVersion: schedule.version })
  }

  return (
    <Card elevated>
      <div className={STACK_LG}>
        <DataList split>
          <DetailRow label="Fund">{schedule.fundName}</DetailRow>
          <DetailRow label="Months">{`${formatYearMonth(schedule.startMonth)} to ${formatYearMonth(schedule.endMonth)}`}</DetailRow>
          <DetailRow label="Paid">{`${String(schedule.monthsPaid)} of ${String(schedule.monthCount)} months`}</DetailRow>
        </DataList>
        {done === null ? null : (
          <Alert tone="success" title="Schedule saved">
            {`Now ${done.state === "active" ? "active" : "closed"}, ${String(done.monthCount)} months, `}
            <MoneyValue amount={toPaise(done.monthlyAmountPaise)} size="sm" showDecimals />
            {" a month. Linked recordings are unchanged."}
          </Alert>
        )}
        <HeldWriteNotice write={edit} subject="the change was saved" onReload={onReload} />
        <HeldWriteNotice write={close} subject="the schedule was closed" onReload={onReload} />
        <div className={ADMIN_FORM_GRID}>
          <FormField
            label="Monthly amount in rupees"
            required
            error={rupees !== "" && amountPaise === null ? "Enter an amount above zero with at most two decimal places." : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <AmountInput id={id} value={rupees} decimals invalid={invalid} describedBy={describedBy} disabled={locked} onChange={setRupees} />
            )}
          </FormField>
          <FormField
            label="Number of months"
            required
            hint="It cannot end before a month that already has a linked recording."
            error={months !== "" && monthCount === null ? "Enter a whole number of months from 1 to 600." : undefined}
          >
            {({ id }) => (
              <Input
                id={id}
                inputMode="numeric"
                value={months}
                disabled={locked}
                onChange={(event) => {
                  setMonths(event.target.value)
                }}
              />
            )}
          </FormField>
        </div>
        <span className={ACTION_ROW}>
          <Button disabled={locked || !changed || amountPaise === null || monthCount === null} loading={edit.pending} onClick={save}>
            Save changes
          </Button>
          {active ? (
            <Button
              tone="secondary"
              disabled={locked}
              loading={close.pending}
              onClick={() => {
                setConfirmingClose(true)
              }}
            >
              Close the schedule
            </Button>
          ) : (
            <Button tone="secondary" disabled={locked} onClick={reopen}>
              Reopen the schedule
            </Button>
          )}
          <Button tone="ghost" disabled={locked} onClick={onClose}>
            Done
          </Button>
        </span>
      </div>
      <ConfirmDialog
        open={confirmingClose}
        title="Close this SIP schedule?"
        description="No more monthly investments can be linked to it. Recordings already linked stay as they are, and the client sees the schedule as closed. It can be reopened later."
        confirmLabel="Close the schedule"
        onConfirm={confirmClose}
        onCancel={() => {
          setConfirmingClose(false)
        }}
      />
    </Card>
  )
}
