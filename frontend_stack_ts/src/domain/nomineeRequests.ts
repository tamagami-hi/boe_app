import type { NomineeRequestState as ContractNomineeRequestState } from "@beonedge/contracts"

import { assertNever } from "~/lib/assertNever"

import type { StatusPresentation } from "./status"

export type NomineeRequestState = ContractNomineeRequestState

const NOMINEE_REQUEST_STATES: readonly NomineeRequestState[] = ["pending", "accepted", "declined", "withdrawn"]

export const nomineeRequestState = (value: NomineeRequestState): StatusPresentation => {
  switch (value) {
    case "pending":
      return { label: "Waiting", tone: "info" }
    case "accepted":
      return { label: "Accepted", tone: "positive" }
    case "declined":
      return { label: "Declined", tone: "warning" }
    case "withdrawn":
      return { label: "Withdrawn", tone: "neutral" }
    default:
      return assertNever(value)
  }
}

export const NOMINEE_REQUEST_STATE_OPTIONS = NOMINEE_REQUEST_STATES.map((value) => ({
  value,
  label: nomineeRequestState(value).label,
}))
