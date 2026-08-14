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
    // not leak any configuration value. `validEnv` supplies the SES/SNS variables
    // but no SMTP credentials, which is exactly the case the two flags exist to
    // separate: this deployment could not send a single message.
    const ready = await app.inject({ method: "GET", url: "/health/ready" })
    expect(ready.statusCode).toBe(503)
    expect(ready.json()).toMatchObject({
      status: "degraded",
      checks: { database: false, emailTransport: false, emailEventIngress: true },
    })

    // A representative canonical route is actually registered.
    const disclosures = await app.inject({ method: "GET", url: "/v1/public/disclosures" })
    expect([200, 500, 503]).toContain(disclosures.statusCode) // reachable route (DB-dependent body)

    // The external signup door the marketing site posts to is registered. This
    // env supplies no NEWUSER_SHARED_SECRET, so the route fails closed with 503
    // rather than accepting an unauthenticated signup — which also proves the
    // rest of the app still booted without that secret.
    const newUser = await app.inject({ method: "POST", url: "/newuser", payload: {} })
    expect(newUser.statusCode).toBe(503)

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

  test("leaves the signup shared secret null when the deployment omits it", () => {
    // Absent, not fatal: a missing signup secret must degrade /newuser only,
    // never stop the backend from booting and serving the client app.
    expect(parseServerConfig(validEnv()).signup.sharedSecret).toBeNull()
  })

  test("carries the signup shared secret when configured", () => {
    const secret = "a".repeat(48)
    expect(parseServerConfig({ ...validEnv(), NEWUSER_SHARED_SECRET: secret }).signup.sharedSecret).toBe(secret)
  })

  test("rejects a signup shared secret that is too short to be worth having", () => {
    expect(() => parseServerConfig({ ...validEnv(), NEWUSER_SHARED_SECRET: "short" })).toThrow()
  })

  test.each([
    "http://dev-app.beonedge.in/downloads",
    "https://evil.example/downloads",
    "https://dev-app.beonedge.in/not-downloads",
    "https://dev-app.beonedge.in/downloads?redirect=evil",
  ])("rejects non-canonical APK download base %s", (downloadBaseUrl) => {
    expect(() => parseServerConfig({ ...validEnv(), APK_DOWNLOAD_BASE_URL: downloadBaseUrl })).toThrow(
      /APK_DOWNLOAD_BASE_URL/u,
    )
  })

  test.each([
    "https://dev-app.beonedge.in/downloads",
    "https://app.beonedge.in/downloads",
  ])("accepts canonical APK download base %s", (downloadBaseUrl) => {
    expect(parseServerConfig({ ...validEnv(), APK_DOWNLOAD_BASE_URL: downloadBaseUrl }).appUpdate.downloadBaseUrl)
      .toBe(downloadBaseUrl)
  })
})

describe("the read cache is optional", () => {
  test("is disabled when REDIS_URL is absent, and the backend still composes", () => {
    const config = parseServerConfig(validEnv())

    expect(config.cache.configured).toBe(false)
    expect(config.cache.redisUrl).toBeNull()
  })

  test("is enabled by REDIS_URL alone, with usable TTL defaults", () => {
    const config = parseServerConfig({ ...validEnv(), REDIS_URL: "redis://redis:6379" })

    expect(config.cache.configured).toBe(true)
    expect(config.cache.redisUrl).toBe("redis://redis:6379")
    expect(config.cache.appConfigTtlMs).toBeGreaterThan(0)
    expect(config.cache.catalogTtlMs).toBeGreaterThan(0)
    expect(config.cache.publicContentTtlMs).toBeGreaterThan(0)
  })

  test("a blank REDIS_URL is treated as absent rather than as a bad host", () => {
    const config = parseServerConfig({ ...validEnv(), REDIS_URL: "   " })

    expect(config.cache.configured).toBe(false)
  })

  test("composing with a cache configured does not require Redis to be reachable", async () => {
    const composed = await composeBackend({ ...validEnv(), REDIS_URL: "redis://127.0.0.1:1" })

    expect(typeof composed.registerRoutes).toBe("function")
    await composed.dispose()
  })
})
