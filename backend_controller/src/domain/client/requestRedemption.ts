/**
 * requestRedemption command — Option B module "Redemption".
 *
 * The investor redeems an **amount**, not a quantity of units, in one of four
 * modes: the full available value, returns only, half, or a custom amount. The
 * amount is split into its principal and returns components (gains first), so
 * settling it later reduces Total Investment only by the principal part.
 *
 * This records a *request*: it does not move the investor's value. Value falls
 * when an administrator approves the request and the payout is recorded on the
 * ledger, which keeps requested and settled money distinguishable.
 */
import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { InvestorLedgerRepository } from "../../repositories/investorLedgerRepository.js"
import type {
  RedemptionRequestRow,
  RedemptionWriteRepository,
} from "../../repositories/redemptionRepository.js"
import type { RedemptionMode } from "../../db/types.js"
import { derivePortfolio, quoteRedemption } from "./portfolioLedger.js"
import { toLedgerEntries } from "./portfolioProjection.js"

export interface RequestRedemptionDeps {
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly redemptionRepository: RedemptionWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface RequestRedemptionInput {
  readonly userId: string
  readonly fundId: string
  readonly mode: RedemptionMode
  /** Required for `custom`, ignored otherwise. */
  readonly customAmountPaise?: bigint
  readonly requestId: string
}

export interface RequestRedemptionResult {
  readonly request: RedemptionRequestRow
  readonly availableValuePaise: bigint
}

export const requestRedemption = async (
  tx: Transaction,
  deps: RequestRedemptionDeps,
  input: RequestRedemptionInput,
): Promise<RequestRedemptionResult> => {
  const entries = await deps.investorLedgerRepository.listByUserAndFund(tx, input.userId, input.fundId)
  if (entries.length === 0) throw new AppError("STATE_CONFLICT")

  const summary = derivePortfolio(toLedgerEntries(entries))

  // One open request at a time per pool: two concurrent redemptions could each
  // pass the available-value check and together exceed it.
  const open = await deps.redemptionRepository.findOpenByUserAndFund(tx, input.userId, input.fundId)
  if (open !== null) throw new AppError("STATE_CONFLICT")

  let quote
  try {
    quote = quoteRedemption(summary, input.mode, input.customAmountPaise)
  } catch (error) {
    // The engine's refusals are all caller errors: too much, nothing to redeem,
    // or a custom mode without an amount.
    throw new AppError("VALIDATION_FAILED", {
      fields: { amount: [error instanceof Error ? error.message : "invalid redemption"] },
    })
  }

  // Redemptions are recorded against the active finance policy version.
  const financePolicyVersion = await deps.redemptionRepository.activePolicyVersion(tx)
  if (financePolicyVersion === null) throw new AppError("DEPENDENCY_UNAVAILABLE")

  const now = deps.clock()
  const request = await deps.redemptionRepository.create(tx, {
    userId: input.userId,
    fundId: input.fundId,
    mode: quote.mode,
    requestedAmountPaise: quote.amountPaise.toString(),
    principalComponentPaise: quote.principalComponentPaise.toString(),
    returnsComponentPaise: quote.returnsComponentPaise.toString(),
    financePolicyVersion,
    now,
  })

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "redemption.requested",
    entityType: "redemption_request",
    entityId: request.id,
    toState: request.state,
    requestId: input.requestId,
    entityVersion: Number(request.version),
    metadata: {
      fundId: input.fundId,
      mode: quote.mode,
      requestedAmountPaise: quote.amountPaise.toString(),
      principalComponentPaise: quote.principalComponentPaise.toString(),
      returnsComponentPaise: quote.returnsComponentPaise.toString(),
    },
  })

  return { request, availableValuePaise: summary.currentValuePaise }
}
