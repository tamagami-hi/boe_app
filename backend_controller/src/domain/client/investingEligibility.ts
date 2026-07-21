/**
 * Derived investing eligibility (spec 03 §2.3). Eligibility is *derived* at read
 * and command time from the live user account state, the latest KYC case, and
 * the latest risk assessment. It is never stored in configuration, a JWT claim,
 * or a client-owned row. This module is the single pure decision function; the
 * repository supplies the inputs and the investing command re-derives under lock
 * before accepting money.
 *
 * Derivation (spec 03 §2.3), evaluated in order:
 *   closed or suspended user                              -> suspended
 *   account_state <> active                               -> blocked
 *   no KYC case, or KYC not approved                      -> pending_compliance
 *   no risk assessment, or risk not assessed              -> pending_compliance
 *   approved KYC has expired                              -> pending_compliance
 *   active user + current approved KYC + assessed risk    -> eligible
 */
import type { KycCaseState, RiskAssessmentState, UserAccountState } from "../../db/types.js"

export type InvestingEligibility = "suspended" | "blocked" | "pending_compliance" | "eligible"

export interface EligibilityKycInput {
  readonly state: KycCaseState
  /** ISO timestamp of the approved KYC's expiry, or null when the case sets no expiry. */
  readonly expiresAt: string | null
}

export interface EligibilityInputs {
  readonly accountState: UserAccountState
  /** The user's latest KYC case, or null when none exists. */
  readonly kyc: EligibilityKycInput | null
  /** The user's latest risk-assessment state, or null when none exists. */
  readonly riskState: RiskAssessmentState | null
  /** Database-derived evaluation time; KYC expiry is compared against this. */
  readonly now: Date
}

/**
 * Reason the caller is not `eligible`, for surfacing an actionable next step to
 * the client without leaking compliance internals.
 */
export type EligibilityReason =
  | "account_suspended"
  | "account_not_active"
  | "kyc_required"
  | "kyc_expired"
  | "risk_assessment_required"
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
  if (inputs.kyc === null || inputs.kyc.state !== "approved") {
    return { eligibility: "pending_compliance", reason: "kyc_required" }
  }
  if (inputs.riskState !== "assessed") {
    return { eligibility: "pending_compliance", reason: "risk_assessment_required" }
  }
  if (inputs.kyc.expiresAt !== null && new Date(inputs.kyc.expiresAt).getTime() <= inputs.now.getTime()) {
    return { eligibility: "pending_compliance", reason: "kyc_expired" }
  }
  return { eligibility: "eligible", reason: null }
}
