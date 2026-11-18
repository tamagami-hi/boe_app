import type { LedgerFact } from "../admin/clientReturns.js"
import { apportion } from "../shared/apportion.js"
import {
  allocationRefs,
  contributionRefOf,
  ledgerOrder,
  refKey,
  resolveTarget,
  reversedEntryIdsOf,
  type BreakdownInput,
  type GrowthPartFact,
  type HoldingRef,
  type LedgerEntryFact,
  type SplitFact,
} from "./investmentBreakdownFacts.js"

export type PassMode = "settled" | "propose"

export interface HoldingState {
  readonly ref: HoldingRef
  invested: bigint
  value: bigint
  live: number
  contributions: number
  exited: boolean
  firstDate: string | null
  firstSequence: number
  firstEntryId: string | null
}

interface Share {
  readonly key: string | null
  readonly principal: bigint
  readonly value: bigint
}

export interface PassResult {
  readonly stakes: ReadonlyMap<string, HoldingState>
  readonly otherValuePaise: bigint
  readonly otherInvestedPaise: bigint
  readonly uncoveredEntryIds: readonly string[]
  readonly proposal: ReadonlyMap<string, bigint>
  readonly coveredEntryIds: readonly string[]
  readonly flows: ReadonlyMap<string, readonly LedgerFact[]>
  readonly positionValuePaise: bigint
  readonly positionInvestedPaise: bigint
}

const EPOCH = new Date(0)
const FLOW_TYPES = new Set(["contribution", "withdrawal"])

const positive = (value: bigint): bigint => (value > 0n ? value : 0n)

interface PassContext {
  readonly input: BreakdownInput
  readonly entries: ReadonlyMap<string, LedgerEntryFact>
  readonly reversed: ReadonlySet<string>
  readonly split: SplitFact | null
  readonly mode: PassMode
  readonly allocations: ReadonlyMap<string, HoldingRef>
  readonly exits: ReadonlyMap<string, string>
  readonly parts: ReadonlyMap<string, readonly GrowthPartFact[]>
}

const partsByEntry = (parts: readonly GrowthPartFact[]): ReadonlyMap<string, readonly GrowthPartFact[]> => {
  const grouped = new Map<string, GrowthPartFact[]>()
  for (const part of parts) grouped.set(part.entryId, [...(grouped.get(part.entryId) ?? []), part])
  return grouped
}

class BreakdownPass {
  private readonly stakes = new Map<string, HoldingState>()
  private readonly attribution = new Map<string, readonly Share[]>()
  private readonly flows = new Map<string, LedgerFact[]>()
  private readonly proposal = new Map<string, bigint>()
  private readonly covered: string[] = []
  private readonly uncovered: string[] = []
  private readonly allocated = new Map<string, bigint>()
  private otherValue = 0n
  private otherInvested = 0n
  private splitCumulative = 0n

  constructor(private readonly context: PassContext) {}

  run(ordered: readonly LedgerEntryFact[]): PassResult {
    for (const entry of ordered) this.step(entry)
    return {
      stakes: this.stakes,
      otherValuePaise: this.otherValue,
      otherInvestedPaise: this.otherInvested,
      uncoveredEntryIds: this.uncovered,
      proposal: this.proposal,
      coveredEntryIds: this.covered,
      flows: this.flows,
      positionValuePaise: ordered.reduce((sum, entry) => sum + entry.valueDeltaPaise, 0n),
      positionInvestedPaise: ordered.reduce((sum, entry) => sum + entry.principalDeltaPaise, 0n),
    }
  }

  private step(entry: LedgerEntryFact): void {
    if (entry.entryType === "contribution") this.contribution(entry)
    else if (entry.entryType === "reversal") this.reversal(entry)
    else if (entry.entryType === "growth_adjustment") this.growth(entry)
    else if (entry.entryType === "withdrawal") this.withdrawal(entry)
    else this.reinvestment(entry)
  }

  private holding(ref: HoldingRef): HoldingState {
    const key = refKey(ref)
    const existing = this.stakes.get(key)
    if (existing !== undefined) return existing
    const created: HoldingState = {
      ref, invested: 0n, value: 0n, live: 0, contributions: 0, exited: false,
      firstDate: null, firstSequence: Number.MAX_SAFE_INTEGER, firstEntryId: null,
    }
    this.stakes.set(key, created)
    return created
  }

  private presentKeys(except: string | null = null): readonly string[] {
    return [...this.stakes.entries()]
      .filter(([key, holding]) => key !== except && holding.live > 0 && !holding.exited)
      .map(([key]) => key)
      .sort()
  }

  private apply(entry: LedgerEntryFact, shares: readonly Share[]): void {
    for (const share of shares) {
      if (share.key === null) {
        this.otherValue += share.value
        this.otherInvested += share.principal
        continue
      }
      const holding = this.stakes.get(share.key)
      if (holding === undefined) continue
      holding.invested += share.principal
      holding.value += share.value
      this.recordFlow(entry, holding, share)
    }
    this.attribution.set(entry.id, shares)
  }

  private recordFlow(entry: LedgerEntryFact, holding: HoldingState, share: Share): void {
    if (holding.ref.kind !== "sip") return
    const original = entry.reversesEntryId === null ? null : (this.context.entries.get(entry.reversesEntryId) ?? null)
    const flowType = original === null ? entry.entryType : original.entryType
    if (!FLOW_TYPES.has(flowType)) return
    const flows = this.flows.get(refKey(holding.ref)) ?? []
    flows.push({
      entryType: entry.entryType,
      reversedEntryType: original?.entryType ?? null,
      principalDeltaPaise: share.principal,
      valueDeltaPaise: share.value,
      effectiveDate: entry.effectiveDate,
      lastCreatedAt: EPOCH,
    })
    this.flows.set(refKey(holding.ref), flows)
  }

  private spread(keys: readonly string[], principal: bigint, value: bigint): readonly Share[] {
    if (keys.length === 0) return [{ key: null, principal, value }]
    const valued = keys.map((key) => positive(this.stakes.get(key)?.value ?? 0n))
    const weights = valued.some((weight) => weight > 0n) ? valued : keys.map(() => 1n)
    const principals = apportion(principal, weights)
    const values = apportion(value, weights)
    return keys.map((key, index) => ({ key, principal: principals[index] ?? 0n, value: values[index] ?? 0n }))
  }

  private contribution(entry: LedgerEntryFact): void {
    const holding = this.holding(contributionRefOf(this.context.input, entry))
    holding.live += 1
    holding.contributions += 1
    if (entry.sequence < holding.firstSequence) {
      holding.firstSequence = entry.sequence
      holding.firstDate = entry.effectiveDate
      holding.firstEntryId = entry.id
    }
    this.apply(entry, [{ key: refKey(holding.ref), principal: entry.principalDeltaPaise, value: entry.valueDeltaPaise }])
  }

  private reversal(entry: LedgerEntryFact): void {
    const original = entry.reversesEntryId === null ? undefined : this.context.entries.get(entry.reversesEntryId)
    if (original === undefined) return
    if (original.entryType === "contribution") this.holding(contributionRefOf(this.context.input, original)).live -= 1
    const shares = this.attribution.get(original.id)
    if (shares === undefined) return
    this.apply(entry, shares.map((share) => ({ key: share.key, principal: -share.principal, value: -share.value })))
  }

  private growth(entry: LedgerEntryFact): void {
    const parts = this.context.parts.get(entry.id)
    if (parts !== undefined) {
      const shares = parts.map((part) => {
        const holding = this.holding(resolveTarget(this.context.allocations, part.target))
        return { key: refKey(holding.ref), principal: 0n, value: part.amountPaise }
      })
      this.apply(entry, shares)
      return
    }
    if (this.context.split?.entryIds.has(entry.id) === true) {
      this.applySplit(entry, this.context.split)
      return
    }
    const present = this.presentKeys()
    if (present.length === 0) {
      this.apply(entry, [{ key: null, principal: 0n, value: entry.valueDeltaPaise }])
      return
    }
    if (present.length === 1) {
      this.apply(entry, [{ key: present[0] ?? null, principal: 0n, value: entry.valueDeltaPaise }])
      return
    }
    if (this.context.reversed.has(entry.id)) return
    if (this.context.mode === "propose" && present.length > 1) {
      const shares = this.spread(present, 0n, entry.valueDeltaPaise)
      for (const share of shares) {
        if (share.key !== null) this.proposal.set(share.key, (this.proposal.get(share.key) ?? 0n) + share.value)
      }
      this.covered.push(entry.id)
      this.apply(entry, shares)
      return
    }
    this.uncovered.push(entry.id)
  }

  private applySplit(entry: LedgerEntryFact, split: SplitFact): void {
    if (split.totalPaise === 0n) {
      this.apply(entry, [{ key: null, principal: 0n, value: entry.valueDeltaPaise }])
      return
    }
    const merged = new Map<string, bigint>()
    for (const part of split.parts) {
      const key = refKey(this.holding(resolveTarget(this.context.allocations, part.target)).ref)
      merged.set(key, (merged.get(key) ?? 0n) + part.amountPaise)
    }
    const keys = [...merged.keys()].sort()
    this.splitCumulative += entry.valueDeltaPaise
    const targets = apportion(this.splitCumulative, keys.map((key) => merged.get(key) ?? 0n))
    const shares = keys.map((key, index) => {
      const target = targets[index] ?? 0n
      const increment = target - (this.allocated.get(key) ?? 0n)
      this.allocated.set(key, target)
      return { key, principal: 0n, value: increment }
    })
    this.apply(entry, shares)
  }

  private withdrawal(entry: LedgerEntryFact): void {
    const scheduleId = this.context.exits.get(entry.id)
    if (scheduleId === undefined) {
      this.apply(entry, this.spread(this.presentKeys(), entry.principalDeltaPaise, entry.valueDeltaPaise))
      return
    }
    const sip = this.holding({ kind: "sip", scheduleId })
    const sipKey = refKey(sip.ref)
    const others = this.presentKeys(sipKey).filter((key) => (this.stakes.get(key)?.value ?? 0n) > 0n)
    const exitValue = -entry.valueDeltaPaise
    const exitPrincipal = -entry.principalDeltaPaise
    const takeValue = others.length === 0 || exitValue <= sip.value ? exitValue : positive(sip.value)
    const takePrincipal = takeValue === exitValue ? exitPrincipal : exitPrincipal < positive(sip.invested) ? exitPrincipal : positive(sip.invested)
    const rest = takeValue === exitValue ? [] : this.spread(others, takePrincipal - exitPrincipal, takeValue - exitValue)
    this.apply(entry, [{ key: sipKey, principal: -takePrincipal, value: -takeValue }, ...rest])
    sip.exited = true
  }

  private reinvestment(entry: LedgerEntryFact): void {
    const present = this.presentKeys()
    const gains = present.map((key) => {
      const holding = this.stakes.get(key)
      return holding === undefined ? 0n : holding.value - holding.invested
    })
    const remainder = entry.principalDeltaPaise - gains.reduce((sum, gain) => sum + gain, 0n)
    const extra = remainder === 0n || present.length === 0 ? [] : this.spread(present, remainder, 0n)
    const shares = present.map((key, index) => ({
      key,
      principal: (gains[index] ?? 0n) + (extra[index]?.principal ?? 0n),
      value: 0n,
    }))
    this.apply(entry, shares.length === 0 ? [{ key: null, principal: entry.principalDeltaPaise, value: 0n }] : shares)
  }
}

export const runBreakdownPass = (input: BreakdownInput, fundId: string, mode: PassMode): PassResult => {
  const ordered = input.entries.filter((entry) => entry.fundId === fundId).sort(ledgerOrder)
  const pass = new BreakdownPass({
    input,
    entries: new Map(ordered.map((entry) => [entry.id, entry] as const)),
    reversed: reversedEntryIdsOf(ordered),
    split: mode === "settled" ? (input.splits.get(fundId) ?? null) : null,
    mode,
    allocations: allocationRefs(input),
    exits: new Map(input.earlyExits.map((exit) => [exit.ledgerEntryId, exit.scheduleId] as const)),
    parts: partsByEntry(input.growthParts),
  })
  return pass.run(ordered)
}
