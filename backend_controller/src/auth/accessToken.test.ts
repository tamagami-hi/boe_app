import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService } from "./accessToken.js"
import type { AccessTokenConfig } from "./accessToken.js"

let baseConfig: AccessTokenConfig
let otherSpki: string

beforeAll(async () => {
  const current = await generateKeyPair("ES256", { extractable: true })
  const other = await generateKeyPair("ES256", { extractable: true })
  otherSpki = await exportSPKI(other.publicKey)
  baseConfig = {
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(current.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(current.publicKey) },
  }
})

describe("ES256 access-token service", () => {
  test("signs and verifies, round-tripping sub/sid/jti and kid", async () => {
    const service = createAccessTokenService(baseConfig)
    const token = await service.sign({ sub: "user-1", sid: "session-1" })
    const verified = await service.verify(token)
    expect(verified.sub).toBe("user-1")
    expect(verified.sid).toBe("session-1")
    expect(verified.kid).toBe("k1")
    expect(verified.jti).toMatch(/^[0-9a-f-]{36}$/u)
  })

  test("rejects a token whose kid is not in the verification set", async () => {
    const signer = createAccessTokenService(baseConfig)
    const verifier = createAccessTokenService({ ...baseConfig, verificationKeysSpki: { k2: otherSpki } })
    const token = await signer.sign({ sub: "user-1", sid: "session-1" })
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
  })

  test("rejects a token with the wrong audience", async () => {
    const signer = createAccessTokenService(baseConfig)
    const verifier = createAccessTokenService({ ...baseConfig, audience: "boe-web" })
    const token = await signer.sign({ sub: "user-1", sid: "session-1" })
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
  })

  test("rejects a tampered token and a malformed token", async () => {
    const service = createAccessTokenService(baseConfig)
    const token = await service.sign({ sub: "user-1", sid: "session-1" })
    const tampered = `${token.slice(0, -2)}xy`
    await expect(service.verify(tampered)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
    await expect(service.verify("not-a-jwt")).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
  })
})
