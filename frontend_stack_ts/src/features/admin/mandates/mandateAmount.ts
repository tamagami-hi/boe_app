import { MoneyFormatError, toPaise } from "~/domain/money"
import type { Paise } from "~/domain/money"

export const mandatePaise = (amountPaise: number): Paise => {
  if (!Number.isSafeInteger(amountPaise)) {
    throw new MoneyFormatError("Mandate amount is not a whole number of paise")
  }
  return toPaise(String(amountPaise))
}
