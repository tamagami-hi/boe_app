import {
  foldFundBreakdown,
  type BreakdownInput,
  type FundBreakdownFact,
  type HoldingFact,
  type HoldingRef,
  type InvestmentRef,
} from "../client/investmentBreakdown.js"
import { refKey } from "../client/investmentBreakdownFacts.js"
import type { InvestmentBasis, PositionGrowthBasis } from "./investmentGrowth.js"

export interface InvestmentDescription {
  readonly kind: "sip" | "one_time" | "investment"
  readonly firstDate: string | null
}

export interface ClientFundGrowthBases {
  readonly position: PositionGrowthBasis
  readonly positionInvestedPaise: bigint
  readonly investments: readonly InvestmentBasis[]
  readonly descriptions: ReadonlyMap<string, InvestmentDescription>
}

const BASIS_AS_OF = "1970-01-01"

export const investmentRefOf = (ref: HoldingRef): InvestmentRef =>
  ref.kind === "uncategorised" ? { kind: "one_time", allocationId: ref.allocationId } : ref

const presentHoldings = (fund: FundBreakdownFact): readonly HoldingFact[] => fund.stakes.filter((holding) => holding.present)

export const holdsSeveralInvestments = (input: BreakdownInput, fundId: string): boolean =>
  presentHoldings(foldFundBreakdown(input, fundId, BASIS_AS_OF)).length > 1

const latestEntryIdOf = (input: BreakdownInput, fundId: string): string | null =>
  input.entries
    .filter((entry) => entry.fundId === fundId)
    .reduce<{ id: string; sequence: number } | null>(
      (latest, entry) => (latest === null || entry.sequence > latest.sequence ? { id: entry.id, sequence: entry.sequence } : latest),
      null,
    )?.id ?? null

export const clientFundGrowthBases = (
  userId: string,
  fundId: string,
  input: BreakdownInput,
): ClientFundGrowthBases | null => {
  const fund = foldFundBreakdown(input, fundId, BASIS_AS_OF)
  const present = presentHoldings(fund)
  if (present.length === 0) return null
  const singleUncategorised = present.length === 1 && fund.preparingReason === "uncategorised"
  const investments = present.map((holding) => {
    const ref = investmentRefOf(holding.ref)
    return {
      userId,
      fundId,
      ref,
      investedPaise: holding.investedPaise,
      valuePaise: holding.valuePaise,
      holdsNothing: ref.kind === "sip" && (holding.investedPaise <= 0n || holding.valuePaise <= 0n),
    }
  })
  return {
    position: {
      userId,
      fundId,
      valuePaise: fund.positionValuePaise,
      latestEntryId: latestEntryIdOf(input, fundId),
      categoriseFirst: fund.status === "preparing" && !singleUncategorised,
    },
    positionInvestedPaise: fund.positionInvestedPaise,
    investments,
    descriptions: new Map(
      present.map((holding) => [
        refKey(investmentRefOf(holding.ref)),
        { kind: holding.ref.kind === "uncategorised" ? "investment" : holding.ref.kind, firstDate: holding.firstDate },
      ] as const),
    ),
  }
}
