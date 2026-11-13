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

export interface ClientReturns {
  readonly investedPaise: bigint
  readonly currentValuePaise: bigint
  readonly growthPaise: bigint
  readonly simpleReturnBasisPoints: bigint | null
  readonly xirrBasisPoints: bigint | null
  readonly lastUpdatedAt: Date | null
}

const EXTERNAL_FLOW_TYPES: ReadonlySet<ClientValueEntryType> = new Set(["contribution", "withdrawal"])

const flowTypeOf = (fact: LedgerFact): ClientValueEntryType | null =>
  fact.entryType === "reversal" ? fact.reversedEntryType : fact.entryType

export const investorCashFlowOf = (fact: LedgerFact): bigint => {
  const flowType = flowTypeOf(fact)
  return flowType !== null && EXTERNAL_FLOW_TYPES.has(flowType) ? -fact.valueDeltaPaise : 0n
}

const xirrOf = (facts: readonly LedgerFact[], currentValuePaise: bigint, asOfDate: string): bigint | null => {
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

export const summarizeClientReturns = (facts: readonly LedgerFact[], asOfDate: string): ClientReturns => {
  const investedPaise = facts.reduce((sum, fact) => sum + fact.principalDeltaPaise, 0n)
  const currentValuePaise = facts.reduce((sum, fact) => sum + fact.valueDeltaPaise, 0n)
  const growthPaise = currentValuePaise - investedPaise
  return {
    investedPaise,
    currentValuePaise,
    growthPaise,
    simpleReturnBasisPoints: returnBasisPoints(growthPaise, investedPaise),
    xirrBasisPoints: xirrOf(facts, currentValuePaise, asOfDate),
    lastUpdatedAt: latestOf(facts),
  }
}
