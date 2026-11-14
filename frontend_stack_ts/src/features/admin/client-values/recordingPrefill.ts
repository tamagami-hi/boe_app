import type { AdminRecordingReasonCode } from "@beonedge/contracts"

import { paiseToRupeeText } from "./rupeeAmount"
import type { SipMonthLink } from "./sipMonthLink"
import { unpaidMonthsOf, type ScheduleMonths } from "./sipScheduleMonths"
import type { AdminSipScheduleItem } from "./sipScheduleQueries"

export const MONTHLY_RECORDING_REASON = "recorded_offline_monthly_investment"

export type RecordingPrefill = Readonly<{
  fundId: string
  rupees: string
  effectiveDate: string
  reasonCode: AdminRecordingReasonCode
  sipMonth: SipMonthLink
}>

export type ThisMonthStatus = "unpaid" | "paid" | "outside"

const monthOf = (today: string): string => today.slice(0, 7)

export const thisMonthStatus = (schedule: ScheduleMonths, today: string): ThisMonthStatus => {
  const month = monthOf(today)
  if (unpaidMonthsOf(schedule).includes(month)) return "unpaid"
  return schedule.paidMonths.includes(month) ? "paid" : "outside"
}

export const monthlyPrefillOf = (schedule: AdminSipScheduleItem, today: string): RecordingPrefill => ({
  fundId: schedule.fundId,
  rupees: paiseToRupeeText(schedule.monthlyAmountPaise),
  effectiveDate: today,
  reasonCode: MONTHLY_RECORDING_REASON,
  sipMonth: { scheduleId: schedule.scheduleId, month: monthOf(today) },
})
