export const SIP_MONTH_PATTERN = /^2[01]\d{2}-(0[1-9]|1[0-2])$/u
export const MAX_SCHEDULE_MONTHS = 600

const MONTH_COUNT_PATTERN = /^[1-9]\d{0,2}$/u
const MONTHS_PER_YEAR = 12

export const parseMonthCount = (text: string): number | null => {
  if (!MONTH_COUNT_PATTERN.test(text)) return null
  const count = Number(text)
  return count <= MAX_SCHEDULE_MONTHS ? count : null
}

const indexOf = (month: string): number => {
  const [year = 0, number = 1] = month.split("-").map(Number)
  return year * MONTHS_PER_YEAR + number - 1
}

const textOf = (index: number): string =>
  `${String(Math.floor(index / MONTHS_PER_YEAR))}-${String((index % MONTHS_PER_YEAR) + 1).padStart(2, "0")}`

export type ScheduleMonths = Readonly<{ startMonth: string; monthCount: number; paidMonths: readonly string[] }>

export const unpaidMonthsOf = (schedule: ScheduleMonths): readonly string[] => {
  const paid = new Set(schedule.paidMonths)
  const start = indexOf(schedule.startMonth)
  return Array.from({ length: schedule.monthCount }, (_, offset) => textOf(start + offset)).filter(
    (month) => !paid.has(month),
  )
}

export const monthNumberOf = (schedule: ScheduleMonths, month: string): number =>
  indexOf(month) - indexOf(schedule.startMonth) + 1
