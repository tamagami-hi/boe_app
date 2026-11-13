import { formatINR, toPaise } from "~/domain/money"

import { formatMaturityDate } from "./maturityPresentation"
import type { MaturityResolution } from "./maturityQueries"

export type Choice = "return_all" | "one_time_and_sip" | "sip_extension"

export type HoldingFigures = Readonly<{ principalPaise: string; currentValuePaise: string }>

export type ActiveSip = Readonly<{ monthlyAmountPaise: string; monthsPaid: number; monthCount: number }>

export const money = (paise: string): string => formatINR(toPaise(paise), { showDecimals: true })

export const gainOf = (holding: HoldingFigures): bigint =>
  BigInt(holding.currentValuePaise) - BigInt(holding.principalPaise)

export const explanationOf = (choice: Choice, holding: HoldingFigures | null): string => {
  if (choice === "return_all") {
    return `Records a withdrawal of the whole current value${holding === null ? "" : `, ${money(holding.currentValuePaise)}`}, and a pending payout. The app does not send money: make the bank transfer yourself, then mark the payout paid in the Maturity tab. The holding becomes zero.`
  }
  if (choice === "one_time_and_sip") {
    const gain = holding === null ? 0n : gainOf(holding)
    const effect =
      gain === 0n
        ? "The value already equals the amount invested, so no ledger entry is written."
        : gain > 0n
          ? `The gain of ${money(gain.toString())} is added to the amount invested.`
          : `The value is ${money((-gain).toString())} below the amount invested, so confirming writes that loss into the amount invested.`
    return `The current value becomes the amount invested from the settlement date. ${effect} Nothing is paid out. Any active SIP schedule shown below is closed, and the new one starts as entered; nothing is collected automatically.`
  }
  return "Nothing is paid out and no ledger entry is written: the holding keeps its value and its amount invested. The active SIP schedule shown below gets the extra months, and a new maturity date is set for this holding. Record each month's payment when the client pays."
}

export const resolutionOutcomeText = (result: MaturityResolution): string => {
  const replaced = result.closedSipScheduleId === null ? "" : " The earlier SIP schedule for this fund was closed."
  if (result.schedule.resolution === "return_all") {
    return "The withdrawal and a pending payout are recorded. Make the bank transfer, then mark the payout paid in the Maturity tab."
  }
  if (result.schedule.resolution === "one_time_and_sip") {
    const ledger =
      result.settlementEntryId === null
        ? "The value already equalled the amount invested, so no ledger entry was needed."
        : "The matured value is now the amount invested."
    return `${ledger} The new SIP schedule has started.${replaced}`
  }
  return result.nextScheduleId === null
    ? "No money moved and the holding is unchanged."
    : "No money moved and the holding is unchanged. The SIP schedule has the extra months, and the next maturity date is set."
}

export const extensionSummary = (extension: Readonly<{ months: number; nextMaturityDate: string }>): string =>
  `Add ${String(extension.months)} ${extension.months === 1 ? "month" : "months"} to the SIP; next maturity ${formatMaturityDate(extension.nextMaturityDate)}`
