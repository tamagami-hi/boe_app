/**
 * settleRedemption command — the payout half of Option B's redemption flow.
 *
 * Requesting a redemption records intent; settling one moves money. An
 * administrator approves the request and this command, in one transaction:
 *
 *   - re-derives the investor's position from their ledger (the value may have
 *     moved since the request — an allocated gain or loss, or another payout);
 *   - refuses to pay out more than they currently hold;
 *   - re-splits the amount into returns-first and principal components against
 *     *today's* position rather than trusting the figures quoted at request time;
 *   - appends one `redemption` ledger entry (value falls by the full payout,
 *     invested principal falls only by the principal component); and
 *   - marks the request settled with the amount actually paid.
 *
 * The partial unique index on `investor_ledger_entries.redemption_request_id`
 * makes a replayed settlement a database error rather than a double payout.
 */
import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { InvestorLedgerRepository } from "../../repositories/investorLedgerRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type {
  RedemptionRequestRow,
  RedemptionWriteRepository,
} from "../../repositories/redemptionRepository.js"
import { derivePortfolio } from "./portfolioLedger.js"
import { toLedgerEntries } from "./portfolioProjection.js"

export interface SettleRedemptionDeps {
  readonly redemptionRepository: RedemptionWriteRepository
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface SettleRedemptionInput {
  readonly redemptionRequestId: string
  readonly settledByUserId: string
  readonly reasonCode: string
  readonly requestId: string
}

export interface SettleRedemptionResult {
  readonly request: RedemptionRequestRow
  readonly settledAmountPaise: bigint
  readonly principalComponentPaise: bigint
  readonly returnsComponentPaise: bigint
  readonly currentValuePaise: bigint
}

/** States a request may still be settled from. */
const SETTLEABLE = new Set(["submitted", "units_reserved", "approved", "settlement_pending"])

export const settleRedemption = async (
  tx: Transaction,
  deps: SettleRedemptionDeps,
  input: SettleRedemptionInput,
): Promise<SettleRedemptionResult> => {
  const existing = await deps.redemptionRepository.lockById(tx, input.redemptionRequestId)
  if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (!SETTLEABLE.has(existing.state)) throw new AppError("STATE_CONFLICT")
  // Unit-era requests carry no money amount; they are historical and not payable
  // through this path.
  if (existing.requestedAmountPaise === null) throw new AppError("STATE_CONFLICT")

  const requested = BigInt(existing.requestedAmountPaise)
  const entries = await deps.investorLedgerRepository.listByUserAndFund(
    tx,
    existing.userId,
    existing.fundId,
  )
  const summary = derivePortfolio(toLedgerEntries(entries))

  // The position can have moved since the request was made.
  if (requested > summary.currentValuePaise) throw new AppError("STATE_CONFLICT")

  // Re-split against today's position: returns are paid out before principal.
  const gains = summary.totalReturnPaise > 0n ? summary.totalReturnPaise : 0n
  const returnsComponentPaise = requested < gains ? requested : gains
  const principalComponentPaise = requested - returnsComponentPaise

  await deps.investorLedgerRepository.append(tx, {
    userId: existing.userId,
    fundId: existing.fundId,
    entryType: "redemption",
    // Value falls by the whole payout; invested principal only by its share.
    principalDeltaPaise: (-principalComponentPaise).toString(),
    valueDeltaPaise: (-requested).toString(),
    amountPaise: requested.toString(),
    effectiveDate: deps.clock().toISOString().slice(0, 10),
    redemptionRequestId: existing.id,
    reasonCode: input.reasonCode,
    requestId: input.requestId,
    metadata: {
      mode: existing.mode,
      principalComponentPaise: principalComponentPaise.toString(),
      returnsComponentPaise: returnsComponentPaise.toString(),
    },
  })

  const settled = await deps.redemptionRepository.markSettled(tx, {
    id: existing.id,
    settledAmountPaise: requested.toString(),
    now: deps.clock(),
  })

  const after = summary.currentValuePaise - requested

  await deps.notificationRepository.create(tx, {
    userId: existing.userId,
    kind: "redemption_settled",
    title: "Redemption settled",
    body: `₹${(Number(requested) / 100).toLocaleString("en-IN")} has been redeemed from your investment.`,
    payload: {
      redemptionRequestId: existing.id,
      fundId: existing.fundId,
      settledAmountPaise: requested.toString(),
      currentValuePaise: after.toString(),
    },
  })

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.settledByUserId,
    command: "redemption.settled",
    entityType: "redemption_request",
    entityId: existing.id,
    fromState: existing.state,
    toState: settled.state,
    requestId: input.requestId,
    entityVersion: Number(settled.version),
    metadata: {
      userId: existing.userId,
      fundId: existing.fundId,
      settledAmountPaise: requested.toString(),
      principalComponentPaise: principalComponentPaise.toString(),
      returnsComponentPaise: returnsComponentPaise.toString(),
      currentValuePaise: after.toString(),
    },
  })

  return {
    request: settled,
    settledAmountPaise: requested,
    principalComponentPaise,
    returnsComponentPaise,
    currentValuePaise: after,
  }
}
