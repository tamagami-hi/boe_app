import { paiseToRupeeText, parsePositiveRupees } from "~/features/admin/client-values/rupeeAmount"

export const MONTHLY_REASON = "recorded_offline_monthly_investment"

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

export const AMOUNT_MESSAGE = "Enter rupees above zero with at most two decimals, for example 5000 or 2500.50."
export const DATE_MESSAGE = "Enter a real date written as YYYY-MM-DD, today or earlier."

export type SheetRecorded = Readonly<{ entryId: string; amountPaise: string; effectiveDate: string }>

export type SheetSchedule = Readonly<{
  scheduleId: string
  userId: string
  clientName: string
  clientEmail: string
  fundId: string
  fundName: string
  monthlyAmountPaise: string
  startMonth: string
  monthCount: number
  recorded: SheetRecorded | null
}>

export type RowDraft = Readonly<{ selected: boolean; amountText: string; dateText: string }>

export type DraftCheck =
  | Readonly<{ kind: "ready"; amountPaise: string; effectiveDate: string }>
  | Readonly<{ kind: "invalid"; amountError: string | null; dateError: string | null }>

export type RecordingBody = Readonly<{
  fundId: string
  amountPaise: string
  effectiveDate: string
  reasonCode: typeof MONTHLY_REASON
  sipScheduleLink: Readonly<{ scheduleId: string; month: string }>
}>

export type RowStatus = "pending" | "queued" | "sending" | "recorded" | "refused" | "unknown" | "unreadable"

export type RowEntry =
  | Readonly<{ kind: "queued" }>
  | Readonly<{ kind: "sending" }>
  | Readonly<{ kind: "recorded"; amountPaise: string; effectiveDate: string }>
  | Readonly<{ kind: "refused"; message: string }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "rearmed" }>

export const parseSheetAmount = (text: string): string | null => parsePositiveRupees(text.trim())

export const isPastOrToday = (text: string, today: string): boolean => {
  if (!CALENDAR_DATE_PATTERN.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text && text <= today
}

export const defaultDraft = (schedule: SheetSchedule, today: string): RowDraft => ({
  selected: false,
  amountText: paiseToRupeeText(schedule.monthlyAmountPaise),
  dateText: today,
})

export const checkDraft = (draft: RowDraft, today: string): DraftCheck => {
  const amountPaise = parseSheetAmount(draft.amountText)
  const effectiveDate = draft.dateText.trim()
  const dateValid = isPastOrToday(effectiveDate, today)
  if (amountPaise !== null && dateValid) return { kind: "ready", amountPaise, effectiveDate }
  return {
    kind: "invalid",
    amountError: amountPaise === null ? AMOUNT_MESSAGE : null,
    dateError: dateValid ? null : DATE_MESSAGE,
  }
}

export const recordingBodyOf = (
  schedule: SheetSchedule,
  month: string,
  ready: Readonly<{ amountPaise: string; effectiveDate: string }>,
): RecordingBody => ({
  fundId: schedule.fundId,
  amountPaise: ready.amountPaise,
  effectiveDate: ready.effectiveDate,
  reasonCode: MONTHLY_REASON,
  sipScheduleLink: { scheduleId: schedule.scheduleId, month },
})

export const statusOf = (entry: RowEntry | undefined, recordedOnServer: boolean): RowStatus => {
  if (entry === undefined) return recordedOnServer ? "recorded" : "pending"
  return entry.kind === "rearmed" ? "pending" : entry.kind
}

export const canFill = (status: RowStatus): boolean => status === "pending" || status === "refused"
