import { randomBytes } from "node:crypto"

import { afterEach, describe, expect, test } from "vitest"

import {
  issuePaymentReturnToken,
  verifyPaymentReturnToken,
} from "../domain/payments/paymentReturnToken.js"
import { createApplication } from "../runtime/application.js"
import { registerPaymentReturnRoutes } from "./paymentReturnRoutes.js"

const key = randomBytes(32)
const now = new Date("2026-08-24T12:00:00.000Z")
const apps: ReturnType<typeof createApplication>[] = []

afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close()
})

describe("payment return token", () => {
  test("accepts only an untampered token before expiry", () => {
    const token = issuePaymentReturnToken(key, "4d875c76-9c60-45cd-a21c-923ab6017011", new Date(now.getTime() + 60_000))
    const parts = token.split(".")
    const signature = Buffer.from(parts[3]!, "base64url")
    const tamperedSignature = Buffer.from(signature)
    tamperedSignature[0] = (tamperedSignature[0] ?? 0) ^ 1
    const tampered = `${parts.slice(0, 3).join(".")}.${tamperedSignature.toString("base64url")}`
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    const finalIndex = alphabet.indexOf(parts[3]!.at(-1) as string)
    const alternateFinal = alphabet[(finalIndex & 60) | ((finalIndex + 1) & 3)]
    const nonCanonical = `${parts.slice(0, 3).join(".")}.${parts[3]!.slice(0, -1)}${alternateFinal}`
    expect(Buffer.from(nonCanonical.split(".")[3]!, "base64url")).toEqual(signature)

    expect(verifyPaymentReturnToken(key, token, now)).toBe(true)
    expect(verifyPaymentReturnToken(key, tampered, now)).toBe(false)
    expect(verifyPaymentReturnToken(key, nonCanonical, now)).toBe(false)
    expect(verifyPaymentReturnToken(key, token, new Date(now.getTime() + 60_000))).toBe(false)
    expect(verifyPaymentReturnToken(key, token, new Date(now.getTime() + 61_000))).toBe(false)
    expect(token).not.toContain("4d875c76-9c60-45cd-a21c-923ab6017011")
  })
})

describe("GET /payment-return", () => {
  test("is public, non-authoritative, and discloses no correlation value", async () => {
    const app = createApplication({
      logger: false,
      registerRoutes: (instance) => registerPaymentReturnRoutes(instance, { clock: () => now, signingKey: key }),
    })
    apps.push(app)
    const token = issuePaymentReturnToken(key, "4d875c76-9c60-45cd-a21c-923ab6017011", new Date(now.getTime() + 60_000))
    const response = await app.inject({ method: "GET", url: `/payment-return?token=${encodeURIComponent(token)}` })

    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toContain("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.body).toContain("No payment result is confirmed by this page.")
    expect(response.body).not.toContain(token)
    expect(response.body).not.toContain("4d875c76-9c60-45cd-a21c-923ab6017011")
  })

  test("rejects invalid input without exposing payment state", async () => {
    const app = createApplication({
      logger: false,
      registerRoutes: (instance) => registerPaymentReturnRoutes(instance, { clock: () => now, signingKey: key }),
    })
    apps.push(app)
    const response = await app.inject({ method: "GET", url: "/payment-return?token=invalid" })

    expect(response.statusCode).toBe(400)
    expect(response.body).toContain("No payment result is confirmed by this page.")
    expect(response.body).not.toMatch(/success|failed|declined|amount|order/iu)
  })
})
