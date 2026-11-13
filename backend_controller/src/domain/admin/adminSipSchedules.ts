import type { Transaction, UserId } from "../../db/repositories.js"
import type { AdminSipScheduleState } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type {
  AdminSipScheduleRepository,
  AdminSipScheduleRow,
  LockedSipSchedule,
} from "../../repositories/adminSipScheduleRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { requireRecordableClient } from "./recordContribution.js"
import { monthsCoveredThrough } from "./sipScheduleMonths.js"

export interface AdminSipScheduleDeps {
  readonly sipScheduleRepository: AdminSipScheduleRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface CreateSipScheduleCommand {
  readonly userId: string
  readonly fundId: string
  readonly monthlyAmountPaise: bigint
  readonly startMonth: string
  readonly monthCount: number
  readonly actorUserId: string
  readonly requestId: string
}

export interface EditSipScheduleCommand {
  readonly userId: string
  readonly scheduleId: string
  readonly expectedVersion: number
  readonly monthlyAmountPaise?: bigint
  readonly monthCount?: number
  readonly state?: AdminSipScheduleState
  readonly actorUserId: string
  readonly requestId: string
}

const STALE_MESSAGE = "Someone changed this SIP schedule since you opened it. Reload it and try again."
const ACTIVE_EXISTS_MESSAGE = "This client already has an active SIP schedule for this fund. Close it first."
const ALREADY_CLOSED_MESSAGE = "This SIP schedule is already closed."

const loadRow = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  userId: string,
  scheduleId: string,
): Promise<AdminSipScheduleRow> => {
  const row = await deps.sipScheduleRepository.findForUser(tx, { userId, scheduleId })
  if (row === null) throw new AppError("INTERNAL_ERROR")
  return row
}

const lockOwnSchedule = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  command: Readonly<{ userId: string; scheduleId: string; expectedVersion: number }>,
): Promise<LockedSipSchedule> => {
  const user = await deps.userRepository.lockById(tx, command.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  const schedule = await deps.sipScheduleRepository.lockById(tx, command.scheduleId)
  if (schedule === null || schedule.userId !== command.userId) throw new AppError("RESOURCE_NOT_FOUND")
  if (Number(schedule.version) !== command.expectedVersion) {
    throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  }
  return schedule
}

const refuseOrphanedMonths = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  schedule: LockedSipSchedule,
  monthCount: number,
): Promise<void> => {
  const latest = await deps.sipScheduleRepository.latestLinkedMonth(tx, schedule.id)
  if (latest === null) return
  const needed = monthsCoveredThrough(schedule.startMonth, latest)
  if (monthCount < needed) {
    throw new AppError("VALIDATION_FAILED", {
      fields: {
        monthCount: [`must be at least ${String(needed)}: a recording is linked to ${latest}`],
      },
    })
  }
}

export const createAdminSipSchedule = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  command: CreateSipScheduleCommand,
): Promise<AdminSipScheduleRow> => {
  await requireRecordableClient(tx, deps, command.userId as UserId)
  if ((await deps.sipScheduleRepository.findPublishedFund(tx, command.fundId)) === null) {
    throw new AppError("RESOURCE_NOT_FOUND")
  }
  const activeExists = await deps.sipScheduleRepository.hasOtherActive(tx, {
    userId: command.userId,
    fundId: command.fundId,
    exceptScheduleId: null,
  })
  if (activeExists) throw new AppError("STATE_CONFLICT", { message: ACTIVE_EXISTS_MESSAGE })

  const inserted = await deps.sipScheduleRepository.insert(tx, command)
  const row = await loadRow(tx, deps, command.userId, inserted.id)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "admin_sip_schedule.created",
    entityType: "admin_sip_schedule",
    entityId: row.id,
    toState: row.state,
    requestId: command.requestId,
    entityVersion: Number(row.version),
    metadata: {
      userId: row.userId,
      fundId: row.fundId,
      monthlyAmountPaise: row.monthlyAmountPaise,
      startMonth: row.startMonth,
      monthCount: row.monthCount,
    },
  })
  return row
}

const auditEdit = (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  current: LockedSipSchedule,
  row: AdminSipScheduleRow,
  command: EditSipScheduleCommand,
) =>
  deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command:
      row.state === "closed" && current.state !== "closed" ? "admin_sip_schedule.closed" : "admin_sip_schedule.updated",
    entityType: "admin_sip_schedule",
    entityId: row.id,
    fromState: current.state,
    toState: row.state,
    requestId: command.requestId,
    entityVersion: Number(row.version),
    metadata: {
      userId: row.userId,
      fundId: row.fundId,
      previous: {
        monthlyAmountPaise: current.monthlyAmountPaise,
        monthCount: current.monthCount,
        state: current.state,
      },
      monthlyAmountPaise: row.monthlyAmountPaise,
      monthCount: row.monthCount,
    },
  })

const applyEdit = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  current: LockedSipSchedule,
  command: EditSipScheduleCommand,
): Promise<AdminSipScheduleRow> => {
  const next = {
    monthlyAmountPaise: command.monthlyAmountPaise ?? BigInt(current.monthlyAmountPaise),
    monthCount: command.monthCount ?? current.monthCount,
    state: command.state ?? current.state,
  }
  const changed =
    next.monthlyAmountPaise !== BigInt(current.monthlyAmountPaise) ||
    next.monthCount !== current.monthCount ||
    next.state !== current.state
  if (!changed) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { _root: ["repeats the schedule as it is; change the amount, the months or the state"] },
    })
  }
  if (next.monthCount !== current.monthCount) await refuseOrphanedMonths(tx, deps, current, next.monthCount)
  if (next.state === "active" && current.state !== "active") {
    const activeExists = await deps.sipScheduleRepository.hasOtherActive(tx, {
      userId: current.userId,
      fundId: current.fundId,
      exceptScheduleId: current.id,
    })
    if (activeExists) throw new AppError("STATE_CONFLICT", { message: ACTIVE_EXISTS_MESSAGE })
  }

  const applied = await deps.sipScheduleRepository.update(tx, {
    scheduleId: current.id,
    expectedVersion: current.version,
    ...next,
    actorUserId: command.actorUserId,
    now: deps.clock(),
  })
  if (!applied) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  const row = await loadRow(tx, deps, command.userId, current.id)
  await auditEdit(tx, deps, current, row, command)
  return row
}

export const editAdminSipSchedule = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  command: EditSipScheduleCommand,
): Promise<AdminSipScheduleRow> => applyEdit(tx, deps, await lockOwnSchedule(tx, deps, command), command)

export const closeAdminSipSchedule = async (
  tx: Transaction,
  deps: AdminSipScheduleDeps,
  command: Readonly<{ userId: string; scheduleId: string; expectedVersion: number; actorUserId: string; requestId: string }>,
): Promise<AdminSipScheduleRow> => {
  const current = await lockOwnSchedule(tx, deps, command)
  if (current.state === "closed") throw new AppError("STATE_CONFLICT", { message: ALREADY_CLOSED_MESSAGE })
  return applyEdit(tx, deps, current, { ...command, state: "closed" })
}
