import type { AdminSipScheduleState, ClientValueEntryType } from "../../db/types.js"

export type InvestmentRef =
  | { readonly kind: "sip"; readonly scheduleId: string }
  | { readonly kind: "one_time"; readonly allocationId: string }

export type HoldingRef = InvestmentRef | { readonly kind: "uncategorised"; readonly allocationId: string }

export interface LedgerEntryFact {
  readonly id: string
  readonly fundId: string
  readonly entryType: ClientValueEntryType
  readonly principalDeltaPaise: bigint
  readonly valueDeltaPaise: bigint
  readonly effectiveDate: string
  readonly sequence: number
  readonly allocationId: string | null
  readonly reversesEntryId: string | null
  readonly reasonCode: string
}

export interface ScheduleFact {
  readonly id: string
  readonly fundId: string
  readonly state: AdminSipScheduleState
  readonly monthCount: number
  readonly monthsPaid: number
}

export interface GrowthPartFact {
  readonly entryId: string
  readonly target: InvestmentRef
  readonly amountPaise: bigint
}

export interface SplitPartFact {
  readonly target: InvestmentRef
  readonly amountPaise: bigint
}

export interface SplitFact {
  readonly id: string
  readonly fundId: string
  readonly cutoffEntryId: string
  readonly totalPaise: bigint
  readonly parts: readonly SplitPartFact[]
  readonly entryIds: ReadonlySet<string>
  readonly confirmedAt: Date
}

export interface EarlyExitFact {
  readonly scheduleId: string
  readonly ledgerEntryId: string
}

export interface BreakdownInput {
  readonly entries: readonly LedgerEntryFact[]
  readonly oneTimeCategories: ReadonlySet<string>
  readonly sipLinks: ReadonlyMap<string, string>
  readonly schedules: readonly ScheduleFact[]
  readonly growthParts: readonly GrowthPartFact[]
  readonly splits: ReadonlyMap<string, SplitFact>
  readonly onlinePaymentEntryIds: ReadonlySet<string>
  readonly earlyExits: readonly EarlyExitFact[]
}

export const refKey = (ref: HoldingRef): string =>
  ref.kind === "sip" ? `sip:${ref.scheduleId}` : `${ref.kind}:${ref.allocationId}`

export const contributionRefOf = (input: BreakdownInput, entry: LedgerEntryFact): HoldingRef => {
  const scheduleId = input.sipLinks.get(entry.id)
  if (scheduleId !== undefined) return { kind: "sip", scheduleId }
  const allocationId = entry.allocationId ?? entry.id
  const categorised = input.oneTimeCategories.has(entry.id) || input.onlinePaymentEntryIds.has(entry.id)
  return { kind: categorised ? "one_time" : "uncategorised", allocationId }
}

export const allocationRefs = (input: BreakdownInput): ReadonlyMap<string, HoldingRef> =>
  new Map(
    input.entries
      .filter((entry) => entry.entryType === "contribution" && entry.allocationId !== null)
      .map((entry) => [entry.allocationId ?? entry.id, contributionRefOf(input, entry)] as const),
  )

export const resolveTarget = (allocations: ReadonlyMap<string, HoldingRef>, target: InvestmentRef): HoldingRef =>
  target.kind === "sip" ? target : (allocations.get(target.allocationId) ?? target)

export const reversedEntryIdsOf = (entries: readonly LedgerEntryFact[]): ReadonlySet<string> =>
  new Set(entries.flatMap((entry) => (entry.reversesEntryId === null ? [] : [entry.reversesEntryId])))

export const ledgerOrder = (left: LedgerEntryFact, right: LedgerEntryFact): number => left.sequence - right.sequence
