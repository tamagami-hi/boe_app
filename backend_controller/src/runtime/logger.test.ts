import { Writable } from "node:stream"

import { describe, expect, test } from "vitest"

import { createRuntimeLogger } from "./logger.js"

const flushLogger = async (logger: ReturnType<typeof createRuntimeLogger>): Promise<void> => {
  await new Promise<void>((resolve, reject) => logger.flush((error) => {
    if (error === undefined) {
      resolve()
      return
    }

    reject(error)
  }))
}

describe("createRuntimeLogger", () => {
  test("redacts credentials and tokens from structured log fields", async () => {
    let output = ""
    const destination = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        output += chunk.toString()
        callback()
      },
    })
    const logger = createRuntimeLogger({ destination, level: "info" })

    logger.info({
      authorization: "Bearer secret-access",
      body: { credentials: { refreshToken: "deep-secret-refresh" } },
      cookie: "refreshToken=secret-refresh",
      password: "secret-password",
      req: { body: { password: "nested-secret-password" } },
      token: "secret-token",
      user: { email: "private@example.com", phone: "+911234567890" },
    }, "redaction check")
    await flushLogger(logger)

    expect(output).toContain("redaction check")
    expect(output).toContain("[REDACTED]")
    expect(output).not.toContain("secret-access")
    expect(output).not.toContain("secret-refresh")
    expect(output).not.toContain("secret-password")
    expect(output).not.toContain("secret-token")
    expect(output).not.toContain("deep-secret-refresh")
    expect(output).not.toContain("nested-secret-password")
    expect(output).not.toContain("private@example.com")
    expect(output).not.toContain("+911234567890")
  })
})
