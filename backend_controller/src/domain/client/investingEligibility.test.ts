import { describe, expect, test } from "vitest"

import { deriveInvestingEligibility, type EligibilityInputs } from "./investingEligibility.js"

const NOW = new Date("2026-07-21T00:00:00.000Z")
const base: EligibilityInputs = {
  accountState: "active",
  kyc: { state: "approved", expiresAt: "2027-07-21T00:00:00.000Z" },
  now: NOW,
}

describe("deriveInvestingEligibility (decision 9: KYC-only, no client risk profiling)", () => {
  test("active user with current approved KYC is eligible", () => {
    expect(deriveInvestingEligibility(base)).toEqual({ eligibility: "eligible", reason: null })
  })

  test("risk assessment is NOT a gate — eligible regardless of riskState", () => {
    expect(deriveInvestingEligibility({ ...base, riskState: null }).eligibility).toBe("eligible")
    expect(deriveInvestingEligibility({ ...base, riskState: "not_started" }).eligibility).toBe("eligible")
    expect(deriveInvestingEligibility({ ...base, riskState: "submitted" }).eligibility).toBe("eligible")
    expect(deriveInvestingEligibility({ ...base, riskState: "assessed" }).eligibility).toBe("eligible")
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

  test("missing or unapproved KYC is pending_compliance (kyc_required)", () => {
    expect(deriveInvestingEligibility({ ...base, kyc: null })).toEqual({
      eligibility: "pending_compliance",
      reason: "kyc_required",
    })
    expect(
      deriveInvestingEligibility({ ...base, kyc: { state: "submitted", expiresAt: null } }).reason,
    ).toBe("kyc_required")
    expect(
      deriveInvestingEligibility({ ...base, kyc: { state: "pending_submission", expiresAt: null } }).eligibility,
    ).toBe("pending_compliance")
  })

  test("expired approved KYC is pending_compliance (kyc_expired)", () => {
    expect(
      deriveInvestingEligibility({
        ...base,
        kyc: { state: "approved", expiresAt: "2020-01-01T00:00:00.000Z" },
      }),
    ).toEqual({ eligibility: "pending_compliance", reason: "kyc_expired" })
  })

  test("approved KYC with null expiry does not expire", () => {
    expect(
      deriveInvestingEligibility({ ...base, kyc: { state: "approved", expiresAt: null } }).eligibility,
    ).toBe("eligible")
  })

  test("KYC expiring exactly at now is treated as expired (<=)", () => {
    expect(
      deriveInvestingEligibility({ ...base, kyc: { state: "approved", expiresAt: NOW.toISOString() } }).reason,
    ).toBe("kyc_expired")
  })

  test("suspension takes precedence over missing KYC", () => {
    expect(
      deriveInvestingEligibility({ ...base, accountState: "suspended", kyc: null }).eligibility,
    ).toBe("suspended")
  })
})
