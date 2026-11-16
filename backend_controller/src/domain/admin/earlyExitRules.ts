import type { AdminSipScheduleState } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"

export type SipEarlyExitRefusal =
  | "schedule_closed"
  | "already_closed_early"
  | "no_value"
  | "principal_below_zero"
  | "maturity_settling"
  | "maturity_due"
  | "later_entry"

export interface OpenMaturityFact {
  readonly maturityDate: string
  readonly hasClientChoice: boolean
}

export interface SipEarlyExitFacts {
  readonly scheduleState: AdminSipScheduleState
  readonly wasClosedEarly: boolean
  readonly principalPaise: bigint
  readonly currentValuePaise: bigint
  readonly hasMarkedMaturity: boolean
  readonly openMaturity: OpenMaturityFact | null
  readonly latestEntryDate: string | null
  readonly today: string
}

export const SIP_EARLY_EXIT_REFUSALS: Readonly<Record<SipEarlyExitRefusal, string>> = {
  schedule_closed: "This SIP schedule is already closed, so it cannot be closed early.",
  already_closed_early: "This SIP schedule was closed early before, so it cannot be closed early again.",
  no_value: "This client's holding in this fund has no value to return.",
  principal_below_zero:
    "This holding's invested amount is below zero. Put it right with a correction recording before closing the SIP early.",
  maturity_settling:
    "A maturity on this holding is being settled: it is marked as matured, or the client chose a maturity option that waits for confirmation. Finish or cancel that first.",
  maturity_due: "This holding's maturity date has arrived. Resolve the maturity instead of closing the SIP early.",
  later_entry: "The holding's latest entry is dated after today. An early exit is dated today, so it cannot be recorded yet.",
}

export const VALUE_CHANGED_MESSAGE = "The holding's value changed since you opened it. Reload and confirm the new amount."

export const sipEarlyExitRefusal = (facts: SipEarlyExitFacts): SipEarlyExitRefusal | null => {
  if (facts.scheduleState !== "active") return "schedule_closed"
  if (facts.wasClosedEarly) return "already_closed_early"
  if (facts.currentValuePaise <= 0n) return "no_value"
  if (facts.principalPaise < 0n) return "principal_below_zero"
  if (facts.hasMarkedMaturity || facts.openMaturity?.hasClientChoice === true) return "maturity_settling"
  if (facts.openMaturity !== null && facts.openMaturity.maturityDate <= facts.today) return "maturity_due"
  if (facts.latestEntryDate !== null && facts.latestEntryDate > facts.today) return "later_entry"
  return null
}

export const refuseSipEarlyExit = (facts: SipEarlyExitFacts): void => {
  const refusal = sipEarlyExitRefusal(facts)
  if (refusal !== null) throw new AppError("STATE_CONFLICT", { message: SIP_EARLY_EXIT_REFUSALS[refusal] })
}
