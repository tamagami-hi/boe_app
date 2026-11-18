import { addPaise, subtractPaise, toPaise, type Paise } from "~/domain/money"

import { parseRupees } from "./rupeeAmount"

export type SplitTarget<TRef> = Readonly<{ ref: TRef; amountPaise: string }>

export type SplitTally = Readonly<{
  sumPaise: Paise | null
  remainingPaise: Paise | null
  canConfirm: boolean
}>

export type SplitBody<TRef> = Readonly<{ cutoffEntryId: string; parts: readonly SplitTarget<TRef>[] }>

const ZERO = toPaise("0")

export const parseSignedRupees = (text: string): Paise | null => {
  const trimmed = text.trim()
  const isNegative = trimmed.startsWith("-")
  const magnitude = parseRupees(isNegative ? trimmed.slice(1) : trimmed)
  if (magnitude === null) return null
  return isNegative && magnitude !== "0" ? toPaise(`-${magnitude}`) : magnitude
}

export const signedRupeeText = (paise: string): string => {
  const isNegative = paise.startsWith("-")
  const digits = (isNegative ? paise.slice(1) : paise).padStart(3, "0")
  const fraction = digits.slice(-2)
  const whole = digits.slice(0, -2)
  const text = fraction === "00" ? whole : `${whole}.${fraction}`
  return isNegative ? `-${text}` : text
}

export const tallySplit = (totalPaise: string, texts: readonly string[]): SplitTally => {
  const parts = texts.map(parseSignedRupees)
  if (parts.length === 0 || parts.some((part) => part === null)) {
    return { sumPaise: null, remainingPaise: null, canConfirm: false }
  }
  const sumPaise = parts.reduce<Paise>((sum, part) => addPaise(sum, part ?? ZERO), ZERO)
  const remainingPaise = subtractPaise(toPaise(totalPaise), sumPaise)
  return { sumPaise, remainingPaise, canConfirm: remainingPaise === ZERO }
}

export const splitBodyOf = <TRef>(
  cutoffEntryId: string,
  totalPaise: string,
  refs: readonly TRef[],
  texts: readonly string[],
): SplitBody<TRef> | null => {
  if (refs.length !== texts.length || !tallySplit(totalPaise, texts).canConfirm) return null
  return {
    cutoffEntryId,
    parts: refs
      .map((ref, index) => ({ ref, amountPaise: parseSignedRupees(texts[index] ?? "") ?? ZERO }))
      .filter((part) => part.amountPaise !== ZERO),
  }
}
