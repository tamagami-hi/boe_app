import { describe, expect, test } from "vitest"

import { deriveInvestingEligibility, type EligibilityInputs } from "./investingEligibility.js"

const NOW = new Date("2026-07-21T00:00:00.000Z")
const base: EligibilityInputs = {
  accountState: "active",
  emailVerification: { state: "verified", expiresAt: "2027-07-21T00:00:00.000Z" },
  now: NOW,
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
      deriveInvestingEligibility({ ...base, emailVerification: { state: "pending", expiresAt: null } }).reason,
    ).toBe("email_verification_required")
    expect(
      deriveInvestingEligibility({ ...base, emailVerification: { state: "pending", expiresAt: null } }).eligibility,
    ).toBe("pending_verification")
  })

  test("expired verified email verification is pending_verification (email_verification_expired)", () => {
    expect(
      deriveInvestingEligibility({
        ...base,
        emailVerification: { state: "verified", expiresAt: "2020-01-01T00:00:00.000Z" },
      }),
    ).toEqual({ eligibility: "pending_verification", reason: "email_verification_expired" })
  })

  test("verified email verification with null expiry does not expire", () => {
    expect(
      deriveInvestingEligibility({ ...base, emailVerification: { state: "verified", expiresAt: null } }).eligibility,
    ).toBe("eligible")
  })

  test("email verification expiring exactly at now is treated as expired (<=)", () => {
    expect(
      deriveInvestingEligibility({ ...base, emailVerification: { state: "verified", expiresAt: NOW.toISOString() } }).reason,
    ).toBe("email_verification_expired")
  })

  test("suspension takes precedence over missing email verification", () => {
    expect(
      deriveInvestingEligibility({ ...base, accountState: "suspended", emailVerification: null }).eligibility,
    ).toBe("suspended")
  })
})
