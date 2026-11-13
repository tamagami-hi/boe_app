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
