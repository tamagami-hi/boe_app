import { MONTHLY_RECORDING_REASON } from "../shared/recordingCategory.js"
import { monthIndexOf, monthTextOf } from "./sipScheduleMonths.js"

const MONTHS_PER_YEAR = 12

export interface ProposalCandidate {
  readonly entryId: string
  readonly effectiveDate: string
  readonly recordedAt: Date
  readonly reasonCode: string
  readonly oneTime: boolean
}

export interface ProposalSchedule {
  readonly startMonth: string
  readonly monthCount: number
  readonly filledMonths: readonly string[]
}

const indexOfDate = (date: string): number => Number(date.slice(0, 4)) * MONTHS_PER_YEAR + Number(date.slice(5, 7)) - 1

const oldestFirst = (left: ProposalCandidate, right: ProposalCandidate): number =>
  left.effectiveDate.localeCompare(right.effectiveDate) ||
  left.recordedAt.getTime() - right.recordedAt.getTime() ||
  left.entryId.localeCompare(right.entryId)

export const scheduleMonthsOf = (startMonth: string, monthCount: number): readonly string[] => {
  const start = monthIndexOf(startMonth)
  return Array.from({ length: monthCount }, (_, offset) => monthTextOf(start + offset))
}

export const proposeSipLinks = (
  schedule: ProposalSchedule,
  candidates: readonly ProposalCandidate[],
): ReadonlyMap<string, string> => {
  const filled = new Set(schedule.filledMonths)
  const open = scheduleMonthsOf(schedule.startMonth, schedule.monthCount).filter((month) => !filled.has(month))
  const pool = candidates
    .filter((candidate) => candidate.reasonCode === MONTHLY_RECORDING_REASON && !candidate.oneTime)
    .sort(oldestFirst)

  const exact = pool.reduce<ReadonlyMap<string, string>>((assigned, candidate) => {
    const month = candidate.effectiveDate.slice(0, 7)
    return open.includes(month) && !assigned.has(month) ? new Map([...assigned, [month, candidate.entryId]]) : assigned
  }, new Map())

  const used = new Set(exact.values())
  const start = monthIndexOf(schedule.startMonth)
  const leftovers = pool.filter((candidate) => !used.has(candidate.entryId) && indexOfDate(candidate.effectiveDate) >= start)
  const remaining = open.filter((month) => !exact.has(month))
  const filledLater = leftovers.flatMap((candidate, index): (readonly [string, string])[] => {
    const month = remaining[index]
    return month === undefined ? [] : [[month, candidate.entryId]]
  })
  return new Map([...exact, ...filledLater])
}
