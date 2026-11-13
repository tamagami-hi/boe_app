import { indiaCalendarDate } from "../shared/calendarDate.js"

export const SIP_MONTH_PATTERN = /^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/u
export const MAX_SCHEDULE_MONTHS = 600

const MONTHS_PER_YEAR = 12

export type SipScheduleState = "active" | "closed"

export const monthIndexOf = (month: string): number => {
  const match = SIP_MONTH_PATTERN.exec(month)
  if (match === null) throw new RangeError(`not a schedule month: ${month}`)
  return Number(match[1]) * MONTHS_PER_YEAR + Number(match[2]) - 1
}

export const monthTextOf = (index: number): string => {
  const year = Math.floor(index / MONTHS_PER_YEAR)
  const month = (index % MONTHS_PER_YEAR) + 1
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`
}

export const firstDayOf = (month: string): string => `${month}-01`

export const indiaCurrentMonth = (now: Date): string => indiaCalendarDate(now).slice(0, 7)

export const endMonthOf = (startMonth: string, monthCount: number): string =>
  monthTextOf(monthIndexOf(startMonth) + monthCount - 1)

export const isMonthInSchedule = (month: string, startMonth: string, monthCount: number): boolean => {
  const index = monthIndexOf(month)
  const start = monthIndexOf(startMonth)
  return index >= start && index < start + monthCount
}

export const monthsCoveredThrough = (startMonth: string, month: string): number =>
  monthIndexOf(month) - monthIndexOf(startMonth) + 1

export interface ScheduleProgressInput {
  readonly startMonth: string
  readonly monthCount: number
  readonly state: SipScheduleState
  readonly paidMonths: readonly string[]
  readonly currentMonth: string
}

export interface ScheduleProgress {
  readonly endMonth: string
  readonly monthsPaid: number
  readonly monthsDue: number
  readonly nextUnpaidMonth: string | null
}

export const scheduleProgress = (input: ScheduleProgressInput): ScheduleProgress => {
  const start = monthIndexOf(input.startMonth)
  const end = start + input.monthCount - 1
  const paid = new Set(
    input.paidMonths.map(monthIndexOf).filter((index) => index >= start && index <= end),
  )
  const unpaid: number[] = []
  for (let index = start; index <= end; index += 1) {
    if (!paid.has(index)) unpaid.push(index)
  }
  const active = input.state === "active"
  const current = monthIndexOf(input.currentMonth)
  const next = unpaid[0]
  return {
    endMonth: monthTextOf(end),
    monthsPaid: paid.size,
    monthsDue: active ? unpaid.filter((index) => index <= current).length : 0,
    nextUnpaidMonth: active && next !== undefined ? monthTextOf(next) : null,
  }
}
