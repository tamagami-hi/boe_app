import { clientXirrBasisPoints } from "../admin/clientReturns.js"
import { returnBasisPoints } from "./portfolioLedger.js"
import type { BreakdownInput, HoldingRef, InvestmentRef, LedgerEntryFact } from "./investmentBreakdownFacts.js"
import { reversedEntryIdsOf } from "./investmentBreakdownFacts.js"
import { runBreakdownPass, type HoldingState, type PassResult } from "./investmentBreakdownPass.js"

export type {
  BreakdownInput,
  EarlyExitFact,
  GrowthPartFact,
  HoldingRef,
  InvestmentRef,
  LedgerEntryFact,
  ScheduleFact,
  SplitFact,
  SplitPartFact,
} from "./investmentBreakdownFacts.js"
export { refKey } from "./investmentBreakdownFacts.js"

export type FundStatus = "ready" | "preparing"
export type PreparingReason = "uncategorised" | "uncovered_growth" | "sum_mismatch"

export interface InvestmentFigures {
  readonly investedPaise: bigint
  readonly valuePaise: bigint
  readonly growthPaise: bigint
  readonly simpleReturnBasisPoints: bigint | null
}

export interface SipBlockFact extends InvestmentFigures {
  readonly scheduleId: string
  readonly state: "active" | "ended"
  readonly xirrBasisPoints: bigint | null
  readonly monthsPaid: number
  readonly monthsTotal: number
}

export interface OneTimeBlockFact extends InvestmentFigures {
  readonly entryId: string
  readonly allocationId: string
  readonly effectiveDate: string
  readonly reversed: boolean
}

export interface BreakdownLineFact {
  readonly kind: "other_adjustments"
  readonly valuePaise: bigint
}

export interface HoldingFact {
  readonly ref: HoldingRef
  readonly investedPaise: bigint
  readonly valuePaise: bigint
  readonly present: boolean
  readonly reversed: boolean
  readonly firstDate: string | null
}

export interface FundBreakdownFact {
  readonly fundId: string
  readonly status: FundStatus
  readonly preparingReason: PreparingReason | null
  readonly positionValuePaise: bigint
  readonly positionInvestedPaise: bigint
  readonly sips: readonly SipBlockFact[]
  readonly oneTime: readonly OneTimeBlockFact[]
  readonly lines: readonly BreakdownLineFact[]
  readonly stakes: readonly HoldingFact[]
  readonly uncategorisedEntryIds: readonly string[]
  readonly uncoveredEntryIds: readonly string[]
}

export interface ToCategorise {
  readonly recordings: readonly string[]
  readonly fundsNeedingSplit: readonly string[]
}

const figuresOf = (investedPaise: bigint, valuePaise: bigint): InvestmentFigures => {
  const growthPaise = valuePaise - investedPaise
  return { investedPaise, valuePaise, growthPaise, simpleReturnBasisPoints: returnBasisPoints(growthPaise, investedPaise) }
}

const isReversed = (holding: HoldingState): boolean =>
  holding.ref.kind !== "sip" && holding.contributions > 0 && holding.live === 0

const fundIdsOf = (input: BreakdownInput): readonly string[] =>
  [...new Set(input.entries.map((entry) => entry.fundId))].sort()

export const uncategorisedRecordingIds = (input: BreakdownInput, fundId: string | null = null): readonly string[] => {
  const reversed = reversedEntryIdsOf(input.entries)
  return input.entries
    .filter(
      (entry: LedgerEntryFact) =>
        entry.entryType === "contribution" &&
        (fundId === null || entry.fundId === fundId) &&
        !reversed.has(entry.id) &&
        !input.sipLinks.has(entry.id) &&
        !input.oneTimeCategories.has(entry.id) &&
        !input.onlinePaymentEntryIds.has(entry.id),
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map((entry) => entry.id)
}

const sipBlocks = (input: BreakdownInput, fundId: string, pass: PassResult, asOfDate: string): readonly SipBlockFact[] =>
  input.schedules
    .filter((schedule) => schedule.fundId === fundId)
    .flatMap((schedule): SipBlockFact[] => {
      const holding = pass.stakes.get(`sip:${schedule.id}`)
      if (holding === undefined && schedule.state !== "active") return []
      const figures = figuresOf(holding?.invested ?? 0n, holding?.value ?? 0n)
      const flows = pass.flows.get(`sip:${schedule.id}`) ?? []
      return [
        {
          ...figures,
          scheduleId: schedule.id,
          state: schedule.state === "active" ? "active" : "ended",
          xirrBasisPoints: clientXirrBasisPoints(flows, figures.valuePaise, asOfDate),
          monthsPaid: schedule.monthsPaid,
          monthsTotal: schedule.monthCount,
        },
      ]
    })
    .sort((left, right) => (left.state === right.state ? 0 : left.state === "active" ? -1 : 1))

const oneTimeBlocks = (pass: PassResult): readonly OneTimeBlockFact[] =>
  [...pass.stakes.values()]
    .filter((holding) => holding.ref.kind === "one_time" || (holding.ref.kind === "uncategorised" && isReversed(holding)))
    .sort((left, right) =>
      (left.firstDate ?? "") === (right.firstDate ?? "")
        ? right.firstSequence - left.firstSequence
        : (left.firstDate ?? "") < (right.firstDate ?? "") ? 1 : -1,
    )
    .map((holding) => {
      const reversed = isReversed(holding)
      return {
        ...(reversed ? figuresOf(0n, 0n) : figuresOf(holding.invested, holding.value)),
        entryId: holding.firstEntryId ?? "",
        allocationId: holding.ref.kind === "sip" ? "" : holding.ref.allocationId,
        effectiveDate: holding.firstDate ?? "",
        reversed,
      }
    })

interface OtherAdjustments {
  readonly valuePaise: bigint
  readonly investedPaise: bigint
}

const otherAdjustmentsOf = (pass: PassResult): OtherAdjustments =>
  [...pass.stakes.values()].filter(isReversed).reduce(
    (sum, holding) => ({ valuePaise: sum.valuePaise + holding.value, investedPaise: sum.investedPaise + holding.invested }),
    { valuePaise: pass.otherValuePaise, investedPaise: pass.otherInvestedPaise },
  )

const valueOf = (blocks: readonly Readonly<{ valuePaise: bigint }>[]): bigint =>
  blocks.reduce((sum, block) => sum + block.valuePaise, 0n)

const holdingFacts = (pass: PassResult): readonly HoldingFact[] =>
  [...pass.stakes.values()]
    .sort((left, right) => left.firstSequence - right.firstSequence)
    .map((holding) => ({
      ref: holding.ref,
      investedPaise: holding.invested,
      valuePaise: holding.value,
      present: holding.live > 0 && !holding.exited,
      reversed: isReversed(holding),
      firstDate: holding.firstDate,
    }))

interface BlockTotals {
  readonly valuePaise: bigint
  readonly investedPaise: bigint
}

const preparingReasonOf = (uncategorised: readonly string[], pass: PassResult, totals: BlockTotals): PreparingReason | null => {
  if (uncategorised.length > 0) return "uncategorised"
  if (pass.uncoveredEntryIds.length > 0) return "uncovered_growth"
  const balanced = totals.valuePaise === pass.positionValuePaise && totals.investedPaise === pass.positionInvestedPaise
  return balanced ? null : "sum_mismatch"
}

export const foldFundBreakdown = (input: BreakdownInput, fundId: string, asOfDate: string): FundBreakdownFact => {
  const pass = runBreakdownPass(input, fundId, "settled")
  const sips = sipBlocks(input, fundId, pass, asOfDate)
  const oneTime = oneTimeBlocks(pass)
  const other = otherAdjustmentsOf(pass)
  const lines: readonly BreakdownLineFact[] =
    other.valuePaise === 0n ? [] : [{ kind: "other_adjustments", valuePaise: other.valuePaise }]
  const blocks = [...sips, ...oneTime]
  const totals = {
    valuePaise: valueOf([...blocks, ...lines]),
    investedPaise: blocks.reduce((sum, block) => sum + block.investedPaise, other.investedPaise),
  }
  const uncategorisedEntryIds = uncategorisedRecordingIds(input, fundId)
  const preparingReason = preparingReasonOf(uncategorisedEntryIds, pass, totals)
  return {
    fundId,
    status: preparingReason === null ? "ready" : "preparing",
    preparingReason,
    positionValuePaise: pass.positionValuePaise,
    positionInvestedPaise: pass.positionInvestedPaise,
    sips,
    oneTime,
    lines,
    stakes: holdingFacts(pass),
    uncategorisedEntryIds,
    uncoveredEntryIds: pass.uncoveredEntryIds,
  }
}

export const foldInvestmentBreakdown = (input: BreakdownInput, asOfDate: string): readonly FundBreakdownFact[] =>
  fundIdsOf(input).map((fundId) => foldFundBreakdown(input, fundId, asOfDate))

export const fundStatus = (input: BreakdownInput, fundId: string): FundStatus =>
  foldFundBreakdown(input, fundId, "1970-01-01").status

export const needsEarlierGrowthSplit = (fund: Pick<FundBreakdownFact, "uncategorisedEntryIds" | "uncoveredEntryIds">): boolean =>
  fund.uncategorisedEntryIds.length === 0 && fund.uncoveredEntryIds.length > 0

export const toCategorise = (input: BreakdownInput): ToCategorise => ({
  recordings: uncategorisedRecordingIds(input),
  fundsNeedingSplit: fundIdsOf(input).filter((fundId) =>
    needsEarlierGrowthSplit({
      uncategorisedEntryIds: uncategorisedRecordingIds(input, fundId),
      uncoveredEntryIds: runBreakdownPass(input, fundId, "settled").uncoveredEntryIds,
    }),
  ),
})

export interface ProposedSplit {
  readonly cutoffEntryId: string
  readonly totalPaise: bigint
  readonly coveredEntryIds: readonly string[]
  readonly parts: readonly Readonly<{ ref: InvestmentRef; amountPaise: bigint }>[]
}

const investmentRefOf = (ref: HoldingRef): InvestmentRef =>
  ref.kind === "uncategorised" ? { kind: "one_time", allocationId: ref.allocationId } : ref

export const proposeSplitByValue = (input: BreakdownInput, fundId: string): ProposedSplit | null => {
  const pass = runBreakdownPass(input, fundId, "propose")
  const cutoffEntryId = pass.coveredEntryIds.at(-1)
  if (cutoffEntryId === undefined) return null
  const totalPaise = input.entries
    .filter((entry) => pass.coveredEntryIds.includes(entry.id))
    .reduce((sum, entry) => sum + entry.valueDeltaPaise, 0n)
  const parts = [...pass.proposal.entries()]
    .filter(([, amountPaise]) => amountPaise !== 0n)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([key, amountPaise]) => {
      const holding = pass.stakes.get(key)
      return holding === undefined ? [] : [{ ref: investmentRefOf(holding.ref), amountPaise }]
    })
  return { cutoffEntryId, totalPaise, coveredEntryIds: pass.coveredEntryIds, parts }
}
