import { describe, expect, test } from "vitest"

import { deriveInvestingEligibility, type EligibilityInputs } from "./investingEligibility.js"

const base: EligibilityInputs = {
  accountState: "active",
  emailVerification: { state: "verified" },
}

describe("deriveInvestingEligibility (decision 9: email verification-only, no client risk profiling)", () => {
  test("active user with current verified email verification is eligible", () => {
    expect(deriveInvestingEligibility(base)).toEqual({ eligibility: "eligible", reason: null })
  })

  test("no risk-assessment input is required for eligibility", () => {
    expect(deriveInvestingEligibility(base).eligibility).toBe("eligible")
  })

  test("closed or suspended user is suspended", () => {
    expect(deriveInvestingEligibility({ ...base, accountState: "suspended" })).toEqual({
      eligibility: "suspended",
      reason: "account_suspended",
    })
    expect(deriveInvestingEligibility({ ...base, accountState: "closed" })).toEqual({
      eligibility: "suspended",
      reason: "account_suspended",
    })
  })

  test("non-active (invited) user is blocked", () => {
    expect(deriveInvestingEligibility({ ...base, accountState: "invited" })).toEqual({
      eligibility: "blocked",
      reason: "account_not_active",
    })
  })

  test("missing or unverified email verification is pending_verification (email_verification_required)", () => {
    expect(deriveInvestingEligibility({ ...base, emailVerification: null })).toEqual({
      eligibility: "pending_verification",
      reason: "email_verification_required",
    })
    expect(
      deriveInvestingEligibility({ ...base, emailVerification: { state: "pending" } }).reason,
    ).toBe("email_verification_required")
    expect(
      deriveInvestingEligibility({ ...base, emailVerification: { state: "pending" } }).eligibility,
    ).toBe("pending_verification")
  })

  test("verified email ownership remains eligible without a verification expiry", () => {
    expect(deriveInvestingEligibility({ ...base, emailVerification: { state: "verified" } }).eligibility).toBe("eligible")
  })

  test("suspension takes precedence over missing email verification", () => {
    expect(
      deriveInvestingEligibility({ ...base, accountState: "suspended", emailVerification: null }).eligibility,
    ).toBe("suspended")
  })
})
