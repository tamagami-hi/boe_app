import type { AdminRecordingReasonCode } from "@beonedge/contracts"

import { paiseToRupeeText } from "./rupeeAmount"
import type { SipMonthLink } from "./sipMonthLink"
import { unpaidMonthsOf } from "./sipScheduleMonths"
import type { AdminSipScheduleItem } from "./sipScheduleQueries"

export const MONTHLY_RECORDING_REASON = "recorded_offline_monthly_investment"

export type RecordingPrefill = Readonly<{
  fundId: string
  rupees: string
  effectiveDate: string
  reasonCode: AdminRecordingReasonCode
  sipMonth: SipMonthLink | null
}>

export const monthlyPrefillOf = (schedule: AdminSipScheduleItem, today: string): RecordingPrefill => {
  const month = today.slice(0, 7)
  return {
    fundId: schedule.fundId,
    rupees: paiseToRupeeText(schedule.monthlyAmountPaise),
    effectiveDate: today,
    reasonCode: MONTHLY_RECORDING_REASON,
    sipMonth: unpaidMonthsOf(schedule).includes(month) ? { scheduleId: schedule.scheduleId, month } : null,
  }
}
