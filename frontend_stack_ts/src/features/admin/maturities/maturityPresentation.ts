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
