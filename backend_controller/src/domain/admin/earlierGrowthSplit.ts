import type { Transaction, UserId } from "../../db/repositories.js"
import { formatRupeesFromPaise } from "../../email/emailMoney.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { InvestmentBreakdownRepository } from "../../repositories/investmentBreakdownRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import {
  foldFundBreakdown,
  proposeSplitByValue,
  refKey,
  type BreakdownInput,
  type InvestmentRef,
  type ProposedSplit,
} from "../client/investmentBreakdown.js"
import { requireRecordableClient } from "./recordContribution.js"

export interface EarlierGrowthSplitDeps {
  readonly investmentBreakdownRepository: InvestmentBreakdownRepository
  readonly clientGrowthRepository: Pick<ClientGrowthRepository, "lockPosition">
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
}

export interface SplitPartInput {
  readonly ref: InvestmentRef
  readonly amountPaise: bigint
}

export interface ConfirmEarlierGrowthSplitCommand {
  readonly userId: string
  readonly fundId: string
  readonly cutoffEntryId: string
  readonly parts: readonly SplitPartInput[]
  readonly actorUserId: string
  readonly requestId: string
}

export interface ConfirmedEarlierGrowthSplit {
  readonly splitId: string
  readonly fundId: string
  readonly cutoffEntryId: string
  readonly totalPaise: bigint
  readonly parts: readonly SplitPartInput[]
  readonly confirmedAt: Date
}

const UNCATEGORISED_MESSAGE = "Give every recording in this fund a category before confirming its earlier growth."
const NOTHING_TO_SPLIT_MESSAGE = "This fund has no earlier growth to split."
const STALE_MESSAGE = "Growth was recorded for this fund since you opened it. Reload and confirm the split again."

export const proposeEarlierGrowthSplit = (input: BreakdownInput, fundId: string): ProposedSplit | null =>
  proposeSplitByValue(input, fundId)

const signedRupees = (paise: bigint): string =>
  paise < 0n ? `-${formatRupeesFromPaise((-paise).toString())}` : formatRupeesFromPaise(paise.toString())

const refusePart = (index: number, message: string): AppError =>
  new AppError("VALIDATION_FAILED", { fields: { [`parts.${String(index)}`]: [message] } })

const investmentKeysOf = (input: BreakdownInput, fundId: string): ReadonlySet<string> =>
  new Set(
    foldFundBreakdown(input, fundId, "1970-01-01")
      .stakes.filter((holding) => holding.ref.kind !== "uncategorised")
      .map((holding) => refKey(holding.ref)),
  )

const validatedParts = (
  input: BreakdownInput,
  command: ConfirmEarlierGrowthSplitCommand,
  totalPaise: bigint,
): readonly SplitPartInput[] => {
  const known = investmentKeysOf(input, command.fundId)
  const seen = new Set<string>()
  command.parts.forEach((part, index) => {
    if (part.amountPaise === 0n) return
    const key = refKey(part.ref)
    if (!known.has(key)) throw refusePart(index, "is not an investment of this client in this fund")
    if (seen.has(key)) throw refusePart(index, "names an investment that already has a part")
    seen.add(key)
  })
  const parts = command.parts.filter((part) => part.amountPaise !== 0n)
  if (totalPaise === 0n && parts.length > 0) {
    throw new AppError("VALIDATION_FAILED", { fields: { parts: ["must be empty, because the fund's earlier growth nets to zero"] } })
  }
  const sum = parts.reduce((total, part) => total + part.amountPaise, 0n)
  if (sum !== totalPaise) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { parts: [`must add up to ${signedRupees(totalPaise)}, the fund's earlier growth`] },
    })
  }
  return parts
}

export const confirmEarlierGrowthSplit = async (
  tx: Transaction,
  deps: EarlierGrowthSplitDeps,
  command: ConfirmEarlierGrowthSplitCommand,
): Promise<ConfirmedEarlierGrowthSplit> => {
  await deps.clientGrowthRepository.lockPosition(tx, command.userId, command.fundId)
  await requireRecordableClient(tx, deps, command.userId as UserId)
  const input = await deps.investmentBreakdownRepository.loadBreakdownInput(tx, command.userId)
  if (!input.entries.some((entry) => entry.fundId === command.fundId)) throw new AppError("RESOURCE_NOT_FOUND")
  if (foldFundBreakdown(input, command.fundId, "1970-01-01").uncategorisedEntryIds.length > 0) {
    throw new AppError("STATE_CONFLICT", { message: UNCATEGORISED_MESSAGE })
  }
  const proposal = proposeEarlierGrowthSplit(input, command.fundId)
  if (proposal === null) throw new AppError("STATE_CONFLICT", { message: NOTHING_TO_SPLIT_MESSAGE })
  if (proposal.cutoffEntryId !== command.cutoffEntryId) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  const parts = validatedParts(input, command, proposal.totalPaise)

  const stored = await deps.investmentBreakdownRepository.insertSplit(tx, {
    userId: command.userId,
    fundId: command.fundId,
    cutoffEntryId: proposal.cutoffEntryId,
    totalPaise: proposal.totalPaise,
    coveredEntryIds: proposal.coveredEntryIds,
    parts,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_earlier_growth_split.confirmed",
    entityType: "client_earlier_growth_split",
    entityId: stored.id,
    toState: "confirmed",
    requestId: command.requestId,
    entityVersion: 1,
    metadata: {
      userId: command.userId,
      fundId: command.fundId,
      cutoffEntryId: proposal.cutoffEntryId,
      totalPaise: proposal.totalPaise.toString(),
      coveredEntryCount: proposal.coveredEntryIds.length,
      parts: parts.map((part) => ({ ref: refKey(part.ref), amountPaise: part.amountPaise.toString() })),
    },
  })
  return {
    splitId: stored.id,
    fundId: command.fundId,
    cutoffEntryId: proposal.cutoffEntryId,
    totalPaise: proposal.totalPaise,
    parts,
    confirmedAt: stored.createdAt,
  }
}
