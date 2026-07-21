import { describe, expect, test } from "vitest"

import { deriveInvestingEligibility, type EligibilityInputs } from "./investingEligibility.js"

const NOW = new Date("2026-07-21T00:00:00.000Z")
const base: EligibilityInputs = {
  accountState: "active",
  kyc: { state: "approved", expiresAt: "2027-07-21T00:00:00.000Z" },
  riskState: "assessed",
  now: NOW,
}

describe("deriveInvestingEligibility (spec 03 §2.3)", () => {
  test("active user with current approved KYC and assessed risk is eligible", () => {
    expect(deriveInvestingEligibility(base)).toEqual({ eligibility: "eligible", reason: null })
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

  test("missing or unapproved KYC is pending_compliance", () => {
    expect(deriveInvestingEligibility({ ...base, kyc: null }).eligibility).toBe("pending_compliance")
    expect(deriveInvestingEligibility({ ...base, kyc: null }).reason).toBe("kyc_required")
    expect(
      deriveInvestingEligibility({ ...base, kyc: { state: "in_review", expiresAt: null } }).eligibility,
    ).toBe("pending_compliance")
  })

  test("missing or unassessed risk is pending_compliance", () => {
    expect(deriveInvestingEligibility({ ...base, riskState: null }).reason).toBe("risk_assessment_required")
    expect(deriveInvestingEligibility({ ...base, riskState: "submitted" }).reason).toBe(
      "risk_assessment_required",
    )
  })

  test("expired approved KYC is pending_compliance", () => {
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
      deriveInvestingEligibility({
        ...base,
        kyc: { state: "approved", expiresAt: NOW.toISOString() },
      }).reason,
    ).toBe("kyc_expired")
  })

  test("suspension takes precedence over missing compliance", () => {
    expect(
      deriveInvestingEligibility({ ...base, accountState: "suspended", kyc: null, riskState: null })
        .eligibility,
    ).toBe("suspended")
  })
})
