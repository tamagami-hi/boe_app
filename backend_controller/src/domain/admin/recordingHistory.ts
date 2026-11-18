import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type {
  AdminSipScheduleRepository,
  AdminSipScheduleRow,
  LockedSipSchedule,
} from "../../repositories/adminSipScheduleRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { RecordingCategoryRepository, RecordingRow } from "../../repositories/recordingCategoryRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { requireRecordableClient } from "./recordContribution.js"
import { commitSipMonthLink } from "./sipMonthLink.js"
import { endMonthOf, isMonthInSchedule } from "./sipScheduleMonths.js"

export interface RecordingHistoryDeps {
  readonly recordingCategoryRepository: RecordingCategoryRepository
  readonly sipScheduleRepository: AdminSipScheduleRepository
  readonly clientGrowthRepository: Pick<ClientGrowthRepository, "lockPosition">
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
}

export interface HistoryLink {
  readonly month: string
  readonly entryId: string
}

export interface LinkEarlierRecordingsCommand {
  readonly userId: string
  readonly scheduleId: string
  readonly links: readonly HistoryLink[]
  readonly actorUserId: string
  readonly requestId: string
}

export interface MarkOneTimeCommand {
  readonly userId: string
  readonly entryId: string
  readonly actorUserId: string
  readonly requestId: string
}

const CLOSED_MESSAGE = "This SIP schedule is closed. Reopen it before linking months to it."
const REVERSED_MESSAGE = "This recording was reversed, so it no longer counts and cannot be given a category."
const LINKED_MESSAGE = "This recording is linked to a SIP month, so it is already a SIP payment."
const ONE_TIME_MESSAGE = "This recording is already marked as a one-time investment."

export const isSipLinkAllowed = (row: RecordingRow): boolean => !row.reversed && !row.linked

export const isOneTimeAllowed = (row: RecordingRow): boolean => isSipLinkAllowed(row) && !row.oneTime

type Refusal = readonly [field: string, message: string]

const monthRefusal = (schedule: LockedSipSchedule, paid: ReadonlySet<string>, month: string): string | null => {
  if (!isMonthInSchedule(month, schedule.startMonth, schedule.monthCount)) {
    return `must be a schedule month from ${schedule.startMonth} to ${endMonthOf(schedule.startMonth, schedule.monthCount)}`
  }
  return paid.has(month) ? "is already paid by another recording" : null
}

const entryRefusal = (recording: RecordingRow | undefined): string | null => {
  if (recording === undefined) return "is not a recording of this client in this schedule's fund"
  if (recording.reversed) return "was reversed"
  return recording.linked ? "is already linked to a SIP month" : null
}

const repeatedAt = (values: readonly string[], index: number): boolean => values.indexOf(values[index] ?? "") !== index

const linkRefusals = (
  schedule: LockedSipSchedule,
  paidMonths: readonly string[],
  recordings: ReadonlyMap<string, RecordingRow>,
  links: readonly HistoryLink[],
): readonly Refusal[] => {
  const paid = new Set(paidMonths)
  const months = links.map((link) => link.month)
  const entries = links.map((link) => link.entryId)
  return links.flatMap((link, index): Refusal[] => {
    const month = repeatedAt(months, index) ? "appears more than once in this request" : monthRefusal(schedule, paid, link.month)
    const entry = repeatedAt(entries, index)
      ? "appears more than once in this request"
      : entryRefusal(recordings.get(link.entryId))
    return [
      ...(month === null ? [] : [[`links.${String(index)}.month`, month] as const]),
      ...(entry === null ? [] : [[`links.${String(index)}.entryId`, entry] as const]),
    ]
  })
}

const fieldsOf = (refusals: readonly Refusal[]): Record<string, string[]> =>
  Object.fromEntries(refusals.map(([field, message]) => [field, [message]]))

const lockClientSchedule = async (
  tx: Transaction,
  deps: RecordingHistoryDeps,
  command: Pick<LinkEarlierRecordingsCommand, "userId" | "scheduleId">,
): Promise<LockedSipSchedule> => {
  const owner = await deps.sipScheduleRepository.findOwner(tx, command.scheduleId)
  if (owner === null || owner.userId !== command.userId) throw new AppError("RESOURCE_NOT_FOUND")
  await deps.clientGrowthRepository.lockPosition(tx, command.userId, owner.fundId)
  await requireRecordableClient(tx, deps, command.userId as UserId)
  const schedule = await deps.sipScheduleRepository.lockById(tx, command.scheduleId)
  if (schedule === null || schedule.userId !== command.userId) throw new AppError("RESOURCE_NOT_FOUND")
  if (schedule.state !== "active") throw new AppError("STATE_CONFLICT", { message: CLOSED_MESSAGE })
  return schedule
}

const loadSchedule = async (
  tx: Transaction,
  deps: RecordingHistoryDeps,
  userId: string,
  scheduleId: string,
): Promise<AdminSipScheduleRow> => {
  const row = await deps.sipScheduleRepository.findForUser(tx, { userId, scheduleId })
  if (row === null) throw new AppError("INTERNAL_ERROR")
  return row
}

export const linkEarlierRecordings = async (
  tx: Transaction,
  deps: RecordingHistoryDeps,
  command: LinkEarlierRecordingsCommand,
): Promise<AdminSipScheduleRow> => {
  const schedule = await lockClientSchedule(tx, deps, command)
  const before = await loadSchedule(tx, deps, command.userId, schedule.id)
  const recordings = new Map(
    (await deps.recordingCategoryRepository.listRecordings(tx, { userId: command.userId, fundId: schedule.fundId })).map(
      (row) => [row.entryId, row] as const,
    ),
  )
  const refusals = linkRefusals(schedule, before.paidMonths, recordings, command.links)
  if (refusals.length > 0) throw new AppError("VALIDATION_FAILED", { fields: fieldsOf(refusals) })

  const prepared = {
    scheduleId: schedule.id,
    userId: schedule.userId,
    fundId: schedule.fundId,
    scheduleVersion: Number(schedule.version),
  }
  for (const link of command.links) {
    await commitSipMonthLink(tx, deps, { ...prepared, month: link.month }, {
      entryId: link.entryId,
      actorUserId: command.actorUserId,
      requestId: command.requestId,
      context: {
        source: "earlier_recording",
        previousCategory: recordings.get(link.entryId)?.oneTime === true ? "one_time" : null,
      },
    })
  }
  return loadSchedule(tx, deps, command.userId, schedule.id)
}

const refuseCategory = (recording: RecordingRow): void => {
  const message = recording.reversed
    ? REVERSED_MESSAGE
    : recording.linked
      ? LINKED_MESSAGE
      : recording.oneTime
        ? ONE_TIME_MESSAGE
        : null
  if (message !== null) throw new AppError("STATE_CONFLICT", { message })
}

export const markRecordingOneTime = async (
  tx: Transaction,
  deps: RecordingHistoryDeps,
  command: MarkOneTimeCommand,
): Promise<RecordingRow> => {
  const located = await deps.recordingCategoryRepository.findRecording(tx, command)
  if (located === null) throw new AppError("RESOURCE_NOT_FOUND")
  await deps.clientGrowthRepository.lockPosition(tx, command.userId, located.fundId)
  await requireRecordableClient(tx, deps, command.userId as UserId)
  const recording = await deps.recordingCategoryRepository.findRecording(tx, command)
  if (recording === null) throw new AppError("RESOURCE_NOT_FOUND")
  refuseCategory(recording)

  const stored = await deps.recordingCategoryRepository.insertOneTime(tx, {
    entryId: recording.entryId,
    userId: command.userId,
    fundId: recording.fundId,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_value_entry.category_set",
    entityType: "client_value_entry",
    entityId: recording.entryId,
    fromState: null,
    toState: "one_time",
    requestId: command.requestId,
    entityVersion: 1,
    metadata: {
      userId: command.userId,
      fundId: recording.fundId,
      reasonCode: recording.reasonCode,
      categoryId: stored.id,
    },
  })
  return { ...recording, oneTime: true }
}
