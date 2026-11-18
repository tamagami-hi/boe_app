import { MoneyFormatError, applyBasisPoints, rupeeTextToPaise, toPaise } from "~/domain/money"

import { isTargetable, mustCategoriseFirst, refKey } from "./investmentGrowthApi"
import type {
  AdminClientInvestmentsData,
  InvestmentGainItem,
  InvestmentGrowthCommitBody,
  InvestmentGrowthEntry,
  InvestmentGrowthSkip,
  InvestmentRef,
} from "./investmentGrowthApi"
import { paiseToRupeeText } from "./rupeeAmount"

export const MAX_SHEET_CHANGES = 500

export const MIN_FUND_RATE_BASIS_POINTS = -10_000
export const MAX_FUND_RATE_BASIS_POINTS = 10_000

export type SheetPosition = Readonly<{
  userId: string
  fullName: string
  accountState: string
  investedPaise: string
  currentValuePaise: string
  gainPaise: string
}>

export type SheetRow = Readonly<{
  rowKey: string
  userId: string
  fullName: string
  accountState: string
  ref: InvestmentRef | null
  label: string
  date: string | null
  investedPaise: string
  positionValuePaise: string
  categoriseFirst: boolean
}>

export type SheetChange = Readonly<{
  rowKey: string
  userId: string
  ref: InvestmentRef
  gainSinceInvestedPaise: string
}>

export type RowPlan =
  | Readonly<{ kind: "unchanged" }>
  | Readonly<{ kind: "categorise_first" }>
  | Readonly<{ kind: "no_target" }>
  | Readonly<{ kind: "invalid"; message: string }>
  | Readonly<{ kind: "set"; gainSinceInvestedPaise: string; newValuePaise: string }>

export type SheetPlan = Readonly<{
  rows: ReadonlyMap<string, RowPlan>
  changes: readonly SheetChange[]
  invalidCount: number
  skippedRowCount: number
  skippedClientCount: number
}>

const UNCHANGED: RowPlan = { kind: "unchanged" }
const CATEGORISE_FIRST: RowPlan = { kind: "categorise_first" }
const NO_TARGET: RowPlan = { kind: "no_target" }

export const FORMAT_MESSAGE = "Enter rupees with at most two decimals, for example 1250.50 or -300."
export const NO_VALUE_MESSAGE = "This position has no value left, so a value update cannot apply to it."
export const BELOW_ZERO_MESSAGE = "This gain would take the value below zero."

export const parseGainRupees = (text: string): bigint | null => {
  const trimmed = text.trim()
  const negative = trimmed.startsWith("-")
  try {
    const paise = BigInt(rupeeTextToPaise(negative ? trimmed.slice(1) : trimmed))
    return negative ? -paise : paise
  } catch (error) {
    if (error instanceof MoneyFormatError) return null
    throw error
  }
}

export const signedRupeeText = (paise: bigint): string =>
  paise < 0n ? `-${paiseToRupeeText((-paise).toString())}` : paiseToRupeeText(paise.toString())

export const planRow = (row: SheetRow, text: string): RowPlan => {
  if (text.trim() === "") return UNCHANGED
  const gain = parseGainRupees(text)
  if (gain === null) return { kind: "invalid", message: FORMAT_MESSAGE }
  if (BigInt(row.positionValuePaise) <= 0n) return { kind: "invalid", message: NO_VALUE_MESSAGE }
  const newValue = BigInt(row.investedPaise) + gain
  if (newValue < 0n) return { kind: "invalid", message: BELOW_ZERO_MESSAGE }
  return { kind: "set", gainSinceInvestedPaise: gain.toString(), newValuePaise: newValue.toString() }
}

const isAddressable = (row: SheetRow): row is SheetRow & Readonly<{ ref: InvestmentRef }> =>
  row.ref !== null && !row.categoriseFirst

const planFor = (row: SheetRow, inputs: Readonly<Record<string, string>>): RowPlan =>
  row.categoriseFirst ? CATEGORISE_FIRST : isAddressable(row) ? planRow(row, inputs[row.rowKey] ?? "") : NO_TARGET

export const planSheet = (rows: readonly SheetRow[], inputs: Readonly<Record<string, string>>): SheetPlan => {
  const planned = rows.map((row) => [row, planFor(row, inputs)] as const)
  const changes = planned.flatMap(([row, plan]) =>
    plan.kind === "set" && isAddressable(row)
      ? [{ rowKey: row.rowKey, userId: row.userId, ref: row.ref, gainSinceInvestedPaise: plan.gainSinceInvestedPaise }]
      : [],
  )
  const skipped = planned.filter(([, plan]) => plan.kind === "categorise_first").map(([row]) => row.userId)
  return {
    rows: new Map(planned.map(([row, plan]) => [row.rowKey, plan])),
    changes,
    invalidCount: planned.filter(([, plan]) => plan.kind === "invalid").length,
    skippedRowCount: skipped.length,
    skippedClientCount: new Set(skipped).size,
  }
}

export const parseFundRate = (text: string): number | null => {
  if (!/^-?\d+$/u.test(text.trim())) return null
  const rate = Number(text.trim())
  return Number.isSafeInteger(rate) && rate >= MIN_FUND_RATE_BASIS_POINTS && rate <= MAX_FUND_RATE_BASIS_POINTS
    ? rate
    : null
}

export const prefillFromRate = (rows: readonly SheetRow[], basisPoints: number): Readonly<Record<string, string>> =>
  Object.fromEntries(
    rows
      .filter((row) => isAddressable(row) && BigInt(row.investedPaise) > 0n)
      .map((row) => [row.rowKey, signedRupeeText(BigInt(applyBasisPoints(toPaise(row.investedPaise), basisPoints)))]),
  )

export const overrideRow = (
  inputs: Readonly<Record<string, string>>,
  rowKey: string,
  text: string,
): Readonly<Record<string, string>> => ({ ...inputs, [rowKey]: text })

export const commitItemsOf = (changes: readonly SheetChange[]): InvestmentGainItem[] =>
  changes.map(({ userId, ref, gainSinceInvestedPaise }) => ({ userId, ref, gainSinceInvestedPaise }))

export type SheetCommitMeta = Readonly<{
  basisHash: string
  effectiveDate: string
  reasonCode: string
  note: string
}>

export const sheetCommitBody = (
  fundId: string,
  changes: readonly SheetChange[],
  meta: SheetCommitMeta,
): InvestmentGrowthCommitBody => {
  const note = meta.note.trim()
  return {
    fundId,
    items: commitItemsOf(changes),
    basisHash: meta.basisHash,
    effectiveDate: meta.effectiveDate,
    reasonCode: meta.reasonCode,
    ...(note === "" ? {} : { note }),
  }
}

const rowKeyOf = (userId: string, ref: InvestmentRef | null): string =>
  `${userId}|${ref === null ? "position" : refKey(ref)}`

export const sheetRowsFrom = (
  positions: readonly SheetPosition[],
  investments: ReadonlyMap<string, AdminClientInvestmentsData>,
  fundId: string,
  flaggedByServer: ReadonlySet<string>,
): SheetRow[] =>
  positions.flatMap((position): SheetRow[] => {
    const fund = investments.get(position.userId)?.funds.find((item) => item.fundId === fundId)
    const base = {
      userId: position.userId,
      fullName: position.fullName,
      accountState: position.accountState,
      positionValuePaise: position.currentValuePaise,
    }
    const categoriseFirst = flaggedByServer.has(position.userId) || (fund !== undefined && mustCategoriseFirst(fund))
    const live = (fund?.investments ?? []).filter(isTargetable)
    if (live.length === 0) {
      const label = fund?.uncategorised[0]?.reasonLabel ?? ""
      return [{ ...base, rowKey: rowKeyOf(position.userId, null), ref: null, label, date: null, investedPaise: position.investedPaise, categoriseFirst }]
    }
    return live.map((item) => ({
      ...base,
      rowKey: rowKeyOf(position.userId, item.ref),
      ref: item.ref,
      label: item.label,
      date: item.date,
      investedPaise: item.amountPaise,
      categoriseFirst,
    }))
  })

const partSum = (entry: InvestmentGrowthEntry): bigint =>
  entry.parts.reduce((sum, part) => sum + BigInt(part.deltaPaise), 0n)

const isSkipped = (change: SheetChange, skipped: readonly InvestmentGrowthSkip[]): boolean =>
  skipped.some(
    (skip) => skip.userId === change.userId && (skip.ref === null || refKey(skip.ref) === refKey(change.ref)),
  )

export const skippedChangesOf = (
  changes: readonly SheetChange[],
  skipped: readonly InvestmentGrowthSkip[],
): SheetChange[] => changes.filter((change) => isSkipped(change, skipped))

const sameKeys = (left: readonly string[], right: readonly string[]): boolean => {
  const rightSet = new Set(right)
  return new Set(left).size === left.length && rightSet.size === right.length && left.length === right.length && left.every((key) => rightSet.has(key))
}

export const previewMatchesSheet = (
  rows: readonly SheetRow[],
  changes: readonly SheetChange[],
  entries: readonly InvestmentGrowthEntry[],
  skipped: readonly InvestmentGrowthSkip[],
): boolean => {
  const parts = entries.flatMap((entry) => entry.parts.map((part) => ({ userId: entry.userId, part })))
  const expected = changes
    .filter((change) => !isSkipped(change, skipped))
    .map((change) => rowKeyOf(change.userId, change.ref))
  if (parts.length === 0 || !sameKeys(parts.map(({ userId, part }) => rowKeyOf(userId, part.ref)), expected)) return false
  if (entries.some((entry) => partSum(entry) !== BigInt(entry.deltaPaise))) return false
  const byKey = new Map(rows.map((row) => [rowKeyOf(row.userId, row.ref), row]))
  const gains = new Map(changes.map((change) => [rowKeyOf(change.userId, change.ref), change.gainSinceInvestedPaise]))
  return parts.every(({ userId, part }) => {
    const key = rowKeyOf(userId, part.ref)
    const row = byKey.get(key)
    const gain = gains.get(key)
    return (
      row !== undefined &&
      gain !== undefined &&
      row.investedPaise === part.investedPaise &&
      BigInt(part.afterPaise) - BigInt(part.investedPaise) === BigInt(gain) &&
      BigInt(part.beforePaise) + BigInt(part.deltaPaise) === BigInt(part.afterPaise)
    )
  })
}
