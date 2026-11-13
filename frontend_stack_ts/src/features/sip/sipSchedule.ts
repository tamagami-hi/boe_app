import { indiaCalendarDate } from "~/domain/dates"

export const upcomingDueDate = (nextDueDate: string | null, now: Date): string | null =>
  nextDueDate !== null && nextDueDate.slice(0, 10) >= indiaCalendarDate(now) ? nextDueDate : null
