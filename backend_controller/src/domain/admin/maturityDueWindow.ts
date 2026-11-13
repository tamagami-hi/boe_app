import { indiaCalendarDate } from "../shared/calendarDate.js"

export const MATURITY_DUE_WINDOW_DAYS = 30
export const EARLIEST_MATURITY_DATE = "2000-01-01"
export const LATEST_MATURITY_DATE = "2199-12-31"

const DAY_MS = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u

export type MaturityDueStatus = "overdue" | "due_soon" | "upcoming" | "closed"

export interface MaturityDueWindow {
  readonly asOf: string
  readonly dueThrough: string
  readonly windowDays: number
}

const dayNumberOf = (date: string): number => Date.parse(`${date}T00:00:00.000Z`) / DAY_MS

const dateOfDayNumber = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10)

export const isMaturityDate = (date: string): boolean =>
  ISO_DATE.test(date) &&
  Number.isFinite(dayNumberOf(date)) &&
  dateOfDayNumber(dayNumberOf(date)) === date &&
  date >= EARLIEST_MATURITY_DATE &&
  date <= LATEST_MATURITY_DATE

export const maturityDueWindow = (now: Date): MaturityDueWindow => {
  const asOf = indiaCalendarDate(now)
  return {
    asOf,
    dueThrough: dateOfDayNumber(dayNumberOf(asOf) + MATURITY_DUE_WINDOW_DAYS),
    windowDays: MATURITY_DUE_WINDOW_DAYS,
  }
}

export const daysUntilMaturity = (maturityDate: string, window: MaturityDueWindow): number =>
  dayNumberOf(maturityDate) - dayNumberOf(window.asOf)

export const maturityDueStatus = (
  schedule: Readonly<{ state: string; maturityDate: string }>,
  window: MaturityDueWindow,
): MaturityDueStatus => {
  if (schedule.state !== "scheduled") return "closed"
  if (schedule.maturityDate < window.asOf) return "overdue"
  return schedule.maturityDate <= window.dueThrough ? "due_soon" : "upcoming"
}
