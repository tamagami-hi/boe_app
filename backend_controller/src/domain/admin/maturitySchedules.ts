import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type {
  ClientMaturityScheduleRepository,
  LockedMaturitySchedule,
  MaturityScheduleRow,
} from "../../repositories/clientMaturityScheduleRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { ClientMaturityOfferRepository } from "../../repositories/clientMaturityOfferRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { isMaturityDate } from "./maturityDueWindow.js"
import { closeOpenOfferIfAny } from "./maturityOfferRecords.js"
import { requireRecordableClient } from "./recordContribution.js"

export interface MaturityScheduleDeps {
  readonly maturityScheduleRepository: ClientMaturityScheduleRepository
  readonly maturityOfferRepository: ClientMaturityOfferRepository
  readonly clientGrowthRepository: ClientGrowthRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

interface Actor {
  readonly actorUserId: string
  readonly requestId: string
}

export interface SetMaturityDateCommand extends Actor {
  readonly userId: string
  readonly fundId: string
  readonly maturityDate: string
}

export interface OwnScheduleCommand extends Actor {
  readonly userId: string
  readonly scheduleId: string
  readonly expectedVersion: number
}

export interface EditMaturityDateCommand extends OwnScheduleCommand {
  readonly maturityDate: string
}

const ENTITY_TYPE = "client_maturity_schedule"
const STALE_MESSAGE = "Someone changed this maturity since you opened it. Reload it and try again."
const CLOSED_MESSAGE = "This maturity is already resolved or cancelled."
const OPEN_EXISTS_MESSAGE = "This holding already has a maturity date. Edit that date instead."

export const assertMaturityDate = (maturityDate: string): void => {
  if (!isMaturityDate(maturityDate)) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { maturityDate: ["must be a calendar date from 2000-01-01 to 2199-12-31"] },
    })
  }
}

export const loadMaturitySchedule = async (
  tx: Transaction,
  deps: Pick<MaturityScheduleDeps, "maturityScheduleRepository">,
  userId: string,
  scheduleId: string,
): Promise<MaturityScheduleRow> => {
  const row = await deps.maturityScheduleRepository.findForUser(tx, { userId, scheduleId })
  if (row === null) throw new AppError("INTERNAL_ERROR")
  return row
}

export const lockOpenMaturitySchedule = async (
  tx: Transaction,
  deps: Pick<MaturityScheduleDeps, "maturityScheduleRepository" | "clientGrowthRepository">,
  command: Pick<OwnScheduleCommand, "userId" | "scheduleId" | "expectedVersion">,
): Promise<LockedMaturitySchedule> => {
  const owner = await deps.maturityScheduleRepository.findOwner(tx, command.scheduleId)
  if (owner === null || owner.userId !== command.userId) throw new AppError("RESOURCE_NOT_FOUND")
  await deps.clientGrowthRepository.lockPosition(tx, owner.userId, owner.fundId)
  const schedule = await deps.maturityScheduleRepository.lockById(tx, command.scheduleId)
  if (schedule === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (schedule.state !== "scheduled") throw new AppError("STATE_CONFLICT", { message: CLOSED_MESSAGE })
  if (Number(schedule.version) !== command.expectedVersion) {
    throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  }
  return schedule
}

export const refuseStaleMaturityChange = (changed: boolean): void => {
  if (!changed) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
}

const closeOpenOffer = async (tx: Transaction, deps: MaturityScheduleDeps, scheduleId: string, actor: Actor): Promise<void> =>
  closeOpenOfferIfAny(tx, deps, await deps.maturityOfferRepository.lockOpenForSchedule(tx, scheduleId), {
    state: "closed",
    actorUserId: actor.actorUserId,
    requestId: actor.requestId,
  })

export const setMaturityDate = async (
  tx: Transaction,
  deps: MaturityScheduleDeps,
  command: SetMaturityDateCommand,
): Promise<MaturityScheduleRow> => {
  assertMaturityDate(command.maturityDate)
  await deps.clientGrowthRepository.lockPosition(tx, command.userId, command.fundId)
  await requireRecordableClient(tx, deps, command.userId as UserId)
  const basis = await deps.clientGrowthRepository.findPositionBasis(tx, command.userId, command.fundId)
  if (basis === null) {
    throw new AppError("VALIDATION_FAILED", { fields: { fundId: ["is not held by this client"] } })
  }
  if (await deps.maturityScheduleRepository.hasOpen(tx, command)) {
    throw new AppError("STATE_CONFLICT", { message: OPEN_EXISTS_MESSAGE })
  }

  const inserted = await deps.maturityScheduleRepository.insert(tx, command)
  const row = await loadMaturitySchedule(tx, deps, command.userId, inserted.id)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_maturity_schedule.created",
    entityType: ENTITY_TYPE,
    entityId: row.id,
    toState: row.state,
    requestId: command.requestId,
    entityVersion: Number(row.version),
    metadata: { userId: row.userId, fundId: row.fundId, maturityDate: row.maturityDate },
  })
  return row
}

export const editMaturityDate = async (
  tx: Transaction,
  deps: MaturityScheduleDeps,
  command: EditMaturityDateCommand,
): Promise<MaturityScheduleRow> => {
  assertMaturityDate(command.maturityDate)
  const current = await lockOpenMaturitySchedule(tx, deps, command)
  if (current.maturityDate === command.maturityDate) {
    throw new AppError("VALIDATION_FAILED", { fields: { maturityDate: ["is unchanged"] } })
  }
  await closeOpenOffer(tx, deps, current.id, command)
  refuseStaleMaturityChange(
    await deps.maturityScheduleRepository.changeDate(tx, {
      scheduleId: current.id,
      expectedVersion: current.version,
      maturityDate: command.maturityDate,
      actorUserId: command.actorUserId,
      now: deps.clock(),
    }),
  )
  const row = await loadMaturitySchedule(tx, deps, command.userId, current.id)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_maturity_schedule.updated",
    entityType: ENTITY_TYPE,
    entityId: row.id,
    fromState: current.state,
    toState: row.state,
    requestId: command.requestId,
    entityVersion: Number(row.version),
    metadata: {
      userId: row.userId,
      fundId: row.fundId,
      previousMaturityDate: current.maturityDate,
      maturityDate: row.maturityDate,
    },
  })
  return row
}

export const cancelMaturitySchedule = async (
  tx: Transaction,
  deps: MaturityScheduleDeps,
  command: OwnScheduleCommand,
): Promise<MaturityScheduleRow> => {
  const current = await lockOpenMaturitySchedule(tx, deps, command)
  await closeOpenOffer(tx, deps, current.id, command)
  refuseStaleMaturityChange(
    await deps.maturityScheduleRepository.cancel(tx, {
      scheduleId: current.id,
      expectedVersion: current.version,
      actorUserId: command.actorUserId,
      now: deps.clock(),
    }),
  )
  const row = await loadMaturitySchedule(tx, deps, command.userId, current.id)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_maturity_schedule.cancelled",
    entityType: ENTITY_TYPE,
    entityId: row.id,
    fromState: current.state,
    toState: row.state,
    requestId: command.requestId,
    entityVersion: Number(row.version),
    metadata: { userId: row.userId, fundId: row.fundId, maturityDate: row.maturityDate },
  })
  return row
}
