import { Writable } from "node:stream"

import { afterEach, describe, expect, test } from "vitest"

import { createApplication, LIVE_RESPONSE } from "./application.js"

const applications: Array<ReturnType<typeof createApplication>> = []

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (application) => application.close()))
})

describe("createApplication", () => {
  test("serves an exact database-independent liveness response", async () => {
    const application = createApplication({ logger: false })
    applications.push(application)

    const response = await application.inject({ method: "GET", url: "/health/live" })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(LIVE_RESPONSE)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-type"]).toMatch(/^application\/json/)
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(JSON.stringify(response.json())).not.toMatch(/database|postgres|uptime|version|warning/iu)
  })

  test("does not reflect an unknown path or query value in a 404 response", async () => {
    const application = createApplication({ logger: false })
    applications.push(application)

    const response = await application.inject({
      headers: { authorization: "Bearer secret-header" },
      method: "GET",
      url: "/missing/secret-path?token=secret-query",
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Resource not found",
        retryable: false,
      },
    })
    expect(response.body).not.toMatch(/secret-path|secret-query|secret-header/u)
  })

  test("returns a generic validation response for a malformed URL", async () => {
    const application = createApplication({ logger: false })
    applications.push(application)

    const response = await application.inject({ method: "GET", url: "/secret-path%" })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Request validation failed",
        retryable: false,
      },
    })
    expect(response.body).not.toMatch(/secret-path|FST_ERR_BAD_URL|valid url component/u)
  })

  test("returns a generic 500 response and never logs thrown secret values", async () => {
    let output = ""
    const destination = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        output += chunk.toString()
        callback()
      },
    })
    const application = createApplication({
      destination,
      level: "info",
      registerRoutes(instance) {
        instance.get("/test/failure", () => Promise.reject(new Error("secret-provider-error")))
      },
    })
    applications.push(application)

    const response = await application.inject({ method: "GET", url: "/test/failure" })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        retryable: true,
      },
    })
    expect(response.body).not.toContain("secret-provider-error")
    expect(output).toContain("Request failed unexpectedly")
    expect(output).not.toContain("secret-provider-error")
  })

  test.each(["HEAD", "OPTIONS", "POST"] as const)(
    "rejects %s because only GET is registered for liveness",
    async (method) => {
      const application = createApplication({ logger: false })
      applications.push(application)

      const response = await application.inject({ method, url: "/health/live" })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } })
    },
  )
})
