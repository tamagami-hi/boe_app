/**
 * Derived investing eligibility (spec 03 §2.3). Eligibility is *derived* at read
 * and command time from the live user account state and Email Verification state.
 * It is never stored in configuration, a JWT claim,
 * or a client-owned row. This module is the single pure decision function; the
 * repository supplies the inputs and the investing command re-derives under lock
 * before accepting money.
 *
 * Derivation (evaluated in order). This intentionally deviates from spec 03 §2.3
 * by dropping the risk-assessment gate (decision 9: clients are not risk-profiled;
 * risk is a fund attribute the client chooses):
 *   closed or suspended user                     -> suspended
 *   account_state <> active                       -> blocked
 *   no Email Verification, or not verified        -> pending_verification
 *   verified Email Verification has expired       -> pending_verification
 *   active user + current Email Verification     -> eligible
 */
import type { EmailVerificationState, UserAccountState } from "../../db/types.js"

export type InvestingEligibility = "suspended" | "blocked" | "pending_verification" | "eligible"

export interface EligibilityEmailVerificationInput {
  readonly state: EmailVerificationState
}

export interface EligibilityInputs {
  readonly accountState: UserAccountState
  readonly emailVerification: EligibilityEmailVerificationInput | null
}

/**
 * Reason the caller is not `eligible`, for surfacing an actionable next step to
 * the client without leaking compliance internals.
 */
export type EligibilityReason =
  | "account_suspended"
  | "account_not_active"
  | "email_verification_required"
  | null

export interface EligibilityDecision {
  readonly eligibility: InvestingEligibility
  readonly reason: EligibilityReason
}

export const deriveInvestingEligibility = (inputs: EligibilityInputs): EligibilityDecision => {
  if (inputs.accountState === "closed" || inputs.accountState === "suspended") {
    return { eligibility: "suspended", reason: "account_suspended" }
  }
  if (inputs.accountState !== "active") {
    return { eligibility: "blocked", reason: "account_not_active" }
  }
  if (inputs.emailVerification === null || inputs.emailVerification.state !== "verified") {
    return { eligibility: "pending_verification", reason: "email_verification_required" }
  }
  // No client risk profiling (decision 9): active account + current Email Verification
  // is sufficient. Risk is chosen per-fund at investment time.
  return { eligibility: "eligible", reason: null }
}
