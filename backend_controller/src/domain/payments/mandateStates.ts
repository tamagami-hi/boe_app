import type {
  MandateNotifyState,
  MandateSetupState,
  MandateState,
  SipState,
} from "../../db/types.js"

export type { MandateNotifyState, MandateSetupState, MandateState }

const AUTOPAY_SIP_TRANSITIONS = {
  draft: ["pending_mandate", "cancelled"],
  pending_mandate: ["active", "setup_failed", "cancelled", "revoked", "expired"],
  active: ["paused", "cancel_pending", "cancelled", "revoked", "expired", "mandate_failed", "completed"],
  paused: ["active", "cancel_pending", "cancelled", "revoked", "expired", "mandate_failed"],
  cancel_pending: ["active", "paused", "cancelled", "revoked", "expired", "mandate_failed"],
  cancelled: [],
  completed: [],
  setup_failed: [],
  mandate_failed: [],
  expired: [],
  revoked: [],
} as const satisfies Readonly<Record<SipState, readonly SipState[]>>

const MANDATE_TRANSITIONS = {
  setup_pending: ["active", "cancelled", "revoked", "expired", "failed"],
  active: ["pause_pending", "paused", "cancel_pending", "cancelled", "revoke_pending", "revoked", "expired", "failed"],
  pause_pending: ["paused", "active", "cancel_pending", "cancelled", "revoke_pending", "revoked", "expired", "failed"],
  paused: ["active", "cancel_pending", "cancelled", "revoke_pending", "revoked", "expired", "failed"],
  cancel_pending: ["cancelled", "active", "paused", "revoke_pending", "revoked", "expired", "failed"],
  cancelled: [],
  revoke_pending: ["revoked", "cancelled", "active", "paused", "expired", "failed"],
  revoked: [],
  expired: [],
  failed: [],
} as const satisfies Readonly<Record<MandateState, readonly MandateState[]>>

const SETUP_TRANSITIONS = {
  created: ["dispatching", "expired"],
  dispatching: ["provider_pending", "authorized", "failed", "expired"],
  provider_pending: ["authorized", "failed", "expired"],
  authorized: [],
  failed: [],
  expired: [],
} as const satisfies Readonly<Record<MandateSetupState, readonly MandateSetupState[]>>

const NOTIFY_TRANSITIONS = {
  created: ["dispatching", "failed"],
  dispatching: ["notified", "failed"],
  notified: [],
  failed: ["dispatching"],
} as const satisfies Readonly<Record<MandateNotifyState, readonly MandateNotifyState[]>>

const transition = <State extends string>(
  transitions: Readonly<Record<State, readonly State[]>>,
  current: State,
  next: State,
): State => {
  if (!(transitions[current] as readonly State[]).includes(next)) {
    throw new Error(`Invalid state transition: ${current} -> ${next}`)
  }
  return next
}

export const transitionMandateState = (current: MandateState, next: MandateState): MandateState =>
  transition(MANDATE_TRANSITIONS, current, next)

export const transitionAutoPaySipState = (current: SipState, next: SipState): SipState =>
  transition(AUTOPAY_SIP_TRANSITIONS, current, next)

export const deriveSipStateForMandate = (
  currentSipState: SipState,
  targetMandateState: MandateState,
  hasAuthorizationHistory: boolean,
): SipState => {
  if (
    !hasAuthorizationHistory &&
    ["pause_pending", "paused", "cancel_pending", "revoke_pending"].includes(targetMandateState)
  ) {
    throw new Error("Mandate state requires authorization history")
  }
  let targetSipState: SipState
  switch (targetMandateState) {
    case "setup_pending": targetSipState = "pending_mandate"; break
    case "active":
    case "pause_pending": targetSipState = "active"; break
    case "paused": targetSipState = "paused"; break
    case "cancel_pending":
    case "revoke_pending": targetSipState = "cancel_pending"; break
    case "cancelled": targetSipState = "cancelled"; break
    case "revoked": targetSipState = "revoked"; break
    case "expired": targetSipState = "expired"; break
    case "failed": targetSipState = hasAuthorizationHistory ? "mandate_failed" : "setup_failed"; break
  }
  return currentSipState === targetSipState
    ? targetSipState
    : transitionAutoPaySipState(currentSipState, targetSipState)
}

export const transitionSetupState = (
  current: MandateSetupState,
  next: MandateSetupState,
): MandateSetupState => transition(SETUP_TRANSITIONS, current, next)

export const transitionNotifyState = (
  current: MandateNotifyState,
  next: MandateNotifyState,
): MandateNotifyState => transition(NOTIFY_TRANSITIONS, current, next)
