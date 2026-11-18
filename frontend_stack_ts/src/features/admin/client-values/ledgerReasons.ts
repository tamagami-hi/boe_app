import { GROWTH_REASON_OPTIONS } from "./growthReasons"
import { RECORDING_CATEGORIES } from "./recordingCategories"

const REASON_LABEL: Readonly<Record<string, string>> = {
  ...Object.fromEntries(RECORDING_CATEGORIES.map((category) => [category.value, category.label])),
  ...Object.fromEntries(GROWTH_REASON_OPTIONS.map((option) => [option.value, `${option.label} value update`])),
  admin_correction_reversal: "Admin correction",
  sip_early_exit: "SIP early exit",
  maturity_withdrawal: "Maturity withdrawal",
  maturity_reinvestment: "Maturity reinvestment",
  verified_payment_received: "Online payment",
}

const sentenceOf = (code: string): string => {
  const words = code.replace(/[_-]+/gu, " ").trim()
  return words === "" ? code : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

export const ledgerReasonLabel = (code: string): string => REASON_LABEL[code] ?? sentenceOf(code)
