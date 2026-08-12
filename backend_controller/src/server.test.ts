import { generateKeyPairSync, randomBytes } from "node:crypto"

import { describe, expect, test } from "vitest"

import { startServer } from "./server.js"

const kid = "server-k1"
const keyPair = generateKeyPairSync("ec", { namedCurve: "P-256" })
const base64Key = (): string => randomBytes(32).toString("base64")

const compositionEnv = (): Record<string, string> => ({
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
  ACCESS_TOKEN_SIGNING_KEY: keyPair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({
    [kid]: keyPair.publicKey.export({ type: "spki", format: "pem" }) as string,
  }),
  REFRESH_HMAC_KEY: base64Key(),
  REFRESH_KEY_VERSION: "rt1",
  CSRF_KEY_VERSION: "cs1",
  CURSOR_HMAC_KEY: base64Key(),
  WEB_COOKIE_SECURE: "false",
  WEB_ORIGIN_ALLOWLIST: "http://127.0.0.1",
  AWS_REGION: "us-east-1",
  SNS_TOPIC_ARN: "arn:aws:sns:us-east-1:000000000000:test",
  SES_CONFIGURATION_SET: "test-set",
  PASSWORD_BREACH_CHECK_MODE: "bypass",
  NODE_ENV: "test",
})

describe("startServer", () => {
  test("composes the backend, listens, serves health, and closes cleanly", async () => {
    const server = await startServer({
      environment: {
        host: "127.0.0.1",
        logLevel: "silent",
        nodeEnvironment: "test",
        port: 0,
        trustProxy: false,
      },
      env: compositionEnv(),
    })

    try {
      const address = server.server.address()
      expect(address).not.toBeNull()
      expect(typeof address).toBe("object")
      if (address === null || typeof address === "string") throw new Error("Expected TCP address")

      const live = await fetch(`http://127.0.0.1:${address.port}/health/live`)
      expect(live.status).toBe(200)
      expect(await live.json()).toEqual({ status: "ok" })

      // A canonical route is wired (readiness is degraded because the DB is unreachable).
      const ready = await fetch(`http://127.0.0.1:${address.port}/health/ready`)
      expect(ready.status).toBe(503)
    } finally {
      await server.close()
    }
  })
})
