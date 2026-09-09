import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { MaturityRepository, SettlementEntryInput } from "../../repositories/maturityRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"

export { updateWithdrawalPayout } from "./withdrawalPayout.js"

export interface MaturitySettlementDeps {
  readonly clientGrowthRepository: ClientGrowthRepository
  readonly maturityRepository: MaturityRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly clock: () => Date
}

interface PositionCommand {
  readonly userId: string
  readonly fundId: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface MarkPositionMaturedInput extends PositionCommand {
  readonly maturedOn: string
}

export interface SettleMaturedPositionInput extends PositionCommand {
  readonly maturityId: string
  readonly effectiveDate: string
}

export interface WithdrawMaturedPositionInput extends SettleMaturedPositionInput {
  readonly amountPaise: bigint
}

interface PositionAmounts {
  readonly principalPaise: bigint
  readonly currentValuePaise: bigint
}

export interface MaturitySettlementResult extends PositionAmounts {
  readonly entryId: string
  readonly payoutId: string | null
  readonly principalDeltaPaise: bigint
  readonly valueDeltaPaise: bigint
}

const MAX_PAISE = 9_223_372_036_854_775_807n

const assertDate = (date: string, now: Date): void => {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date || date > now.toISOString().slice(0, 10)) {
    throw new AppError("VALIDATION_FAILED", { message: "Use a valid calendar date that is not in the future." })
  }
}

const loadPosition = async (
  tx: Transaction, deps: MaturitySettlementDeps, input: PositionCommand, effectiveDate: string,
): Promise<PositionAmounts> => {
  assertDate(effectiveDate, deps.clock())
  await deps.clientGrowthRepository.lockPosition(tx, input.userId, input.fundId)
  const basis = await deps.clientGrowthRepository.findPositionBasis(tx, input.userId, input.fundId)
  if (basis === null) throw new AppError("RESOURCE_NOT_FOUND")
  const principalPaise = BigInt(basis.principalPaise)
  const currentValuePaise = BigInt(basis.currentValuePaise)
  if (principalPaise < 0n || currentValuePaise < 0n || principalPaise > MAX_PAISE ||
      currentValuePaise > MAX_PAISE || principalPaise + currentValuePaise === 0n) {
    throw new AppError("STATE_CONFLICT", { message: "This position has no settleable balance." })
  }
  const latestDate = await deps.maturityRepository.getPositionEffectiveDate(tx, input.userId, input.fundId)
  if (latestDate !== null && effectiveDate < latestDate) {
    throw new AppError("STATE_CONFLICT", { message: "The date must not precede the latest position entry." })
  }
  return { principalPaise, currentValuePaise }
}

export const markPositionMatured = async (
  tx: Transaction, deps: MaturitySettlementDeps, input: MarkPositionMaturedInput,
): Promise<{ readonly maturityId: string }> => {
  const basis = await loadPosition(tx, deps, input, input.maturedOn)
  const open = await deps.maturityRepository.lockOpenMaturity(tx, input)
  if (open !== null) throw new AppError("STATE_CONFLICT", { message: "This position already has an open maturity." })
  const maturity = await deps.maturityRepository.markMatured(tx, {
    ...input,
    principalAtMaturityPaise: basis.principalPaise,
    valueAtMaturityPaise: basis.currentValuePaise,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin", actorUserId: input.actorUserId,
    command: "client_position.matured", entityType: "client_position_maturity",
    entityId: maturity.id, toState: "pending", requestId: input.requestId, entityVersion: 1,
    metadata: { userId: input.userId, fundId: input.fundId, maturedOn: input.maturedOn,
      principalPaise: basis.principalPaise.toString(), currentValuePaise: basis.currentValuePaise.toString(),
      reasonCode: input.reasonCode },
  })
  return { maturityId: maturity.id }
}

const loadOpenMaturity = async (
  tx: Transaction, deps: MaturitySettlementDeps, input: SettleMaturedPositionInput,
): Promise<PositionAmounts> => {
  const basis = await loadPosition(tx, deps, input, input.effectiveDate)
  const maturity = await deps.maturityRepository.lockMaturityById(tx, input)
  if (maturity === null || maturity.userId !== input.userId || maturity.fundId !== input.fundId) {
    throw new AppError("RESOURCE_NOT_FOUND")
  }
  if (maturity.state !== "pending") {
    throw new AppError("STATE_CONFLICT", { message: "This maturity has already been settled." })
  }
  if (input.effectiveDate < maturity.maturedOn) {
    throw new AppError("VALIDATION_FAILED", { message: "Settlement cannot precede maturity." })
  }
  return basis
}

const recordSettlement = async (
  tx: Transaction, deps: MaturitySettlementDeps, input: SettleMaturedPositionInput,
  entry: SettlementEntryInput, result: MaturitySettlementResult,
): Promise<MaturitySettlementResult> => {
  const settlement = entry.entryType === "withdrawal" ? "withdrawal" : "reinvestment"
  await deps.maturityRepository.settleMaturity(tx, {
    maturityId: input.maturityId, settlement, settlementEntryId: result.entryId, now: deps.clock(),
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin", actorUserId: input.actorUserId, command: `client_position.${settlement}`,
    entityType: "client_position_maturity", entityId: input.maturityId,
    fromState: "pending", toState: "settled", requestId: input.requestId, entityVersion: 2,
    metadata: { userId: input.userId, fundId: input.fundId, entryId: result.entryId,
      payoutId: result.payoutId, principalDeltaPaise: entry.principalDeltaPaise.toString(),
      valueDeltaPaise: entry.valueDeltaPaise.toString(), effectiveDate: input.effectiveDate,
      reasonCode: input.reasonCode, propagatedToAum: false },
  })
  await deps.notificationRepository.create(tx, {
    userId: input.userId, kind: "client_value_updated",
    title: settlement === "withdrawal" ? "Withdrawal recorded" : "Investment reinvested",
    body: settlement === "withdrawal"
      ? "A withdrawal has been deducted from your portfolio and is awaiting payout. Contact support for transfer details."
      : "Your matured investment has been reinvested. Open your portfolio to see the updated principal.",
    payload: { fundId: input.fundId, maturityId: input.maturityId },
  })
  return result
}

export const withdrawMaturedPosition = async (
  tx: Transaction, deps: MaturitySettlementDeps, input: WithdrawMaturedPositionInput,
): Promise<MaturitySettlementResult> => {
  if (input.amountPaise <= 0n || input.amountPaise > MAX_PAISE) {
    throw new AppError("VALIDATION_FAILED", { message: "Withdrawal amount must be positive and within the supported range." })
  }
  const basis = await loadOpenMaturity(tx, deps, input)
  if (input.amountPaise > basis.currentValuePaise) {
    throw new AppError("VALIDATION_FAILED", { message: "Withdrawal exceeds the current position value." })
  }
  const gain = basis.currentValuePaise > basis.principalPaise ? basis.currentValuePaise - basis.principalPaise : 0n
  const growthPortionPaise = input.amountPaise < gain ? input.amountPaise : gain
  const principalPortionPaise = input.amountPaise - growthPortionPaise
  const entry: SettlementEntryInput = { ...input, entryType: "withdrawal",
    principalDeltaPaise: -principalPortionPaise, valueDeltaPaise: -input.amountPaise }
  const inserted = await deps.maturityRepository.insertSettlementEntry(tx, entry)
  const payout = await deps.maturityRepository.insertWithdrawalPayout(tx, {
    ...input, ledgerEntryId: inserted.id, growthPortionPaise, principalPortionPaise,
  })
  return recordSettlement(tx, deps, input, entry, {
    entryId: inserted.id, payoutId: payout.id,
    principalDeltaPaise: entry.principalDeltaPaise, valueDeltaPaise: entry.valueDeltaPaise,
    principalPaise: basis.principalPaise - principalPortionPaise,
    currentValuePaise: basis.currentValuePaise - input.amountPaise,
  })
}

export const reinvestMaturedPosition = async (
  tx: Transaction, deps: MaturitySettlementDeps, input: SettleMaturedPositionInput,
): Promise<MaturitySettlementResult> => {
  const basis = await loadOpenMaturity(tx, deps, input)
  const principalDeltaPaise = basis.currentValuePaise - basis.principalPaise
  if (principalDeltaPaise === 0n) {
    throw new AppError("STATE_CONFLICT", { message: "Principal already equals current value; there is nothing to reinvest." })
  }
  const entry: SettlementEntryInput = { ...input, entryType: "maturity_reinvestment",
    principalDeltaPaise, valueDeltaPaise: 0n }
  const inserted = await deps.maturityRepository.insertSettlementEntry(tx, entry)
  return recordSettlement(tx, deps, input, entry, {
    entryId: inserted.id, payoutId: null, principalDeltaPaise, valueDeltaPaise: 0n,
    principalPaise: basis.currentValuePaise, currentValuePaise: basis.currentValuePaise,
  })
}
