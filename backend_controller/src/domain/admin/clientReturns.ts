import type { ClientValueEntryType } from "../../db/types.js"
import { returnBasisPoints } from "../client/portfolioLedger.js"
import { annualisedReturnBasisPoints, daysBetween, netFlowsByDate, type DatedFlow } from "../shared/xirr.js"

export const MIN_XIRR_HISTORY_DAYS = 30

export interface LedgerFact {
  readonly entryType: ClientValueEntryType
  readonly reversedEntryType: ClientValueEntryType | null
  readonly principalDeltaPaise: bigint
  readonly valueDeltaPaise: bigint
  readonly effectiveDate: string
  readonly lastCreatedAt: Date
}

export interface ClientValueFold {
  readonly investedPaise: bigint
  readonly currentValuePaise: bigint
  readonly growthPaise: bigint
  readonly simpleReturnBasisPoints: bigint | null
  readonly lastUpdatedAt: Date | null
}

export interface ClientReturns extends ClientValueFold {
  readonly xirrBasisPoints: bigint | null
}

const EXTERNAL_FLOW_TYPES: ReadonlySet<ClientValueEntryType> = new Set(["contribution", "withdrawal"])

const flowTypeOf = (fact: LedgerFact): ClientValueEntryType | null =>
  fact.entryType === "reversal" ? fact.reversedEntryType : fact.entryType

export const investorCashFlowOf = (fact: LedgerFact): bigint => {
  const flowType = flowTypeOf(fact)
  return flowType !== null && EXTERNAL_FLOW_TYPES.has(flowType) ? -fact.valueDeltaPaise : 0n
}

export const clientXirrBasisPoints = (
  facts: readonly LedgerFact[],
  currentValuePaise: bigint,
  asOfDate: string,
): bigint | null => {
  const flows: readonly DatedFlow[] = netFlowsByDate([
    ...facts.map((fact) => ({ date: fact.effectiveDate, amountPaise: investorCashFlowOf(fact) })),
    { date: asOfDate, amountPaise: currentValuePaise },
  ])
  const first = flows[0]
  if (first === undefined || !flows.some((flow) => flow.amountPaise < 0n)) return null
  if (daysBetween(first.date, asOfDate) < MIN_XIRR_HISTORY_DAYS) return null
  return annualisedReturnBasisPoints(flows)
}

const latestOf = (facts: readonly LedgerFact[]): Date | null =>
  facts.reduce<Date | null>(
    (latest, fact) => (latest === null || fact.lastCreatedAt > latest ? fact.lastCreatedAt : latest),
    null,
  )

export const foldClientValues = (facts: readonly LedgerFact[]): ClientValueFold => {
  const investedPaise = facts.reduce((sum, fact) => sum + fact.principalDeltaPaise, 0n)
  const currentValuePaise = facts.reduce((sum, fact) => sum + fact.valueDeltaPaise, 0n)
  const growthPaise = currentValuePaise - investedPaise
  return {
    investedPaise,
    currentValuePaise,
    growthPaise,
    simpleReturnBasisPoints: returnBasisPoints(growthPaise, investedPaise),
    lastUpdatedAt: latestOf(facts),
  }
}

export const withXirr = (fold: ClientValueFold, facts: readonly LedgerFact[], asOfDate: string): ClientReturns => ({
  ...fold,
  xirrBasisPoints: clientXirrBasisPoints(facts, fold.currentValuePaise, asOfDate),
})

export const summarizeClientReturns = (facts: readonly LedgerFact[], asOfDate: string): ClientReturns =>
  withXirr(foldClientValues(facts), facts, asOfDate)
