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
      trustProxy: "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
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
      trustProxy: "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
    })
  })

  test("trusts only the configured proxy hops, and can be switched off", () => {
    // An allowlist rather than `true`: a request arriving from a public address
    // must not be able to claim any client address it likes, because that address
    // is recorded against every sign-in attempt.
    expect(parseRuntimeEnvironment({ TRUST_PROXY: "10.0.0.0/8" }).trustProxy).toBe("10.0.0.0/8")
    expect(parseRuntimeEnvironment({ TRUST_PROXY: "false" }).trustProxy).toBe(false)
    expect(parseRuntimeEnvironment({ TRUST_PROXY: "FALSE" }).trustProxy).toBe(false)
    expect(parseRuntimeEnvironment({ TRUST_PROXY: "  " }).trustProxy).toBe(false)
  })

  test.each(["0", "65536", "not-a-port"])("rejects invalid PORT=%s", (port) => {
    expect(() => parseRuntimeEnvironment({ PORT: port })).toThrow()
  })

  test("rejects unsupported log levels", () => {
    expect(() => parseRuntimeEnvironment({ LOG_LEVEL: "verbose" })).toThrow()
  })
})
