import type { Transaction } from "../../db/repositories.js"
import type { MaturityRepository, SettlementEntryInput } from "../../repositories/maturityRepository.js"

export interface WithdrawalPosition {
  readonly principalPaise: bigint
  readonly currentValuePaise: bigint
}

export interface WithdrawalEntryInput {
  readonly userId: string
  readonly fundId: string
  readonly maturityId: string | null
  readonly amountPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface WithdrawalPortions {
  readonly growthPortionPaise: bigint
  readonly principalPortionPaise: bigint
}

export interface RecordedWithdrawal extends WithdrawalPortions {
  readonly entry: SettlementEntryInput
  readonly entryId: string
  readonly payoutId: string
}

export type WithdrawalEntryDeps = Readonly<{
  maturityRepository: Pick<MaturityRepository, "insertSettlementEntry" | "insertWithdrawalPayout">
}>

export const withdrawalPortions = (position: WithdrawalPosition, amountPaise: bigint): WithdrawalPortions => {
  const gain = position.currentValuePaise > position.principalPaise ? position.currentValuePaise - position.principalPaise : 0n
  const growthPortionPaise = amountPaise < gain ? amountPaise : gain
  return { growthPortionPaise, principalPortionPaise: amountPaise - growthPortionPaise }
}

export const recordWithdrawalWithPayout = async (
  tx: Transaction,
  deps: WithdrawalEntryDeps,
  position: WithdrawalPosition,
  input: WithdrawalEntryInput,
): Promise<RecordedWithdrawal> => {
  const portions = withdrawalPortions(position, input.amountPaise)
  const entry: SettlementEntryInput = {
    userId: input.userId,
    fundId: input.fundId,
    entryType: "withdrawal",
    principalDeltaPaise: -portions.principalPortionPaise,
    valueDeltaPaise: -input.amountPaise,
    effectiveDate: input.effectiveDate,
    reasonCode: input.reasonCode,
    note: input.note,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  }
  const inserted = await deps.maturityRepository.insertSettlementEntry(tx, entry)
  const payout = await deps.maturityRepository.insertWithdrawalPayout(tx, {
    userId: input.userId,
    fundId: input.fundId,
    maturityId: input.maturityId,
    ledgerEntryId: inserted.id,
    amountPaise: input.amountPaise,
    growthPortionPaise: portions.growthPortionPaise,
    principalPortionPaise: portions.principalPortionPaise,
    effectiveDate: input.effectiveDate,
    reasonCode: input.reasonCode,
    note: input.note,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  })
  return { ...portions, entry, entryId: inserted.id, payoutId: payout.id }
}
