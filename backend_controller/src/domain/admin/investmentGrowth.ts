import { createHash } from "node:crypto"

import { AppError } from "../../http/errorCatalog.js"
import { refKey, type InvestmentRef } from "../client/investmentBreakdownFacts.js"
import { symmetricHalfUpBasisPoints } from "../shared/moneyRounding.js"
import { MAX_COLLECTIVE_CLIENT_TARGETS, MAX_GROWTH_BASIS_POINTS, MIN_GROWTH_BASIS_POINTS } from "./clientGrowth.js"

export interface InvestmentBasis {
  readonly userId: string
  readonly fundId: string
  readonly ref: InvestmentRef
  readonly investedPaise: bigint
  readonly valuePaise: bigint
  readonly holdsNothing: boolean
}

export interface PositionGrowthBasis {
  readonly userId: string
  readonly fundId: string
  readonly valuePaise: bigint
  readonly latestEntryId: string | null
  readonly categoriseFirst: boolean
}

export interface InvestmentGrowthBases {
  readonly positions: readonly PositionGrowthBasis[]
  readonly investments: readonly InvestmentBasis[]
}

export interface InvestmentTarget {
  readonly userId: string
  readonly ref: InvestmentRef
}

export interface InvestmentGainItem extends InvestmentTarget {
  readonly gainSinceInvestedPaise: bigint
}

export type InvestmentGrowthInstruction =
  | Readonly<{ kind: "percentage"; growthBasisPoints: bigint; target: InvestmentTarget | null }>
  | Readonly<{ kind: "amount"; growthPaise: bigint; target: InvestmentTarget }>
  | Readonly<{ kind: "gain_since_invested"; items: readonly InvestmentGainItem[] }>

export interface PlannedInvestmentPart {
  readonly ref: InvestmentRef
  readonly investedPaise: bigint
  readonly beforePaise: bigint
  readonly deltaPaise: bigint
  readonly afterPaise: bigint
}

export interface PlannedInvestmentEntry {
  readonly userId: string
  readonly fundId: string
  readonly beforePaise: bigint
  readonly deltaPaise: bigint
  readonly afterPaise: bigint
  readonly parts: readonly PlannedInvestmentPart[]
}

export type InvestmentGrowthSkipReason = "categorise_first" | "zero_invested" | "unchanged"

export interface InvestmentGrowthSkip {
  readonly userId: string
  readonly ref: InvestmentRef | null
  readonly reason: InvestmentGrowthSkipReason
}

export interface InvestmentGrowthPlan {
  readonly entries: readonly PlannedInvestmentEntry[]
  readonly skipped: readonly InvestmentGrowthSkip[]
  readonly totalDeltaPaise: bigint
}

export const CATEGORISE_FIRST_MESSAGE =
  "Sort this client's investments first: categorise their recordings and confirm any earlier growth split in the Ledger tab."

const invalid = (field: string, message: string): AppError =>
  new AppError("VALIDATION_FAILED", { fields: { [field]: [message] } })

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const targetKey = (userId: string, ref: InvestmentRef): string => `${userId}|${refKey(ref)}`

const assertRate = (growthBasisPoints: bigint): void => {
  if (
    growthBasisPoints === 0n ||
    growthBasisPoints < BigInt(MIN_GROWTH_BASIS_POINTS) ||
    growthBasisPoints > BigInt(MAX_GROWTH_BASIS_POINTS)
  ) {
    throw invalid(
      "growthBasisPoints",
      `Must be a non-zero rate between ${String(MIN_GROWTH_BASIS_POINTS)} and ${String(MAX_GROWTH_BASIS_POINTS)} basis points.`,
    )
  }
}

interface IndexedBases {
  readonly positions: ReadonlyMap<string, PositionGrowthBasis>
  readonly investments: ReadonlyMap<string, InvestmentBasis>
  readonly byUser: ReadonlyMap<string, readonly InvestmentBasis[]>
}

const indexBases = (bases: InvestmentGrowthBases): IndexedBases => {
  const byUser = new Map<string, InvestmentBasis[]>()
  for (const investment of bases.investments) {
    byUser.set(investment.userId, [...(byUser.get(investment.userId) ?? []), investment])
  }
  return {
    positions: new Map(bases.positions.map((position) => [position.userId, position] as const)),
    investments: new Map(bases.investments.map((investment) => [targetKey(investment.userId, investment.ref), investment] as const)),
    byUser,
  }
}

const targetOf = (indexed: IndexedBases, target: InvestmentTarget, field: string): InvestmentBasis => {
  const investment = indexed.investments.get(targetKey(target.userId, target.ref))
  if (investment === undefined || !indexed.positions.has(target.userId)) {
    throw invalid(field, "Every target must be an investment of this client in the selected fund.")
  }
  return investment
}

const partOf = (investment: InvestmentBasis, deltaPaise: bigint): PlannedInvestmentPart => {
  const afterPaise = investment.valuePaise + deltaPaise
  if (afterPaise < 0n) throw invalid("growth", "The adjustment would make an investment's value negative.")
  return {
    ref: investment.ref,
    investedPaise: investment.investedPaise,
    beforePaise: investment.valuePaise,
    deltaPaise,
    afterPaise,
  }
}

const entryOf = (position: PositionGrowthBasis, parts: readonly PlannedInvestmentPart[]): PlannedInvestmentEntry => {
  const deltaPaise = parts.reduce((sum, part) => sum + part.deltaPaise, 0n)
  const afterPaise = position.valuePaise + deltaPaise
  if (afterPaise < 0n) throw invalid("growth", "The adjustment would make the client value negative.")
  return {
    userId: position.userId,
    fundId: position.fundId,
    beforePaise: position.valuePaise,
    deltaPaise,
    afterPaise,
    parts: [...parts].sort((left, right) => compareText(refKey(left.ref), refKey(right.ref))),
  }
}

const planTargeted = (
  indexed: IndexedBases,
  target: InvestmentTarget,
  deltaOf: (investment: InvestmentBasis) => bigint,
): InvestmentGrowthPlan => {
  const investment = targetOf(indexed, target, "ref")
  if (investment.holdsNothing) throw invalid("ref", "This SIP holds nothing, so it cannot take growth.")
  const position = indexed.positions.get(target.userId)
  if (position === undefined) throw invalid("ref", "Every target must be an investment of this client in the selected fund.")
  if (position.categoriseFirst) throw new AppError("STATE_CONFLICT", { message: CATEGORISE_FIRST_MESSAGE })
  const deltaPaise = deltaOf(investment)
  if (deltaPaise === 0n) throw invalid("growthBasisPoints", "The rate rounds to a zero adjustment for this investment.")
  const entry = entryOf(position, [partOf(investment, deltaPaise)])
  return { entries: [entry], skipped: [], totalDeltaPaise: entry.deltaPaise }
}

const rateDelta = (growthBasisPoints: bigint) => (investment: InvestmentBasis): bigint => {
  if (investment.investedPaise <= 0n) {
    throw invalid("growthBasisPoints", "A rate needs an invested amount to measure against. Use an exact amount instead.")
  }
  return symmetricHalfUpBasisPoints(investment.investedPaise, growthBasisPoints)
}

const assertTargetCount = (entries: readonly PlannedInvestmentEntry[]): void => {
  if (entries.length > MAX_COLLECTIVE_CLIENT_TARGETS) {
    throw invalid("fundId", `The update reaches more than ${String(MAX_COLLECTIVE_CLIENT_TARGETS)} clients.`)
  }
}

const skipKey = (skip: InvestmentGrowthSkip): string => `${skip.userId}|${skip.ref === null ? "" : refKey(skip.ref)}`

type PartOutcome = Readonly<{ part: PlannedInvestmentPart } | { skip: InvestmentGrowthSkip }>

const outcomeOf = (investment: InvestmentBasis, deltaPaise: bigint): PartOutcome => {
  if (investment.holdsNothing || investment.investedPaise <= 0n) {
    return { skip: { userId: investment.userId, ref: investment.ref, reason: "zero_invested" } }
  }
  if (deltaPaise === 0n) return { skip: { userId: investment.userId, ref: investment.ref, reason: "unchanged" } }
  return { part: partOf(investment, deltaPaise) }
}

const collect = (
  position: PositionGrowthBasis,
  outcomes: readonly PartOutcome[],
  entries: PlannedInvestmentEntry[],
  skipped: InvestmentGrowthSkip[],
): void => {
  const parts = outcomes.flatMap((outcome) => ("part" in outcome ? [outcome.part] : []))
  skipped.push(...outcomes.flatMap((outcome) => ("skip" in outcome ? [outcome.skip] : [])))
  if (parts.length === 0) return
  if (parts.reduce((sum, part) => sum + part.deltaPaise, 0n) === 0n) {
    skipped.push({ userId: position.userId, ref: null, reason: "unchanged" })
    return
  }
  entries.push(entryOf(position, parts))
}

const finish = (entries: PlannedInvestmentEntry[], skipped: InvestmentGrowthSkip[]): InvestmentGrowthPlan => {
  assertTargetCount(entries)
  const sortedEntries = entries.sort((left, right) => compareText(left.userId, right.userId))
  return {
    entries: sortedEntries,
    skipped: skipped.sort((left, right) => compareText(skipKey(left), skipKey(right))),
    totalDeltaPaise: sortedEntries.reduce((sum, entry) => sum + entry.deltaPaise, 0n),
  }
}

const planFundRate = (indexed: IndexedBases, growthBasisPoints: bigint): InvestmentGrowthPlan => {
  const entries: PlannedInvestmentEntry[] = []
  const skipped: InvestmentGrowthSkip[] = []
  for (const position of indexed.positions.values()) {
    if (position.categoriseFirst) {
      skipped.push({ userId: position.userId, ref: null, reason: "categorise_first" })
      continue
    }
    const outcomes = (indexed.byUser.get(position.userId) ?? [])
      .map((investment) => outcomeOf(investment, symmetricHalfUpBasisPoints(investment.investedPaise, growthBasisPoints)))
    collect(position, outcomes, entries, skipped)
  }
  return finish(entries, skipped)
}

const groupItems = (items: readonly InvestmentGainItem[]): ReadonlyMap<string, readonly InvestmentGainItem[]> => {
  const seen = new Set<string>()
  const grouped = new Map<string, InvestmentGainItem[]>()
  for (const item of items) {
    const key = targetKey(item.userId, item.ref)
    if (seen.has(key)) throw invalid("items", "Each investment may appear only once.")
    seen.add(key)
    grouped.set(item.userId, [...(grouped.get(item.userId) ?? []), item])
  }
  return grouped
}

const planGains = (indexed: IndexedBases, items: readonly InvestmentGainItem[]): InvestmentGrowthPlan => {
  if (items.length === 0) throw invalid("items", "Must list at least one investment.")
  const entries: PlannedInvestmentEntry[] = []
  const skipped: InvestmentGrowthSkip[] = []
  for (const [userId, userItems] of groupItems(items)) {
    const position = indexed.positions.get(userId)
    if (position === undefined) throw invalid("items", "Every target must be an investment of this client in the selected fund.")
    if (position.categoriseFirst) {
      skipped.push({ userId, ref: null, reason: "categorise_first" })
      continue
    }
    const outcomes = userItems.map((item) => {
      const investment = targetOf(indexed, item, "items")
      return outcomeOf(investment, investment.investedPaise + item.gainSinceInvestedPaise - investment.valuePaise)
    })
    collect(position, outcomes, entries, skipped)
  }
  return finish(entries, skipped)
}

export const planInvestmentGrowth = (
  bases: InvestmentGrowthBases,
  instruction: InvestmentGrowthInstruction,
): InvestmentGrowthPlan => {
  const indexed = indexBases(bases)
  if (instruction.kind === "amount") {
    if (instruction.growthPaise === 0n) throw invalid("growthPaise", "Must be a non-zero signed paise amount.")
    return planTargeted(indexed, instruction.target, () => instruction.growthPaise)
  }
  if (instruction.kind === "percentage") {
    assertRate(instruction.growthBasisPoints)
    return instruction.target === null
      ? planFundRate(indexed, instruction.growthBasisPoints)
      : planTargeted(indexed, instruction.target, rateDelta(instruction.growthBasisPoints))
  }
  return planGains(indexed, instruction.items)
}

export const computeInvestmentGrowthBasisHash = (command: string, fundId: string, bases: InvestmentGrowthBases): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        command,
        fundId,
        positions: [...bases.positions]
          .sort((left, right) => compareText(left.userId, right.userId))
          .map((position) => [position.userId, position.valuePaise.toString(), position.latestEntryId, position.categoriseFirst]),
        investments: [...bases.investments]
          .sort((left, right) => compareText(targetKey(left.userId, left.ref), targetKey(right.userId, right.ref)))
          .map((investment) => [
            targetKey(investment.userId, investment.ref),
            investment.investedPaise.toString(),
            investment.valuePaise.toString(),
            investment.holdsNothing,
          ]),
      }),
    )
    .digest("hex")
