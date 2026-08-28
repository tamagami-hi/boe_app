import { describe, expect, test } from "vitest"

import { createApplication } from "../runtime/application.js"

/**
 * The emulator run failed on exactly this: the WebView origin
 * (`https://localhost`) got no `Access-Control-Allow-Origin`, so the browser
 * discarded every reply and the app could not reach the API at all.
 */

const ALLOWLIST = ["https://localhost", "capacitor://localhost", "http://localhost:5173"]

const buildApp = (corsAllowlist: readonly string[] = ALLOWLIST) =>
  createApplication({
    logger: false,
    corsAllowlist,
    registerRoutes: (application) => {
      application.get("/v1/probe", (_request, reply) => reply.sendData({ ok: true }))
      application.post("/v1/probe", (_request, reply) => reply.sendData({ ok: true }))
    },
  })

describe("cors", () => {
  test("reflects an allow-listed origin with credentials enabled", async () => {
    const app = buildApp()
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/probe",
        headers: { origin: "https://localhost" },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers["access-control-allow-origin"]).toBe("https://localhost")
      expect(response.headers["access-control-allow-credentials"]).toBe("true")
      // Never `*`: the admin console sends cookies, and `*` is illegal with those.
      expect(response.headers["access-control-allow-origin"]).not.toBe("*")
      expect(response.headers["vary"]).toBe("Origin")
      expect(response.headers["access-control-expose-headers"]).toContain("x-request-id")
    } finally {
      await app.close()
    }
  })

  test("answers a preflight with the methods and headers the clients send", async () => {
    const app = buildApp()
    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/v1/probe",
        headers: {
          origin: "capacitor://localhost",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,authorization,idempotency-key",
        },
      })
      expect(response.statusCode).toBe(204)
      expect(response.headers["access-control-allow-origin"]).toBe("capacitor://localhost")
      const allowedHeaders = String(response.headers["access-control-allow-headers"])
      for (const header of [
        "content-type",
        "authorization",
        "idempotency-key",
        "if-match",
        "x-csrf-token",
        "x-client-platform",
        "x-app-version",
      ]) {
        expect(allowedHeaders).toContain(header)
      }
      const allowedMethods = String(response.headers["access-control-allow-methods"])
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        expect(allowedMethods).toContain(method)
      }
      expect(response.headers["access-control-max-age"]).toBe("600")
    } finally {
      await app.close()
    }
  })

  test("emits no CORS headers for an origin outside the allowlist", async () => {
    const app = buildApp()
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/probe",
        headers: { origin: "https://attacker.example" },
      })
      // The request still succeeds server-side; the browser is what blocks it.
      expect(response.statusCode).toBe(200)
      expect(response.headers["access-control-allow-origin"]).toBeUndefined()
      expect(response.headers["vary"]).toBe("Origin")
    } finally {
      await app.close()
    }
  })

  test("a preflight from a disallowed origin is refused without headers", async () => {
    const app = buildApp()
    try {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/v1/probe",
        headers: { origin: "https://attacker.example", "access-control-request-method": "POST" },
      })
      expect(response.statusCode).toBe(204)
      expect(response.headers["access-control-allow-origin"]).toBeUndefined()
      expect(response.headers["access-control-allow-methods"]).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  test("same-origin and non-browser requests are untouched", async () => {
    const app = buildApp()
    try {
      const response = await app.inject({ method: "GET", url: "/v1/probe" })
      expect(response.statusCode).toBe(200)
      expect(response.headers["access-control-allow-origin"]).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  test("an empty allowlist disables cross-origin access entirely", async () => {
    const app = buildApp([])
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/probe",
        headers: { origin: "https://localhost" },
      })
      expect(response.headers["access-control-allow-origin"]).toBeUndefined()
    } finally {
      await app.close()
    }
  })
})
