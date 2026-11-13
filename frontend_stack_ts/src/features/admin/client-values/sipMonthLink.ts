import { useState } from "react"

import { formatYearMonth } from "~/domain/dates"

import { monthNumberOf } from "./sipScheduleMonths"
import { useClientSipSchedules, type AdminSipScheduleItem } from "./sipScheduleQueries"

export const NO_SIP_MONTH_LINK = "none"

export type SipMonthLink = Readonly<{ scheduleId: string; month: string }>

export type SipMonthLinkState = Readonly<{
  status: "off" | "loading" | "failed" | "none" | "ready"
  schedule: AdminSipScheduleItem | null
  selected: string
  link: SipMonthLink | null
  blocking: boolean
  choose: (month: string) => void
  retry: () => void
  reset: () => void
}>

type Choice = Readonly<{ scheduleId: string; month: string }>

export const useSipMonthLink = (userId: string, fundId: string, monthly: boolean): SipMonthLinkState => {
  const wanted = monthly && fundId !== ""
  const schedules = useClientSipSchedules(wanted ? userId : "")
  const [choice, setChoice] = useState<Choice | null>(null)

  const schedule =
    schedules.data?.items.find((item) => item.fundId === fundId && item.state === "active") ?? null
  const status: SipMonthLinkState["status"] = !wanted
    ? "off"
    : schedules.data === undefined
      ? schedules.error == null
        ? "loading"
        : "failed"
      : schedule === null
        ? "none"
        : "ready"
  const chosen = choice !== null && choice.scheduleId === schedule?.scheduleId ? choice.month : null
  const selected = chosen ?? schedule?.nextUnpaidMonth ?? NO_SIP_MONTH_LINK
  const link = status === "ready" && schedule !== null && selected !== NO_SIP_MONTH_LINK ? { scheduleId: schedule.scheduleId, month: selected } : null

  return {
    status,
    schedule,
    selected,
    link,
    blocking: status === "loading" || status === "failed",
    choose: (month) => {
      if (schedule !== null) setChoice({ scheduleId: schedule.scheduleId, month })
    },
    retry: () => {
      void schedules.refetch()
    },
    reset: () => {
      setChoice(null)
    },
  }
}

export const sipMonthLabel = (schedule: AdminSipScheduleItem, month: string): string =>
  `${formatYearMonth(month)}, month ${String(monthNumberOf(schedule, month))} of ${String(schedule.monthCount)}`
