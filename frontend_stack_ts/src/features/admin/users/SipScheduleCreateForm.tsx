import { useState } from "react"

import { formatYearMonth, indiaToday } from "~/domain/dates"
import { CatalogueFundPicker } from "~/features/admin/client-values/CatalogueFundPicker"
import { parsePositiveRupees } from "~/features/admin/client-values/rupeeAmount"
import { SIP_MONTH_PATTERN, parseMonthCount } from "~/features/admin/client-values/sipScheduleMonths"
import { useCreateSipSchedule } from "~/features/admin/client-values/sipScheduleQueries"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

export type SipScheduleCreateFormProps = Readonly<{
  userId: string
  onReload: () => void
  onClose: () => void
}>

export const SipScheduleCreateForm = ({ userId, onReload, onClose }: SipScheduleCreateFormProps): React.ReactElement => {
  const write = useHeldWrite(useCreateSipSchedule(userId), "The schedule could not be sent. Reload the page and try again.")
  const [fundId, setFundId] = useState("")
  const [rupees, setRupees] = useState("")
  const [startMonth, setStartMonth] = useState(indiaToday().slice(0, 7))
  const [months, setMonths] = useState("12")

  const amountPaise = parsePositiveRupees(rupees)
  const monthCount = parseMonthCount(months)
  const monthValid = SIP_MONTH_PATTERN.test(startMonth)
  const locked = write.pending || write.outcome.kind === "unknown" || write.outcome.kind === "done"
  const ready = fundId !== "" && amountPaise !== null && monthCount !== null && monthValid

  if (write.outcome.kind === "done") {
    const saved = write.outcome.result
    return (
      <Alert
        tone="success"
        title="SIP schedule started"
        action={
          <Button size="sm" tone="secondary" onClick={onClose}>
            Done
          </Button>
        }
      >
        {`${saved.fundName}: ${String(saved.monthCount)} months from ${formatYearMonth(saved.startMonth)}. The client sees it on their portfolio. Nothing is collected automatically; link each monthly investment you record to its month.`}
      </Alert>
    )
  }

  return (
    <Card elevated>
      <div className={STACK_LG}>
        <HeldWriteNotice write={write} subject="the schedule was started" onReload={onReload} />
        <div className={ADMIN_FORM_GRID}>
          <CatalogueFundPicker value={fundId} disabled={locked} onChange={setFundId} />
          <FormField
            label="Monthly amount in rupees"
            required
            hint="The amount the client has agreed to pay each month."
            error={rupees !== "" && amountPaise === null ? "Enter an amount above zero with at most two decimal places." : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <AmountInput
                id={id}
                value={rupees}
                decimals
                invalid={invalid}
                describedBy={describedBy}
                disabled={locked}
                onChange={setRupees}
              />
            )}
          </FormField>
        </div>
        <div className={ADMIN_FORM_GRID}>
          <FormField label="Start month" required error={monthValid ? undefined : "Choose a month."}>
            {({ id }) => (
              <Input
                id={id}
                type="month"
                value={startMonth}
                disabled={locked}
                onChange={(event) => {
                  setStartMonth(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField
            label="Number of months"
            required
            hint="Between 1 and 600."
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
          <Button
            disabled={locked || !ready}
            loading={write.pending}
            onClick={() => {
              if (amountPaise === null || monthCount === null) return
              write.submit({ fundId, monthlyAmountPaise: amountPaise, startMonth, monthCount })
            }}
          >
            Start the schedule
          </Button>
          <Button tone="ghost" disabled={write.held !== null || write.pending} onClick={onClose}>
            Cancel
          </Button>
        </span>
      </div>
    </Card>
  )
}
