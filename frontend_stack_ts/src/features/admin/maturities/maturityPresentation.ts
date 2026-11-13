import { formatDate } from "~/domain/dates"
import type { StatusTone } from "~/ui/recipes/surface"

export type DueBadge = Readonly<{ tone: StatusTone; label: string }>

const DUE_BADGES: Readonly<Record<string, DueBadge>> = {
  overdue: { tone: "negative", label: "Overdue" },
  due_soon: { tone: "warning", label: "Due soon" },
  upcoming: { tone: "neutral", label: "Upcoming" },
}

const RESOLUTION_LABELS: Readonly<Record<string, string>> = {
  return_all: "All money returned",
  one_time_and_sip: "One-time investment and new SIP",
  sip_reinvestment: "Reinvested as a SIP",
  sip_extension: "SIP extended",
}

export const OPTION_LABELS: Readonly<Record<string, string>> = {
  return_all: "Return all the money",
  one_time_and_sip: "One-time investment, then a new SIP",
  sip_extension: "Extend the SIP",
}

export const offerStatusText = (offer: Readonly<{ chosenOption: string | null }> | null): string | null => {
  if (offer === null) return null
  if (offer.chosenOption === null) return "Options sent, waiting for the client"
  return `Client chose: ${OPTION_LABELS[offer.chosenOption] ?? offer.chosenOption}`
}

export const dueBadgeOf = (item: Readonly<{ state: string; dueStatus: string; resolution: string | null }>): DueBadge => {
  if (item.state === "resolved") {
    return { tone: "positive", label: RESOLUTION_LABELS[item.resolution ?? ""] ?? "Resolved" }
  }
  if (item.state === "cancelled") return { tone: "neutral", label: "Cancelled" }
  return DUE_BADGES[item.dueStatus] ?? { tone: "neutral", label: "Scheduled" }
}

export const dueTextOf = (item: Readonly<{ state: string; daysUntil: number }>): string => {
  if (item.state !== "scheduled") return ""
  if (item.daysUntil === 0) return "Due today"
  if (item.daysUntil > 0) return item.daysUntil === 1 ? "Tomorrow" : `In ${String(item.daysUntil)} days`
  const late = -item.daysUntil
  return late === 1 ? "1 day overdue" : `${String(late)} days overdue`
}

export const formatMaturityDate = (date: string): string => formatDate(`${date}T00:00:00Z`)

export const monthAfter = (date: string): string => {
  const [year = 0, month = 1] = date.slice(0, 7).split("-").map(Number)
  return month === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(month + 1).padStart(2, "0")}`
}

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

export const addMonthsToDate = (date: string, months: number): string => {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number)
  const index = year * 12 + (month - 1) + months
  const nextYear = Math.floor(index / 12)
  const nextMonth = (index % 12) + 1
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth))
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`
}
