/**
 * allocateGain command — Option B module 2/3, the administrator-driven growth
 * path. This is how a portfolio moves: an administrator credits (or debits) an
 * investor's value for a period, per investor, from the admin panel.
 *
 *   Current Value += allocated gain      (value delta only)
 *   Total Investment unchanged           (principal delta is always zero)
 *
 * So an allocation changes Total Return and Return %, never what the investor put
 * in. A negative allocation is a loss and is allowed, but it may not drive the
 * investor's current value below zero — you cannot allocate away more than exists.
 *
 * Every allocation records who allocated it, the effective date, and a reason, so
 * the ledger explains each movement on the investor's dashboard.
 */
import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type {
  InvestorLedgerRepository,
  LedgerEntryRow,
} from "../../repositories/investorLedgerRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import { derivePortfolio } from "./portfolioLedger.js"
import { toLedgerEntries } from "./portfolioProjection.js"

export interface AllocateGainDeps {
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface AllocateGainInput {
  readonly userId: string
  readonly fundId: string
  /** Signed paise: negative allocates a loss. */
  readonly gainPaise: bigint
  readonly effectiveDate: string
  readonly allocatedByUserId: string
  readonly reasonCode: string
  readonly note?: string | null
  readonly requestId: string
}

export interface AllocateGainResult {
  readonly entry: LedgerEntryRow
  readonly currentValuePaise: bigint
  readonly totalInvestmentPaise: bigint
  readonly totalReturnPaise: bigint
  readonly returnPercent: number | null
}

export const allocateGain = async (
  tx: Transaction,
  deps: AllocateGainDeps,
  input: AllocateGainInput,
): Promise<AllocateGainResult> => {
  if (input.gainPaise === 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { gainPaise: ["a gain allocation must be non-zero"] },
    })
  }

  // Derive the investor's position from the ledger before allocating: a loss may
  // not exceed what they currently hold.
  const existing = await deps.investorLedgerRepository.listByUserAndFund(tx, input.userId, input.fundId)
  if (existing.length === 0) {
    // Nothing invested in this pool: there is no position to allocate against.
    throw new AppError("STATE_CONFLICT")
  }
  const before = derivePortfolio(toLedgerEntries(existing))
  if (input.gainPaise < 0n && before.currentValuePaise + input.gainPaise < 0n) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { gainPaise: ["a loss allocation cannot exceed the investor's current value"] },
    })
  }

  const magnitude = input.gainPaise < 0n ? -input.gainPaise : input.gainPaise
  const entry = await deps.investorLedgerRepository.append(tx, {
    userId: input.userId,
    fundId: input.fundId,
    entryType: "gain_allocation",
    principalDeltaPaise: "0",
    valueDeltaPaise: input.gainPaise.toString(),
    amountPaise: magnitude.toString(),
    effectiveDate: input.effectiveDate,
    allocatedByUserId: input.allocatedByUserId,
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    requestId: input.requestId,
    metadata: { direction: input.gainPaise > 0n ? "gain" : "loss" },
  })

  const after = derivePortfolio(toLedgerEntries([...existing, entry]))

  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: "portfolio_updated",
    title: input.gainPaise > 0n ? "Returns credited" : "Portfolio value updated",
    body:
      input.gainPaise > 0n
        ? `₹${(Number(magnitude) / 100).toLocaleString("en-IN")} of returns has been added to your portfolio.`
        : `Your portfolio value has been revised down by ₹${(Number(magnitude) / 100).toLocaleString("en-IN")}.`,
    payload: {
      fundId: input.fundId,
      ledgerEntryId: entry.id,
      currentValuePaise: after.currentValuePaise.toString(),
    },
  })

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.allocatedByUserId,
    command: input.gainPaise > 0n ? "portfolio.gain_allocated" : "portfolio.loss_allocated",
    entityType: "investor_ledger_entry",
    entityId: entry.id,
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {
      userId: input.userId,
      fundId: input.fundId,
      gainPaise: input.gainPaise.toString(),
      effectiveDate: input.effectiveDate,
      reasonCode: input.reasonCode,
      currentValuePaise: after.currentValuePaise.toString(),
    },
  })

  return {
    entry,
    currentValuePaise: after.currentValuePaise,
    totalInvestmentPaise: after.totalInvestmentPaise,
    totalReturnPaise: after.totalReturnPaise,
    returnPercent: after.returnPercent,
  }
}
