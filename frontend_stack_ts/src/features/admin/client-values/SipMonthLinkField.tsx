import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { PROSE_SM } from "~/ui/recipes/datalist"

import { NO_SIP_MONTH_LINK, sipMonthLabel, type SipMonthLinkState } from "./sipMonthLink"
import { unpaidMonthsOf, type ScheduleMonths } from "./sipScheduleMonths"

const selectableMonths = (schedule: ScheduleMonths, selected: string): readonly string[] => {
  const unpaid = unpaidMonthsOf(schedule)
  return selected === NO_SIP_MONTH_LINK || unpaid.includes(selected) ? unpaid : [selected, ...unpaid]
}

export type SipMonthLinkFieldProps = Readonly<{ state: SipMonthLinkState; disabled: boolean }>

export const SipMonthLinkField = ({ state, disabled }: SipMonthLinkFieldProps): React.ReactElement | null => {
  if (state.status === "off") return null
  if (state.status === "loading") return <p className={PROSE_SM}>Checking this client&apos;s SIP schedule for the fund.</p>
  if (state.status === "failed") {
    return (
      <Alert
        tone="error"
        title="SIP schedule not loaded"
        action={
          <Button size="sm" tone="secondary" onClick={state.retry}>
            Try again
          </Button>
        }
      >
        It is not known whether this client has a SIP schedule for this fund, so this SIP payment cannot be recorded
        until the schedule loads.
      </Alert>
    )
  }
  const schedule = state.schedule
  if (state.status === "none" || schedule === null) {
    return (
      <Alert tone="warning" title="No SIP schedule for this fund">
        A SIP payment needs a month of the client&apos;s SIP schedule for this fund. Start one under SIP schedules on the
        client&apos;s page, or record this as a one-time investment.
      </Alert>
    )
  }
  const months = selectableMonths(schedule, state.selected)
  if (months.length === 0) {
    return (
      <Alert tone="warning" title="Every month is recorded">
        Every month of this SIP schedule already has a payment. Extend the schedule under SIP schedules, or record this as
        a one-time investment.
      </Alert>
    )
  }
  const options = [
    ...(state.selected === NO_SIP_MONTH_LINK ? [{ value: NO_SIP_MONTH_LINK, label: "Choose a month" }] : []),
    ...months.map((month) => ({ value: month, label: sipMonthLabel(schedule, month) })),
  ]
  return (
    <FormField
      label="SIP schedule month"
      required
      hint={`${String(schedule.monthsPaid)} of ${String(schedule.monthCount)} months are paid. The client sees this month on the receipt.`}
    >
      {({ id }) => (
        <Select
          id={id}
          options={options}
          value={state.selected}
          disabled={disabled}
          onChange={(event) => {
            state.choose(event.target.value)
          }}
        />
      )}
    </FormField>
  )
}
