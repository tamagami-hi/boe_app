import { proposeEarlierGrowthSplit } from "../domain/admin/earlierGrowthSplit.js"
import {
  foldFundBreakdown,
  needsEarlierGrowthSplit,
  type BreakdownInput,
  type FundBreakdownFact,
  type HoldingFact,
  type InvestmentRef,
  type SplitFact,
} from "../domain/client/investmentBreakdown.js"
import { recordingLabelOf } from "../domain/shared/recordingCategory.js"
import type { BreakdownContext } from "../repositories/investmentBreakdownRepository.js"
import { iso } from "./adminRouteKit.js"

const STATUS_DATE = "1970-01-01"
const COLLECTION_LABEL = "SIP instalment"

export const investmentRefBody = (ref: InvestmentRef): Record<string, string> =>
  ref.kind === "sip" ? { kind: "sip", scheduleId: ref.scheduleId } : { kind: "one_time", allocationId: ref.allocationId }

const labelOf = (input: BreakdownInput, holding: HoldingFact): string => {
  if (holding.ref.kind === "sip") {
    const scheduleId = holding.ref.scheduleId
    return input.schedules.find((schedule) => schedule.id === scheduleId)?.state === "active" ? "SIP" : "Ended SIP"
  }
  return holding.reversed ? "One-time investment, reversed" : "One-time investment"
}

const investmentsOf = (input: BreakdownInput, fund: FundBreakdownFact): readonly Record<string, unknown>[] =>
  fund.stakes.flatMap((holding) =>
    holding.ref.kind === "uncategorised"
      ? []
      : [
          {
            ref: investmentRefBody(holding.ref),
            label: labelOf(input, holding),
            date: holding.firstDate,
            amountPaise: (holding.reversed ? 0n : holding.investedPaise).toString(),
            reversed: holding.reversed,
          },
        ],
  )

const uncategorisedOf = (context: BreakdownContext, fund: FundBreakdownFact): readonly Record<string, unknown>[] =>
  fund.uncategorisedEntryIds.flatMap((entryId) => {
    const entry = context.input.entries.find((row) => row.id === entryId)
    if (entry === undefined) return []
    return [
      {
        entryId,
        effectiveDate: entry.effectiveDate,
        amountPaise: entry.principalDeltaPaise.toString(),
        reasonLabel: context.orderTypes.get(entryId) === "sip_installment" ? COLLECTION_LABEL : recordingLabelOf(entry.reasonCode, null),
      },
    ]
  })

const confirmedOf = (split: SplitFact | undefined): Record<string, unknown> | null =>
  split === undefined
    ? null
    : {
        splitId: split.id,
        cutoffEntryId: split.cutoffEntryId,
        totalPaise: split.totalPaise.toString(),
        parts: split.parts.map((part) => ({ ref: investmentRefBody(part.target), amountPaise: part.amountPaise.toString() })),
        confirmedAt: iso(split.confirmedAt),
      }

const earlierGrowthOf = (input: BreakdownInput, fund: FundBreakdownFact): Record<string, unknown> | null => {
  const proposal = proposeEarlierGrowthSplit(input, fund.fundId)
  if (proposal === null) return null
  return {
    totalPaise: proposal.totalPaise.toString(),
    cutoffEntryId: proposal.cutoffEntryId,
    needsConfirmation: needsEarlierGrowthSplit(fund),
    proposal: proposal.parts.map((part) => ({ ref: investmentRefBody(part.ref), amountPaise: part.amountPaise.toString() })),
    confirmed: confirmedOf(input.splits.get(fund.fundId)),
  }
}

export const clientInvestmentsBody = (
  userId: string,
  context: BreakdownContext,
  fundNames: ReadonlyMap<string, string>,
): Record<string, unknown> => {
  const fundIds = [...new Set(context.input.entries.map((entry) => entry.fundId))]
  const funds = fundIds
    .map((fundId) => foldFundBreakdown(context.input, fundId, STATUS_DATE))
    .map((fund) => ({
      fundId: fund.fundId,
      fundName: fundNames.get(fund.fundId) ?? "",
      status: fund.status,
      investments: investmentsOf(context.input, fund),
      uncategorised: uncategorisedOf(context, fund),
      earlierGrowth: earlierGrowthOf(context.input, fund),
    }))
    .sort((left, right) => left.fundName.localeCompare(right.fundName))
  return { userId, funds }
}
