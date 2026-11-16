import type { Transaction, User, UserId } from "../../db/repositories.js"
import { formatCalendarDate, formatRupeesFromPaise } from "../../email/emailMoney.js"
import { AppError } from "../../http/errorCatalog.js"
import type { LockedSipSchedule } from "../../repositories/adminSipScheduleRepository.js"
import type { MaturityScheduleRow } from "../../repositories/clientMaturityScheduleRepository.js"
import type { SipEarlyExitRepository, SipEarlyExitRow } from "../../repositories/earlyExitRepository.js"
import { queueSipEarlyExitMail, type SipEarlyExitMailDeps } from "../email/earlyExitMail.js"
import { indiaCalendarDate } from "../shared/calendarDate.js"
import { closeAdminSipSchedule, type AdminSipScheduleDeps } from "./adminSipSchedules.js"
import type { MaturitySettlementDeps } from "./maturitySettlement.js"
import { cancelMaturitySchedule, type MaturityScheduleDeps } from "./maturitySchedules.js"
import { refuseSipEarlyExit, VALUE_CHANGED_MESSAGE, type SipEarlyExitFacts } from "./earlyExitRules.js"
import { recordWithdrawalWithPayout, type WithdrawalPosition } from "./withdrawalEntry.js"

export type SipEarlyExitDeps = AdminSipScheduleDeps &
  MaturitySettlementDeps &
  MaturityScheduleDeps &
  SipEarlyExitMailDeps &
  Readonly<{ sipEarlyExitRepository: SipEarlyExitRepository }>

export interface SipEarlyExitCommand {
  readonly userId: string
  readonly scheduleId: string
  readonly expectedVersion: number
  readonly expectedValuePaise: bigint
  readonly actorUserId: string
  readonly requestId: string
}

export interface SipEarlyExitHolding {
  readonly position: WithdrawalPosition
  readonly maturity: MaturityScheduleRow | null
  readonly facts: SipEarlyExitFacts
}

export const SIP_EARLY_EXIT_REASON = "sip_early_exit"
const STALE_MESSAGE = "Someone changed this SIP schedule since you opened it. Reload it and try again."

const openMaturityOf = async (
  tx: Transaction,
  deps: SipEarlyExitDeps,
  schedule: Pick<LockedSipSchedule, "userId" | "fundId">,
): Promise<MaturityScheduleRow | null> =>
  (await deps.maturityScheduleRepository.listByUser(tx, schedule.userId)).find(
    (row) => row.fundId === schedule.fundId && row.state === "scheduled",
  ) ?? null

export const readSipEarlyExitHolding = async (
  tx: Transaction,
  deps: SipEarlyExitDeps,
  schedule: Pick<LockedSipSchedule, "userId" | "fundId" | "state">,
): Promise<SipEarlyExitHolding> => {
  const basis = await deps.clientGrowthRepository.findPositionBasis(tx, schedule.userId, schedule.fundId)
  const position = {
    principalPaise: basis === null ? 0n : BigInt(basis.principalPaise),
    currentValuePaise: basis === null ? 0n : BigInt(basis.currentValuePaise),
  }
  const maturity = await openMaturityOf(tx, deps, schedule)
  const offer = maturity === null ? null : await deps.maturityOfferRepository.lockOpenForSchedule(tx, maturity.id)
  const marked = await deps.maturityRepository.lockOpenMaturity(tx, schedule)
  return {
    position,
    maturity,
    facts: {
      scheduleState: schedule.state,
      currentValuePaise: position.currentValuePaise,
      hasMarkedMaturity: marked !== null,
      openMaturity:
        maturity === null ? null : { maturityDate: maturity.maturityDate, hasClientChoice: (offer?.chosenOption ?? null) !== null },
      latestEntryDate: await deps.maturityRepository.getPositionEffectiveDate(tx, schedule.userId, schedule.fundId),
      today: indiaCalendarDate(deps.clock()),
    },
  }
}

const lockSchedule = async (
  tx: Transaction,
  deps: SipEarlyExitDeps,
  command: SipEarlyExitCommand,
): Promise<Readonly<{ client: User; schedule: LockedSipSchedule }>> => {
  const owner = await deps.sipScheduleRepository.findOwner(tx, command.scheduleId)
  if (owner === null || owner.userId !== command.userId) throw new AppError("RESOURCE_NOT_FOUND")
  await deps.clientGrowthRepository.lockPosition(tx, owner.userId, owner.fundId)
  const client = await deps.userRepository.lockById(tx, command.userId as UserId)
  if (client === null) throw new AppError("RESOURCE_NOT_FOUND")
  const schedule = await deps.sipScheduleRepository.lockById(tx, command.scheduleId)
  if (schedule === null || schedule.userId !== command.userId) throw new AppError("RESOURCE_NOT_FOUND")
  if (Number(schedule.version) !== command.expectedVersion) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  return { client, schedule }
}

const loadEarlyExit = async (tx: Transaction, deps: SipEarlyExitDeps, userId: string, earlyExitId: string): Promise<SipEarlyExitRow> => {
  const row = await deps.sipEarlyExitRepository.findForUser(tx, { userId, earlyExitId })
  if (row === null) throw new AppError("INTERNAL_ERROR")
  return row
}

const auditEarlyExit = (
  tx: Transaction,
  deps: SipEarlyExitDeps,
  row: SipEarlyExitRow,
  command: SipEarlyExitCommand,
): Promise<unknown> =>
  deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "admin_sip_schedule.early_exit",
    entityType: "sip_early_exit",
    entityId: row.id,
    toState: "recorded",
    requestId: command.requestId,
    entityVersion: 1,
    metadata: {
      userId: row.userId,
      fundId: row.fundId,
      scheduleId: row.scheduleId,
      entryId: row.ledgerEntryId,
      payoutId: row.payoutId,
      amountPaise: row.amountPaise,
      principalBeforePaise: row.principalBeforePaise,
      valueBeforePaise: row.valueBeforePaise,
      principalPortionPaise: row.payoutPrincipalPortionPaise,
      growthPortionPaise: row.payoutGrowthPortionPaise,
      cancelledMaturityScheduleId: row.cancelledMaturityScheduleId,
      effectiveDate: row.effectiveDate,
      propagatedToAum: false,
    },
  })

const tellClient = async (
  tx: Transaction,
  deps: SipEarlyExitDeps,
  client: User,
  row: SipEarlyExitRow,
  requestId: string,
): Promise<void> => {
  await deps.notificationRepository.create(tx, {
    userId: client.id,
    kind: "client_value_updated",
    title: "SIP closed early",
    body: `Your SIP in ${row.fundName} was closed early on ${formatCalendarDate(row.effectiveDate)}. ${formatRupeesFromPaise(row.amountPaise)}, the full current value, is being returned to you. The payout is awaited.`,
    payload: { fundId: row.fundId, scheduleId: row.scheduleId, earlyExitId: row.id, deepLink: "/activity" },
  })
  await queueSipEarlyExitMail(tx, deps, {
    recipient: client,
    earlyExitId: row.id,
    fundName: row.fundName,
    amountPaise: row.amountPaise,
    effectiveDate: row.effectiveDate,
    requestId,
  })
}

export const exitSipEarly = async (
  tx: Transaction,
  deps: SipEarlyExitDeps,
  command: SipEarlyExitCommand,
): Promise<SipEarlyExitRow> => {
  const { client, schedule } = await lockSchedule(tx, deps, command)
  const holding = await readSipEarlyExitHolding(tx, deps, schedule)
  refuseSipEarlyExit(holding.facts)
  if (holding.position.currentValuePaise !== command.expectedValuePaise) {
    throw new AppError("STATE_CONFLICT", { message: VALUE_CHANGED_MESSAGE })
  }
  const actor = { actorUserId: command.actorUserId, requestId: command.requestId }
  const recorded = await recordWithdrawalWithPayout(tx, deps, holding.position, {
    ...actor,
    userId: schedule.userId,
    fundId: schedule.fundId,
    maturityId: null,
    amountPaise: holding.position.currentValuePaise,
    effectiveDate: holding.facts.today,
    reasonCode: SIP_EARLY_EXIT_REASON,
    note: null,
  })
  await closeAdminSipSchedule(tx, deps, { ...actor, userId: schedule.userId, scheduleId: schedule.id, expectedVersion: command.expectedVersion })
  if (holding.maturity !== null) {
    await cancelMaturitySchedule(tx, deps, {
      ...actor,
      userId: schedule.userId,
      scheduleId: holding.maturity.id,
      expectedVersion: Number(holding.maturity.version),
    })
  }
  const inserted = await deps.sipEarlyExitRepository.insert(tx, {
    ...actor,
    scheduleId: schedule.id,
    userId: schedule.userId,
    fundId: schedule.fundId,
    ledgerEntryId: recorded.entryId,
    payoutId: recorded.payoutId,
    amountPaise: holding.position.currentValuePaise,
    principalBeforePaise: holding.position.principalPaise,
    valueBeforePaise: holding.position.currentValuePaise,
    cancelledMaturityScheduleId: holding.maturity?.id ?? null,
    effectiveDate: holding.facts.today,
  })
  const row = await loadEarlyExit(tx, deps, schedule.userId, inserted.id)
  await auditEarlyExit(tx, deps, row, command)
  await tellClient(tx, deps, client, row, command.requestId)
  return row
}
