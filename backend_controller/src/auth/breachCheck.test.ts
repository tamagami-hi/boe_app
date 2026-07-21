import { createHash } from "node:crypto"

import { describe, expect, test } from "vitest"

import { AppError } from "../http/errorCatalog.js"

import { createHibpBreachChecker, resolveBreachCheckMode, createBreachChecker } from "./breachCheck.js"

const digest = (password: string): string =>
  createHash("sha1").update(password, "utf8").digest("hex").toUpperCase()

const suffixOf = (password: string): string => digest(password).slice(5)

const fakeResponse = (body: string, ok = true): Response =>
  ({ ok, text: () => Promise.resolve(body) }) as unknown as Response

const fetchReturning = (body: string, ok = true): { impl: typeof fetch; calls: () => number } => {
  let count = 0
  const impl: typeof fetch = () => {
    count += 1
    return Promise.resolve(fakeResponse(body, ok))
  }
  return { impl, calls: () => count }
}

describe("resolveBreachCheckMode", () => {
  test("defaults to enforce and allows bypass only in test/development", () => {
    expect(resolveBreachCheckMode({})).toBe("enforce")
    expect(resolveBreachCheckMode({ PASSWORD_BREACH_CHECK_MODE: "bypass", NODE_ENV: "test" })).toBe("bypass")
    expect(() =>
      resolveBreachCheckMode({ PASSWORD_BREACH_CHECK_MODE: "bypass", NODE_ENV: "production" }),
    ).toThrow()
    expect(() => resolveBreachCheckMode({ PASSWORD_BREACH_CHECK_MODE: "off" })).toThrow()
  })
})

describe("HIBP breach checker", () => {
  test("rejects a breached password with VALIDATION_FAILED", async () => {
    const password = "correct horse battery staple"
    const { impl } = fetchReturning(`${suffixOf(password)}:57\r\n${"0".repeat(35)}:0`)
    const checker = createHibpBreachChecker({ fetchImpl: impl })
    await expect(checker.check(password)).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
  })

  test("accepts a password whose suffix is only padding (count 0)", async () => {
    const password = "another good passphrase"
    const { impl } = fetchReturning(`${suffixOf(password)}:0\r\n${"A".repeat(35)}:9`)
    const checker = createHibpBreachChecker({ fetchImpl: impl })
    await expect(checker.check(password)).resolves.toBeUndefined()
  })

  test("caches the range response by prefix", async () => {
    const password = "cache me twice please"
    const { impl, calls } = fetchReturning(`${suffixOf(password)}:0`)
    const checker = createHibpBreachChecker({ fetchImpl: impl })
    await checker.check(password)
    await checker.check(password)
    expect(calls()).toBe(1)
  })

  test("fails closed with DEPENDENCY_UNAVAILABLE on a non-2xx response", async () => {
    const { impl } = fetchReturning("", false)
    const checker = createHibpBreachChecker({ fetchImpl: impl })
    await expect(checker.check("some password value")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    })
  })

  test("fails closed when the request rejects", async () => {
    const impl: typeof fetch = () => Promise.reject(new Error("network down"))
    const checker = createHibpBreachChecker({ fetchImpl: impl })
    await expect(checker.check("some password value")).rejects.toBeInstanceOf(AppError)
  })
})

describe("createBreachChecker", () => {
  test("bypass mode resolves without any request", async () => {
    const checker = createBreachChecker("bypass")
    await expect(checker.check("anything at all here")).resolves.toBeUndefined()
  })
})
