import { formatDate, formatYearMonth } from "~/domain/dates"
import { formatINR, toPaise } from "~/domain/money"

import type { MaturityOffer, MaturityOptionKey } from "./maturityOptionQueries"

export const OPTION_TITLES: Readonly<Record<MaturityOptionKey, string>> = {
  return_all: "Withdraw your money",
  one_time_and_sip: "Keep it invested and start a new monthly investment",
  sip_extension: "Extend your monthly investment",
}

export const calendarDate = (value: string): string => formatDate(`${value}T00:00:00Z`)

const plural = (count: number, unit: string): string => `${String(count)} ${unit}${count === 1 ? "" : "s"}`

export const optionDetail = (option: MaturityOptionKey, offer: MaturityOffer): string => {
  if (option === "return_all") {
    return "The BeOnEdge team returns the current value of this investment to you."
  }
  if (option === "one_time_and_sip") {
    const amount = formatINR(toPaise(offer.sip.monthlyAmountPaise), { showDecimals: true })
    return `Your current value stays invested as a one-time investment. Then a monthly investment of ${amount} for ${plural(offer.sip.monthCount, "month")} starts in ${formatYearMonth(offer.sip.startMonth)}.`
  }
  if (offer.extension === null) return ""
  return `Add ${plural(offer.extension.months, "month")} to your monthly investment plan. Your next maturity date would be ${calendarDate(offer.extension.nextMaturityDate)}.`
}

export const optionsOf = (offer: MaturityOffer): readonly MaturityOptionKey[] =>
  offer.extension === null ? ["return_all", "one_time_and_sip"] : ["return_all", "one_time_and_sip", "sip_extension"]

export const isOptionKey = (value: string | null): value is MaturityOptionKey =>
  value === "return_all" || value === "one_time_and_sip" || value === "sip_extension"

export const closedOfferText = (offer: MaturityOffer): string => {
  if (offer.state === "confirmed" && isOptionKey(offer.chosenOption)) {
    return `The BeOnEdge team confirmed your choice: ${OPTION_TITLES[offer.chosenOption].toLowerCase()}.`
  }
  return "These options are no longer open. The BeOnEdge team may have sent you new ones, so check your notifications."
}
