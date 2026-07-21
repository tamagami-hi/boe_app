import { generateKeyPairSync, randomBytes } from "node:crypto"

import { afterEach, describe, expect, test } from "vitest"

import { composeBackend } from "./composition.js"
import { parseServerConfig } from "./environment.js"
import { createApplication } from "./application.js"

const kid = "test-k1"
const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" })
const signingKey = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string
const verificationKey = keyPair.publicKey.export({ type: "spki", format: "pem" }) as string
const base64Key = (): string => randomBytes(32).toString("base64")

const validEnv = (): Record<string, string> => ({
  DATABASE_URL: "postgres://test:test@127.0.0.1:5432/does_not_exist",
  CRYPTO_TOKEN_HASH_KEY: base64Key(),
  CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
  CRYPTO_CONSENT_IP_HMAC_KEY: base64Key(),
  CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
  CRYPTO_RECIPIENT_HMAC_KEY: base64Key(),
  CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
  CRYPTO_RECIPIENT_ENC_KEY: base64Key(),
  CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
  ACCESS_TOKEN_ISSUER: "https://test.example",
  ACCESS_TOKEN_AUDIENCE: "boe-test",
  ACCESS_TOKEN_CURRENT_KID: kid,
  ACCESS_TOKEN_SIGNING_KEY: signingKey,
  ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({ [kid]: verificationKey }),
  REFRESH_HMAC_KEY: base64Key(),
  REFRESH_KEY_VERSION: "rt1",
  CSRF_KEY_VERSION: "cs1",
  CURSOR_HMAC_KEY: base64Key(),
  WEB_COOKIE_SECURE: "false",
  WEB_ORIGIN_ALLOWLIST: "https://admin.example, https://ops.example",
  AWS_REGION: "us-east-1",
  SNS_TOPIC_ARN: "arn:aws:sns:us-east-1:000000000000:test",
  SES_CONFIGURATION_SET: "test-set",
  PASSWORD_BREACH_CHECK_MODE: "bypass",
  NODE_ENV: "test",
})

const dispose: (() => Promise<void>)[] = []
afterEach(async () => {
  while (dispose.length > 0) await dispose.pop()?.()
})

describe("composeBackend", () => {
  test("wires the canonical routes, health, and readiness", async () => {
    const backend = composeBackend(validEnv())
    dispose.push(backend.dispose)
    const app = createApplication({ logger: false, registerRoutes: backend.registerRoutes })

    const live = await app.inject({ method: "GET", url: "/health/live" })
    expect(live.statusCode).toBe(200)

    const health = await app.inject({ method: "GET", url: "/v1/health" })
    expect(health.statusCode).toBe(200)
    expect(health.json<{ ok: boolean }>().ok).toBe(true)

    // The dummy database is unreachable, so readiness is degraded (503) but does
    // not leak any configuration value.
    const ready = await app.inject({ method: "GET", url: "/health/ready" })
    expect(ready.statusCode).toBe(503)
    expect(ready.json()).toMatchObject({ status: "degraded", checks: { database: false, email: true } })

    // A representative canonical route is actually registered.
    const consent = await app.inject({ method: "GET", url: "/v1/public/consent-documents" })
    expect([200, 500, 503]).toContain(consent.statusCode) // reachable route (DB-dependent body)

    await app.close()
  })

  test("fails fast when required configuration is missing", () => {
    expect(() => composeBackend({ NODE_ENV: "test" })).toThrow()
  })
})

describe("parseServerConfig", () => {
  test("parses a valid environment", () => {
    const config = parseServerConfig(validEnv())
    expect(config.access.currentKid).toBe(kid)
    expect(config.web.originAllowlist).toEqual(["https://admin.example", "https://ops.example"])
    expect(config.web.cookieSecure).toBe(false)
    expect(config.refreshKey).toHaveLength(32)
    expect(config.emailConfigured).toBe(true)
  })

  test("rejects a refresh key that is not 32 bytes", () => {
    expect(() => parseServerConfig({ ...validEnv(), REFRESH_HMAC_KEY: Buffer.from("short").toString("base64") })).toThrow(
      /32-byte/u,
    )
  })

  test("rejects malformed verification keys JSON", () => {
    expect(() => parseServerConfig({ ...validEnv(), ACCESS_TOKEN_VERIFICATION_KEYS: "not-json" })).toThrow()
  })

  test("rejects verification keys missing the current kid", () => {
    expect(() =>
      parseServerConfig({ ...validEnv(), ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({ other: verificationKey }) }),
    ).toThrow(/current kid/u)
  })

  test("rejects an empty origin allowlist", () => {
    expect(() => parseServerConfig({ ...validEnv(), WEB_ORIGIN_ALLOWLIST: " , " })).toThrow()
  })
})
