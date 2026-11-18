import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminSipScheduleRepository } from "../../repositories/adminSipScheduleRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { RecordingCategory } from "../shared/recordingCategory.js"
import { endMonthOf, isMonthInSchedule } from "./sipScheduleMonths.js"

export interface SipMonthLinkInput {
  readonly scheduleId: string
  readonly month: string
}

export interface PreparedSipMonthLink {
  readonly scheduleId: string
  readonly userId: string
  readonly fundId: string
  readonly month: string
  readonly scheduleVersion: number
}

export interface SipMonthLinkDeps {
  readonly sipScheduleRepository: AdminSipScheduleRepository
  readonly auditRepository: AuditWriteRepository
}

const SCHEDULE_FIELD = "sipScheduleLink.scheduleId"
const MONTH_FIELD = "sipScheduleLink.month"

const refuse = (field: string, message: string): AppError =>
  new AppError("VALIDATION_FAILED", { fields: { [field]: [message] } })

export const prepareSipMonthLink = async (
  tx: Transaction,
  deps: Pick<SipMonthLinkDeps, "sipScheduleRepository">,
  input: Readonly<{ userId: string; fundId: string; category: RecordingCategory; link: SipMonthLinkInput }>,
): Promise<PreparedSipMonthLink> => {
  if (input.category !== "monthly_investment") {
    throw refuse("sipScheduleLink", "only a monthly investment can be linked to a SIP schedule month")
  }
  const owner = await deps.sipScheduleRepository.findOwner(tx, input.link.scheduleId)
  if (owner === null || owner.userId !== input.userId) {
    throw refuse(SCHEDULE_FIELD, "is not a SIP schedule of this client")
  }
  const schedule = await deps.sipScheduleRepository.lockById(tx, input.link.scheduleId)
  if (schedule === null || schedule.userId !== input.userId) {
    throw refuse(SCHEDULE_FIELD, "is not a SIP schedule of this client")
  }
  if (schedule.fundId !== input.fundId) {
    throw refuse(SCHEDULE_FIELD, "is a SIP schedule for a different fund")
  }
  if (schedule.state !== "active") {
    throw refuse(SCHEDULE_FIELD, "is closed; reopen it before linking a month")
  }
  if (!isMonthInSchedule(input.link.month, schedule.startMonth, schedule.monthCount)) {
    const endMonth = endMonthOf(schedule.startMonth, schedule.monthCount)
    throw refuse(MONTH_FIELD, `must be a schedule month from ${schedule.startMonth} to ${endMonth}`)
  }
  const existing = await deps.sipScheduleRepository.findLiveLink(tx, {
    scheduleId: schedule.id,
    month: input.link.month,
  })
  if (existing !== null) {
    throw refuse(MONTH_FIELD, "is already paid by another recording")
  }
  return {
    scheduleId: schedule.id,
    userId: schedule.userId,
    fundId: schedule.fundId,
    month: input.link.month,
    scheduleVersion: Number(schedule.version),
  }
}

export const commitSipMonthLink = async (
  tx: Transaction,
  deps: SipMonthLinkDeps,
  prepared: PreparedSipMonthLink,
  input: Readonly<{
    entryId: string
    actorUserId: string
    requestId: string
    context?: Readonly<Record<string, unknown>>
  }>,
): Promise<void> => {
  const link = await deps.sipScheduleRepository.insertLink(tx, {
    scheduleId: prepared.scheduleId,
    userId: prepared.userId,
    fundId: prepared.fundId,
    month: prepared.month,
    entryId: input.entryId,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "admin_sip_schedule.month_linked",
    entityType: "admin_sip_schedule",
    entityId: prepared.scheduleId,
    toState: "linked",
    requestId: input.requestId,
    entityVersion: prepared.scheduleVersion,
    metadata: {
      userId: prepared.userId,
      fundId: prepared.fundId,
      sipMonth: prepared.month,
      entryId: input.entryId,
      linkId: link.id,
      ...input.context,
    },
  })
}

export const releaseSipMonthOnReversal = async (
  tx: Transaction,
  deps: SipMonthLinkDeps,
  input: Readonly<{ entryId: string; reversalEntryId: string; actorUserId: string; requestId: string }>,
): Promise<void> => {
  const released = await deps.sipScheduleRepository.releaseLinkForEntry(tx, input.entryId)
  if (released === null) return
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "admin_sip_schedule.month_released",
    entityType: "admin_sip_schedule",
    entityId: released.scheduleId,
    fromState: "linked",
    toState: "released",
    requestId: input.requestId,
    entityVersion: Number(released.scheduleVersion),
    metadata: {
      userId: released.userId,
      fundId: released.fundId,
      sipMonth: released.month,
      entryId: input.entryId,
      reversalEntryId: input.reversalEntryId,
      linkId: released.id,
    },
  })
}
