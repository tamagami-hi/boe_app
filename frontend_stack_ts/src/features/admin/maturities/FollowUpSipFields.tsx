import { formatYearMonth } from "~/domain/dates"
import { parsePositiveRupees } from "~/features/admin/client-values/rupeeAmount"
import { SIP_MONTH_PATTERN, parseMonthCount } from "~/features/admin/client-values/sipScheduleMonths"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"

export type FollowUpDraft = Readonly<{ rupees: string; startMonth: string; months: string }>

export type FollowUpSip = Readonly<{ monthlyAmountPaise: string; startMonth: string; monthCount: number }>

export const followUpOf = (draft: FollowUpDraft, earliestMonth: string): FollowUpSip | null => {
  const monthlyAmountPaise = parsePositiveRupees(draft.rupees)
  const monthCount = parseMonthCount(draft.months)
  if (monthlyAmountPaise === null || monthCount === null) return null
  if (!SIP_MONTH_PATTERN.test(draft.startMonth) || draft.startMonth < earliestMonth) return null
  return { monthlyAmountPaise, startMonth: draft.startMonth, monthCount }
}

export type FollowUpSipFieldsProps = Readonly<{
  draft: FollowUpDraft
  earliestMonth: string
  disabled: boolean
  onChange: (next: FollowUpDraft) => void
}>

export const FollowUpSipFields = ({ draft, earliestMonth, disabled, onChange }: FollowUpSipFieldsProps): React.ReactElement => {
  const amountInvalid = draft.rupees !== "" && parsePositiveRupees(draft.rupees) === null
  const monthInvalid = !SIP_MONTH_PATTERN.test(draft.startMonth) || draft.startMonth < earliestMonth
  const monthsInvalid = draft.months !== "" && parseMonthCount(draft.months) === null
  return (
    <>
      <div className={ADMIN_FORM_GRID}>
        <FormField
          label="New SIP monthly amount in rupees"
          required
          hint="What the client has agreed to pay each month."
          error={amountInvalid ? "Enter an amount above zero with at most two decimal places." : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <AmountInput
              id={id}
              value={draft.rupees}
              decimals
              invalid={invalid}
              describedBy={describedBy}
              disabled={disabled}
              onChange={(rupees) => {
                onChange({ ...draft, rupees })
              }}
            />
          )}
        </FormField>
        <FormField
          label="First SIP month"
          required
          hint={`${formatYearMonth(earliestMonth)} or later.`}
          error={monthInvalid ? `Choose ${formatYearMonth(earliestMonth)} or a later month.` : undefined}
        >
          {({ id }) => (
            <Input
              id={id}
              type="month"
              value={draft.startMonth}
              min={earliestMonth}
              disabled={disabled}
              onChange={(event) => {
                onChange({ ...draft, startMonth: event.target.value })
              }}
            />
          )}
        </FormField>
      </div>
      <FormField
        label="Number of months"
        required
        hint="Between 1 and 600."
        error={monthsInvalid ? "Enter a whole number of months from 1 to 600." : undefined}
      >
        {({ id }) => (
          <Input
            id={id}
            inputMode="numeric"
            value={draft.months}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...draft, months: event.target.value })
            }}
          />
        )}
      </FormField>
    </>
  )
}
