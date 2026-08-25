import { randomBytes, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { decryptMandateSetupToken, encryptMandateSetupToken } from "./mandateSetupToken.js"

describe("mandate setup token AAD", () => {
  test("binds every immutable setup identity", () => {
    const key = randomBytes(32)
    const identity = {
      mandateId: randomUUID(),
      setupAttemptId: randomUUID(),
      merchantSubscriptionId: `MS_${randomUUID()}`,
      merchantOrderId: `MO_${randomUUID()}`,
      providerOrderId: `PO_${randomUUID()}`,
    }
    const envelope = encryptMandateSetupToken(key, "sdk-token", identity)
    expect(decryptMandateSetupToken(key, envelope, identity)).toBe("sdk-token")
    expect(() =>
      decryptMandateSetupToken(key, envelope, { ...identity, setupAttemptId: randomUUID() }),
    ).toThrow()
  })
})
