import type { SipState } from "@beonedge/contracts"

const ENDED_SIP_STATES: ReadonlySet<SipState> = new Set<SipState>([
  "cancelled",
  "completed",
  "expired",
  "revoked",
  "setup_failed",
  "mandate_failed",
])

export const isEndedSip = (status: SipState): boolean => ENDED_SIP_STATES.has(status)

export const isRunningSip = (status: SipState): boolean => status === "active" || status === "paused"
