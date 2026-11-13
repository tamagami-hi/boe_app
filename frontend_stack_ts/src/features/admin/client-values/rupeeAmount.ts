import { MoneyFormatError, rupeeTextToPaise } from "~/domain/money"
import type { Paise } from "~/domain/money"

export const parsePositiveRupees = (text: string): Paise | null => {
  if (text === "") return null
  try {
    const paise = rupeeTextToPaise(text)
    return paise === "0" ? null : paise
  } catch (error) {
    if (error instanceof MoneyFormatError) return null
    throw error
  }
}

export const paiseToRupeeText = (paise: string): string => {
  const padded = paise.padStart(3, "0")
  const fraction = padded.slice(-2)
  return fraction === "00" ? padded.slice(0, -2) : `${padded.slice(0, -2)}.${fraction}`
}
