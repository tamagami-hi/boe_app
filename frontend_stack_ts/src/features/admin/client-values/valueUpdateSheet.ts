import { MoneyFormatError, rupeeTextToPaise } from "~/domain/money"

export const MAX_SHEET_CHANGES = 500

export type SheetPosition = Readonly<{
  userId: string
  fullName: string
  investedPaise: string
  currentValuePaise: string
  gainPaise: string
}>

export type SheetChange = Readonly<{ userId: string; growthPaise: string }>

export type RowPlan =
  | Readonly<{ kind: "unchanged" }>
  | Readonly<{ kind: "invalid"; message: string }>
  | Readonly<{ kind: "change"; changePaise: string; newValuePaise: string }>

export type SheetPlan = Readonly<{
  rows: ReadonlyMap<string, RowPlan>
  changes: readonly SheetChange[]
  invalidCount: number
  totalChangePaise: string
}>

export type PreviewTarget = Readonly<{
  userId: string
  principalPaise: string
  beforePaise: string
  deltaPaise: string
}>

const UNCHANGED: RowPlan = { kind: "unchanged" }

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

export const planRow = (position: SheetPosition, text: string): RowPlan => {
  if (text.trim() === "") return UNCHANGED
  const newGain = parseGainRupees(text)
  if (newGain === null) return { kind: "invalid", message: FORMAT_MESSAGE }
  const change = newGain - BigInt(position.gainPaise)
  if (change === 0n) return UNCHANGED
  if (BigInt(position.currentValuePaise) <= 0n) return { kind: "invalid", message: NO_VALUE_MESSAGE }
  const newValue = BigInt(position.investedPaise) + newGain
  if (newValue < 0n) return { kind: "invalid", message: BELOW_ZERO_MESSAGE }
  return { kind: "change", changePaise: change.toString(), newValuePaise: newValue.toString() }
}

export const planSheet = (
  positions: readonly SheetPosition[],
  inputs: Readonly<Record<string, string>>,
): SheetPlan => {
  const planned = positions.map(
    (position) => [position.userId, planRow(position, inputs[position.userId] ?? "")] as const,
  )
  const changes = planned.flatMap(([userId, row]) =>
    row.kind === "change" ? [{ userId, growthPaise: row.changePaise }] : [],
  )
  return {
    rows: new Map(planned),
    changes,
    invalidCount: planned.filter(([, row]) => row.kind === "invalid").length,
    totalChangePaise: changes.reduce((sum, change) => sum + BigInt(change.growthPaise), 0n).toString(),
  }
}

export const previewMatchesSheet = (
  positions: readonly SheetPosition[],
  changes: readonly SheetChange[],
  targets: readonly PreviewTarget[],
): boolean => {
  if (targets.length !== changes.length) return false
  const byUser = new Map(positions.map((position) => [position.userId, position]))
  const deltas = new Map(changes.map((change) => [change.userId, change.growthPaise]))
  return targets.every((target) => {
    const position = byUser.get(target.userId)
    return (
      position !== undefined &&
      deltas.get(target.userId) === target.deltaPaise &&
      position.investedPaise === target.principalPaise &&
      position.currentValuePaise === target.beforePaise
    )
  })
}
