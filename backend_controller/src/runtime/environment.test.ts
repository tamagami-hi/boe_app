import { describe, expect, test } from "vitest"

import { parseRuntimeEnvironment } from "./environment.js"

describe("parseRuntimeEnvironment", () => {
  test("returns immutable safe defaults when optional values are absent", () => {
    const environment = parseRuntimeEnvironment({})

    expect(environment).toEqual({
      host: "127.0.0.1",
      logLevel: "info",
      nodeEnvironment: "development",
      port: 47502,
    })
    expect(Object.isFrozen(environment)).toBe(true)
  })

  test("parses explicit runtime values", () => {
    expect(parseRuntimeEnvironment({
      HOST: "127.0.0.1",
      LOG_LEVEL: "warn",
      NODE_ENV: "production",
      PORT: "8080",
    })).toEqual({
      host: "127.0.0.1",
      logLevel: "warn",
      nodeEnvironment: "production",
      port: 8080,
    })
  })

  test.each(["0", "65536", "not-a-port"])("rejects invalid PORT=%s", (port) => {
    expect(() => parseRuntimeEnvironment({ PORT: port })).toThrow()
  })

  test("rejects unsupported log levels", () => {
    expect(() => parseRuntimeEnvironment({ LOG_LEVEL: "verbose" })).toThrow()
  })
})
