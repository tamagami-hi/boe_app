import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminSipScheduleRow } from "../../repositories/adminSipScheduleRepository.js"
import type { LockedMaturitySchedule } from "../../repositories/clientMaturityScheduleRepository.js"
import { editAdminSipSchedule, type AdminSipScheduleDeps } from "./adminSipSchedules.js"
import { isMaturityDate } from "./maturityDueWindow.js"
import { loadMaturitySchedule, type MaturityScheduleDeps } from "./maturitySchedules.js"
import { MAX_SCHEDULE_MONTHS } from "./sipScheduleMonths.js"

export interface SipExtension {
  readonly months: number
  readonly nextMaturityDate: string
}

interface Actor {
  readonly actorUserId: string
  readonly requestId: string
}

export const NO_ACTIVE_SIP_MESSAGE =
  "This client has no active SIP schedule for this fund, so there is nothing to extend. Choose the one-time option or create a SIP schedule first."

export const findActiveSip = async (
  tx: Transaction,
  deps: Pick<AdminSipScheduleDeps, "sipScheduleRepository">,
  holding: Readonly<{ userId: string; fundId: string }>,
): Promise<AdminSipScheduleRow | null> =>
  (await deps.sipScheduleRepository.listByUser(tx, holding.userId)).find(
    (row) => row.fundId === holding.fundId && row.state === "active",
  ) ?? null

export const refuseInvalidExtension = (
  schedule: Pick<LockedMaturitySchedule, "maturityDate">,
  extension: SipExtension,
  activeSip: AdminSipScheduleRow | null,
): AdminSipScheduleRow => {
  if (!isMaturityDate(extension.nextMaturityDate) || extension.nextMaturityDate <= schedule.maturityDate) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "extension.nextMaturityDate": ["must be a calendar date after the current maturity date"] },
    })
  }
  if (activeSip === null) throw new AppError("STATE_CONFLICT", { message: NO_ACTIVE_SIP_MESSAGE })
  const room = MAX_SCHEDULE_MONTHS - activeSip.monthCount
  if (extension.months > room) {
    throw new AppError("VALIDATION_FAILED", {
      fields: {
        "extension.months": [
          `must be at most ${String(room)}: the SIP schedule already has ${String(activeSip.monthCount)} of the ${String(MAX_SCHEDULE_MONTHS)} months allowed`,
        ],
      },
    })
  }
  return activeSip
}

export const extendActiveSip = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  schedule: LockedMaturitySchedule,
  command: Actor & Readonly<{ extension: SipExtension }>,
): Promise<string> => {
  const active = refuseInvalidExtension(schedule, command.extension, await findActiveSip(tx, deps, schedule))
  const extended = await editAdminSipSchedule(tx, deps, {
    userId: schedule.userId,
    scheduleId: active.id,
    expectedVersion: Number(active.version),
    monthCount: active.monthCount + command.extension.months,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  return extended.id
}

export const scheduleNextMaturity = async (
  tx: Transaction,
  deps: MaturityScheduleDeps,
  previous: LockedMaturitySchedule,
  command: Actor & Readonly<{ nextMaturityDate: string }>,
): Promise<string> => {
  const inserted = await deps.maturityScheduleRepository.insert(tx, {
    userId: previous.userId,
    fundId: previous.fundId,
    maturityDate: command.nextMaturityDate,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  const row = await loadMaturitySchedule(tx, deps, previous.userId, inserted.id)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_maturity_schedule.created",
    entityType: "client_maturity_schedule",
    entityId: row.id,
    toState: row.state,
    requestId: command.requestId,
    entityVersion: Number(row.version),
    metadata: {
      userId: row.userId,
      fundId: row.fundId,
      maturityDate: row.maturityDate,
      extendedFromScheduleId: previous.id,
    },
  })
  return row.id
}
