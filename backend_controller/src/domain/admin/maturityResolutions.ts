import type { Transaction, UserId } from "../../db/repositories.js"
import type { ClientMaturityResolution } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { LockedMaturitySchedule, MaturityScheduleRow } from "../../repositories/clientMaturityScheduleRepository.js"
import { indiaCalendarDate } from "../shared/calendarDate.js"
import { closeAdminSipSchedule, createAdminSipSchedule, type AdminSipScheduleDeps } from "./adminSipSchedules.js"
import { extendActiveSip, scheduleNextMaturity, type SipExtension } from "./maturityExtension.js"
import { closeOpenOfferIfAny } from "./maturityOfferRecords.js"
import {
  markPositionMatured,
  reinvestMaturedPosition,
  withdrawMaturedPosition,
  type MaturitySettlementDeps,
} from "./maturitySettlement.js"
import {
  loadMaturitySchedule,
  lockOpenMaturitySchedule,
  refuseStaleMaturityChange,
  type MaturityScheduleDeps,
  type OwnScheduleCommand,
} from "./maturitySchedules.js"
import { requireRecordableClient } from "./recordContribution.js"
import { indiaCurrentMonth, monthIndexOf } from "./sipScheduleMonths.js"

export type MaturityResolutionDeps = MaturityScheduleDeps & MaturitySettlementDeps & AdminSipScheduleDeps

export interface FollowUpSchedule {
  readonly monthlyAmountPaise: bigint
  readonly startMonth: string
  readonly monthCount: number
}

export type ResolveMaturityCommand = OwnScheduleCommand &
  (
    | Readonly<{ resolution: "return_all"; effectiveDate: string; amountPaise: bigint }>
    | Readonly<{
        resolution: "one_time_and_sip"
        effectiveDate: string
        expectedPrincipalPaise: bigint
        expectedCurrentValuePaise: bigint
        sip: FollowUpSchedule
      }>
    | Readonly<{ resolution: "sip_extension"; extension: SipExtension }>
  )

export interface MaturityResolutionOutcome {
  readonly schedule: MaturityScheduleRow
  readonly settlementEntryId: string | null
  readonly payoutId: string | null
  readonly closedSipScheduleId: string | null
  readonly nextScheduleId: string | null
}

interface ResolutionEffects {
  readonly maturityId: string | null
  readonly settlementEntryId: string | null
  readonly payoutId: string | null
  readonly followUpSipScheduleId: string | null
  readonly closedSipScheduleId: string | null
}

const NO_SETTLEMENT = { maturityId: null, settlementEntryId: null, payoutId: null } as const
const WITHDRAWAL_REASON = "maturity_withdrawal"
const REINVESTMENT_REASON = "maturity_reinvestment"
const MATURED_REASON = "position_matured"

const CANCEL_HINT = "Cancel this maturity date instead of resolving it."

const refuseHandSettledMaturity = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
): Promise<void> => {
  const settled = await deps.maturityScheduleRepository.findSettledMaturitySince(tx, {
    userId: schedule.userId,
    fundId: schedule.fundId,
    since: schedule.createdAt,
  })
  if (settled !== null) {
    throw new AppError("STATE_CONFLICT", {
      message: `This holding was already settled in the Maturity tab on ${settled.settledOn}. ${CANCEL_HINT}`,
    })
  }
}

const refuseUnreachedMaturity = (schedule: LockedMaturitySchedule, now: Date): void => {
  if (schedule.maturityDate > indiaCalendarDate(now)) {
    throw new AppError("STATE_CONFLICT", {
      message: "This maturity date has not arrived yet. Change the date first if the client is settling early.",
    })
  }
}

const refuseEarlyEffectiveDate = (schedule: LockedMaturitySchedule, effectiveDate: string): void => {
  if (effectiveDate < schedule.maturityDate) {
    throw new AppError("VALIDATION_FAILED", { fields: { effectiveDate: ["cannot be before the maturity date"] } })
  }
}

export const refuseEarlyStartMonth = (schedule: LockedMaturitySchedule, sip: FollowUpSchedule, now: Date): void => {
  const start = monthIndexOf(sip.startMonth)
  if (start <= monthIndexOf(schedule.maturityDate.slice(0, 7))) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "sip.startMonth": ["must be the month after the maturity month or later"] },
    })
  }
  if (start < monthIndexOf(indiaCurrentMonth(now))) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "sip.startMonth": ["cannot be earlier than the current month in India"] },
    })
  }
}

const loadBasis = async (tx: Transaction, deps: MaturityResolutionDeps, schedule: LockedMaturitySchedule) => {
  const basis = await deps.clientGrowthRepository.findPositionBasis(tx, schedule.userId, schedule.fundId)
  if (basis === null) {
    throw new AppError("STATE_CONFLICT", { message: "This client no longer holds anything in this fund." })
  }
  return { principalPaise: BigInt(basis.principalPaise), currentValuePaise: BigInt(basis.currentValuePaise) }
}

const openMaturityFor = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: ResolveMaturityCommand & Readonly<{ effectiveDate: string }>,
): Promise<string> => {
  const open = await deps.maturityRepository.lockOpenMaturity(tx, schedule)
  if (open !== null) return open.id
  const marked = await markPositionMatured(tx, deps, {
    userId: schedule.userId,
    fundId: schedule.fundId,
    maturedOn: command.effectiveDate,
    reasonCode: MATURED_REASON,
    note: null,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  return marked.maturityId
}

const replaceSipSchedule = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: OwnScheduleCommand & Readonly<{ sip: FollowUpSchedule }>,
): Promise<Pick<ResolutionEffects, "followUpSipScheduleId" | "closedSipScheduleId">> => {
  const active = (await deps.sipScheduleRepository.listByUser(tx, schedule.userId)).find(
    (row) => row.fundId === schedule.fundId && row.state === "active",
  )
  const actor = { userId: schedule.userId, actorUserId: command.actorUserId, requestId: command.requestId }
  if (active !== undefined) {
    await closeAdminSipSchedule(tx, deps, { ...actor, scheduleId: active.id, expectedVersion: Number(active.version) })
  }
  const created = await createAdminSipSchedule(tx, deps, { ...actor, fundId: schedule.fundId, ...command.sip })
  return { followUpSipScheduleId: created.id, closedSipScheduleId: active?.id ?? null }
}

const returnAll = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: ResolveMaturityCommand & Readonly<{ resolution: "return_all" }>,
): Promise<ResolutionEffects> => {
  refuseEarlyEffectiveDate(schedule, command.effectiveDate)
  const basis = await loadBasis(tx, deps, schedule)
  if (basis.currentValuePaise <= 0n) {
    throw new AppError("STATE_CONFLICT", { message: `This holding has no value to return. ${CANCEL_HINT}` })
  }
  if (basis.currentValuePaise !== command.amountPaise) {
    throw new AppError("STATE_CONFLICT", {
      message: "The holding's value changed since you opened it. Reload and confirm the new amount.",
    })
  }
  const maturityId = await openMaturityFor(tx, deps, schedule, command)
  const settled = await withdrawMaturedPosition(tx, deps, {
    userId: schedule.userId,
    fundId: schedule.fundId,
    maturityId,
    effectiveDate: command.effectiveDate,
    amountPaise: basis.currentValuePaise,
    reasonCode: WITHDRAWAL_REASON,
    note: null,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  return {
    maturityId,
    settlementEntryId: settled.entryId,
    payoutId: settled.payoutId,
    followUpSipScheduleId: null,
    closedSipScheduleId: null,
  }
}

const reinvestGrowth = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: ResolveMaturityCommand & Readonly<{ effectiveDate: string }>,
): Promise<Pick<ResolutionEffects, "maturityId" | "settlementEntryId" | "payoutId">> => {
  const maturityId = await openMaturityFor(tx, deps, schedule, command)
  const settled = await reinvestMaturedPosition(tx, deps, {
    userId: schedule.userId,
    fundId: schedule.fundId,
    maturityId,
    effectiveDate: command.effectiveDate,
    reasonCode: REINVESTMENT_REASON,
    note: null,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  return { maturityId, settlementEntryId: settled.entryId, payoutId: null }
}

const oneTimeAndSip = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: ResolveMaturityCommand & Readonly<{ resolution: "one_time_and_sip" }>,
): Promise<ResolutionEffects> => {
  refuseEarlyEffectiveDate(schedule, command.effectiveDate)
  refuseEarlyStartMonth(schedule, command.sip, deps.clock())
  const basis = await loadBasis(tx, deps, schedule)
  if (basis.principalPaise !== command.expectedPrincipalPaise || basis.currentValuePaise !== command.expectedCurrentValuePaise) {
    throw new AppError("STATE_CONFLICT", {
      message: "The holding's value or amount invested changed since you opened it. Review the new figures and confirm again.",
    })
  }
  const settlement =
    basis.currentValuePaise === basis.principalPaise ? NO_SETTLEMENT : await reinvestGrowth(tx, deps, schedule, command)
  return { ...settlement, ...(await replaceSipSchedule(tx, deps, schedule, command)) }
}

const sipExtension = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: ResolveMaturityCommand & Readonly<{ resolution: "sip_extension" }>,
): Promise<ResolutionEffects> => {
  await requireRecordableClient(tx, deps, schedule.userId as UserId)
  await loadBasis(tx, deps, schedule)
  const extendedId = await extendActiveSip(tx, deps, schedule, command)
  return { ...NO_SETTLEMENT, followUpSipScheduleId: extendedId, closedSipScheduleId: null }
}

const applyResolution = (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: ResolveMaturityCommand,
): Promise<ResolutionEffects> => {
  switch (command.resolution) {
    case "return_all":
      return returnAll(tx, deps, schedule, command)
    case "one_time_and_sip":
      return oneTimeAndSip(tx, deps, schedule, command)
    case "sip_extension":
      return sipExtension(tx, deps, schedule, command)
  }
}

export const resolveLockedMaturity = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  schedule: LockedMaturitySchedule,
  command: ResolveMaturityCommand,
): Promise<MaturityResolutionOutcome> => {
  await refuseHandSettledMaturity(tx, deps, schedule)
  refuseUnreachedMaturity(schedule, deps.clock())
  const effects = await applyResolution(tx, deps, schedule, command)
  const resolution: ClientMaturityResolution = command.resolution
  refuseStaleMaturityChange(
    await deps.maturityScheduleRepository.resolve(tx, {
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      resolution,
      maturityId: effects.maturityId,
      followUpSipScheduleId: effects.followUpSipScheduleId,
      actorUserId: command.actorUserId,
      now: deps.clock(),
    }),
  )
  const nextScheduleId =
    command.resolution === "sip_extension"
      ? await scheduleNextMaturity(tx, deps, schedule, { ...command, nextMaturityDate: command.extension.nextMaturityDate })
      : null
  const row = await loadMaturitySchedule(tx, deps, command.userId, schedule.id)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_maturity_schedule.resolved",
    entityType: "client_maturity_schedule",
    entityId: row.id,
    fromState: schedule.state,
    toState: row.state,
    requestId: command.requestId,
    entityVersion: Number(row.version),
    metadata: { userId: row.userId, fundId: row.fundId, maturityDate: row.maturityDate, resolution, ...effects, nextScheduleId },
  })
  return {
    schedule: row,
    settlementEntryId: effects.settlementEntryId,
    payoutId: effects.payoutId,
    closedSipScheduleId: effects.closedSipScheduleId,
    nextScheduleId,
  }
}

export const resolveMaturity = async (
  tx: Transaction,
  deps: MaturityResolutionDeps,
  command: ResolveMaturityCommand,
): Promise<MaturityResolutionOutcome> => {
  const schedule = await lockOpenMaturitySchedule(tx, deps, command)
  const openOffer = await deps.maturityOfferRepository.lockOpenForSchedule(tx, schedule.id)
  const outcome = await resolveLockedMaturity(tx, deps, schedule, command)
  await closeOpenOfferIfAny(tx, deps, openOffer, {
    state: "closed",
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  return { ...outcome, schedule: await loadMaturitySchedule(tx, deps, command.userId, schedule.id) }
}
