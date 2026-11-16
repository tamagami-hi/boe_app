import type { SipEarlyExitHolding } from "../domain/admin/earlyExit.js"
import { SIP_EARLY_EXIT_REFUSALS, sipEarlyExitRefusal } from "../domain/admin/earlyExitRules.js"
import { withdrawalPortions } from "../domain/admin/withdrawalEntry.js"
import type { AdminSipScheduleRow } from "../repositories/adminSipScheduleRepository.js"
import type { SipEarlyExitRow } from "../repositories/earlyExitRepository.js"

const iso = (value: Date | string): string => new Date(value).toISOString()

export const mapAdminSipEarlyExit = (row: SipEarlyExitRow): Record<string, unknown> => ({
  earlyExitId: row.id,
  scheduleId: row.scheduleId,
  userId: row.userId,
  fundId: row.fundId,
  fundName: row.fundName,
  entryId: row.ledgerEntryId,
  amountPaise: row.amountPaise,
  principalBeforePaise: row.principalBeforePaise,
  valueBeforePaise: row.valueBeforePaise,
  effectiveDate: row.effectiveDate,
  cancelledMaturityScheduleId: row.cancelledMaturityScheduleId,
  cancelledMaturityDate: row.cancelledMaturityDate,
  createdAt: iso(row.createdAt),
  payout: {
    id: row.payoutId,
    userId: row.userId,
    fundId: row.fundId,
    ledgerEntryId: row.ledgerEntryId,
    state: row.payoutState,
    amountPaise: row.amountPaise,
    growthPortionPaise: row.payoutGrowthPortionPaise,
    principalPortionPaise: row.payoutPrincipalPortionPaise,
    effectiveDate: row.effectiveDate,
    transferReference: row.payoutTransferReference,
    failureCode: row.payoutFailureCode,
    version: row.payoutVersion,
    createdAt: iso(row.payoutCreatedAt),
  },
})

export const mapClientSipEarlyExit = (row: SipEarlyExitRow): Record<string, unknown> => ({
  earlyExitId: row.id,
  scheduleId: row.scheduleId,
  fundId: row.fundId,
  fundName: row.fundName,
  entryId: row.ledgerEntryId,
  amountPaise: row.amountPaise,
  effectiveDate: row.effectiveDate,
  closedAt: iso(row.createdAt),
})

export const mapSipEarlyExitPreview = (schedule: AdminSipScheduleRow, holding: SipEarlyExitHolding): Record<string, unknown> => {
  const refusal = sipEarlyExitRefusal(holding.facts)
  const portions = withdrawalPortions(holding.position, holding.position.currentValuePaise)
  return {
    scheduleId: schedule.id,
    scheduleVersion: Number(schedule.version),
    scheduleState: schedule.state,
    fundId: schedule.fundId,
    fundName: schedule.fundName,
    principalPaise: holding.position.principalPaise.toString(),
    currentValuePaise: holding.position.currentValuePaise.toString(),
    principalPortionPaise: portions.principalPortionPaise.toString(),
    growthPortionPaise: portions.growthPortionPaise.toString(),
    effectiveDate: holding.facts.today,
    maturity:
      holding.maturity === null ? null : { scheduleId: holding.maturity.id, maturityDate: holding.maturity.maturityDate },
    refusal: refusal === null ? null : { code: refusal, message: SIP_EARLY_EXIT_REFUSALS[refusal] },
  }
}
