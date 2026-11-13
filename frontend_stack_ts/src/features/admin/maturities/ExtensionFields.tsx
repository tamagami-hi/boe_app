import { MAX_SCHEDULE_MONTHS, parseMonthCount } from "~/features/admin/client-values/sipScheduleMonths"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"

import { addMonthsToDate, formatMaturityDate } from "./maturityPresentation"

export type ExtensionDraft = Readonly<{ months: string; nextMaturityDate: string; dateEdited: boolean }>

export type SipExtensionFigures = Readonly<{ months: number; nextMaturityDate: string }>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u
const LATEST_MATURITY_DATE = "2199-12-31"
const DEFAULT_MONTHS = 12

export const initialExtensionDraft = (maturityDate: string): ExtensionDraft => ({
  months: String(DEFAULT_MONTHS),
  nextMaturityDate: addMonthsToDate(maturityDate, DEFAULT_MONTHS),
  dateEdited: false,
})

export const extensionRoom = (monthCount: number): number => MAX_SCHEDULE_MONTHS - monthCount

export const extensionOf = (draft: ExtensionDraft, maturityDate: string, room: number): SipExtensionFigures | null => {
  const months = parseMonthCount(draft.months)
  if (months === null || months > room) return null
  const date = draft.nextMaturityDate
  if (!ISO_DATE.test(date) || date <= maturityDate || date > LATEST_MATURITY_DATE) return null
  return { months, nextMaturityDate: date }
}

export type ExtensionFieldsProps = Readonly<{
  draft: ExtensionDraft
  maturityDate: string
  room: number
  disabled: boolean
  onChange: (next: ExtensionDraft) => void
}>

export const ExtensionFields = ({ draft, maturityDate, room, disabled, onChange }: ExtensionFieldsProps): React.ReactElement => {
  const months = parseMonthCount(draft.months)
  const monthsInvalid = draft.months !== "" && (months === null || months > room)
  const dateInvalid =
    !ISO_DATE.test(draft.nextMaturityDate) || draft.nextMaturityDate <= maturityDate || draft.nextMaturityDate > LATEST_MATURITY_DATE
  return (
    <div className={ADMIN_FORM_GRID}>
      <FormField
        label="Months to add to the SIP"
        required
        hint={`Up to ${String(room)} more months.`}
        error={monthsInvalid ? `Enter a whole number of months from 1 to ${String(room)}.` : undefined}
      >
        {({ id }) => (
          <Input
            id={id}
            inputMode="numeric"
            value={draft.months}
            disabled={disabled}
            onChange={(event) => {
              const text = event.target.value
              const count = parseMonthCount(text)
              const nextMaturityDate =
                draft.dateEdited || count === null ? draft.nextMaturityDate : addMonthsToDate(maturityDate, count)
              onChange({ ...draft, months: text, nextMaturityDate })
            }}
          />
        )}
      </FormField>
      <FormField
        label="Next maturity date"
        required
        hint="Filled in as the current maturity date plus the months added. You can change it."
        error={dateInvalid ? `Choose a date after ${formatMaturityDate(maturityDate)}.` : undefined}
      >
        {({ id }) => (
          <Input
            id={id}
            type="date"
            value={draft.nextMaturityDate}
            min={maturityDate}
            max={LATEST_MATURITY_DATE}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...draft, nextMaturityDate: event.target.value, dateEdited: true })
            }}
          />
        )}
      </FormField>
    </div>
  )
}
