import { daysBetween, indiaToday, parseIsoDateTime } from "~/domain/dates"
import { countOf } from "~/domain/plural"
import { supportRequestState, type SupportRequestState } from "~/domain/status"
import { supportCategoryLabel } from "~/domain/supportCategories"

import type { SupportTicketEvent } from "./supportQueries"

const SUPPORT_STATES: readonly SupportRequestState[] = ["open", "in_progress", "resolved", "closed"]

export const SUPPORT_STATE_OPTIONS = SUPPORT_STATES.map((value) => ({
  value,
  label: supportRequestState(value).label,
}))

export const isSupportState = (value: string): value is SupportRequestState =>
  (SUPPORT_STATES as readonly string[]).includes(value)

const stateLabel = (value: string | null): string =>
  value !== null && isSupportState(value) ? supportRequestState(value).label : (value ?? "none")

const indiaDayOf = (moment: Date): Date => parseIsoDateTime(`${indiaToday(moment)}T00:00:00Z`)

export const ticketAge = (createdAt: string, now: Date): string => {
  const days = daysBetween(indiaDayOf(parseIsoDateTime(createdAt)), indiaDayOf(now))
  return days <= 0 ? "Today" : countOf(days, "day")
}

export const categoryText = (category: string): string => supportCategoryLabel(category) ?? category

export const describeEvent = (event: SupportTicketEvent): string => {
  if (event.command === "support.request_created") return "Raised by the client"
  if (event.command === "support.request_responded") {
    const movement =
      event.fromState === event.toState
        ? `Status stayed ${stateLabel(event.toState)}`
        : `Status changed from ${stateLabel(event.fromState)} to ${stateLabel(event.toState)}`
    return event.noteChanged ? `${movement}, reply updated` : movement
  }
  return event.command
}
