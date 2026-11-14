import { MoneyFormatError, rupeeTextToPaise } from "~/domain/money"
import type { Paise } from "~/domain/money"

const readRupees = (text: string): Paise | null => {
  if (text === "") return null
  try {
    return rupeeTextToPaise(text)
  } catch (error) {
    if (error instanceof MoneyFormatError) return null
    throw error
  }
}

export const parseRupees = (text: string): Paise | null => readRupees(text)

export const parsePositiveRupees = (text: string): Paise | null => {
  const paise = readRupees(text)
  return paise === "0" ? null : paise
}

export const parseNonZeroSignedRupees = (text: string): string | null => {
  const isNegative = text.startsWith("-")
  const magnitude = parsePositiveRupees(isNegative ? text.slice(1) : text)
  if (magnitude === null) return null
  return isNegative ? `-${magnitude}` : magnitude
}

export const parseRupeesToSafePaise = (text: string): number | null => {
  const paise = readRupees(text)
  if (paise === null || BigInt(paise) > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(paise)
}

export const paiseToRupeeText = (paise: string): string => {
  const padded = paise.padStart(3, "0")
  const fraction = padded.slice(-2)
  return fraction === "00" ? padded.slice(0, -2) : `${padded.slice(0, -2)}.${fraction}`
}
