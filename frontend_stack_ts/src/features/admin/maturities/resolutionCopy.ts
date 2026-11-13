import type { MaturityResolution } from "./maturityQueries"

export type Choice = "return_all" | "one_time_and_sip" | "sip_reinvestment"

export type HoldingFigures = Readonly<{ principalPaise: string; currentValuePaise: string }>

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
  return `No money moved and the holding is unchanged. The new SIP schedule has started.${replaced}`
}
