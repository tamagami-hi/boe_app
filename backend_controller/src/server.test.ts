import { describe, expect, test } from "vitest"

import { startServer } from "./server.js"

describe("startServer", () => {
  test("listens on an ephemeral port and closes cleanly", async () => {
    const server = await startServer({
      environment: {
        host: "127.0.0.1",
        logLevel: "silent",
        nodeEnvironment: "test",
        port: 0,
      },
    })

    try {
      const address = server.server.address()
      expect(address).not.toBeNull()
      expect(typeof address).toBe("object")
      if (address === null || typeof address === "string") throw new Error("Expected TCP address")

      const response = await fetch(`http://127.0.0.1:${address.port}/health/live`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: "ok" })
    } finally {
      await server.close()
    }
  })
})
