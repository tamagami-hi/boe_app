import { access, readFile } from "node:fs/promises"

import { describe, expect, test } from "vitest"

const SOURCE_ROOT = new URL("./", import.meta.url)

const pathExists = async (path: URL): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

describe("TypeScript runtime boundary", () => {
  test("removes the superseded JavaScript server and test", async () => {
    await expect(pathExists(new URL("./server.js", SOURCE_ROOT))).resolves.toBe(false)
    await expect(pathExists(new URL("./server.test.js", SOURCE_ROOT))).resolves.toBe(false)
    await expect(pathExists(new URL("../scripts/start-dev.js", SOURCE_ROOT))).resolves.toBe(false)
  })

  test("removes the superseded configuration and logger JavaScript (BE-003)", async () => {
    await expect(pathExists(new URL("./config/env.js", SOURCE_ROOT))).resolves.toBe(false)
    await expect(pathExists(new URL("./config/dotenv.js", SOURCE_ROOT))).resolves.toBe(false)
    await expect(pathExists(new URL("./shared/logger.js", SOURCE_ROOT))).resolves.toBe(false)
  })

  test("keeps the authoritative server outside the legacy alias and router graph", async () => {
    const source = await readFile(new URL("./server.ts", SOURCE_ROOT), "utf8")

    expect(source).not.toMatch(/from\s+["']#/u)
    expect(source).not.toMatch(/router\.js|config\/env\.js|shared\/logger\.js/u)
  })

  test("builds and starts only the emitted TypeScript server in the runtime image", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", SOURCE_ROOT), "utf8")
    const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("FROM "))

    expect(dockerfile).toContain("RUN npm run build")
    expect(runtimeStage).toMatch(/COPY --from=build[^\n]*\/app\/dist \.\/dist/u)
    expect(runtimeStage).toContain("/health/live")
    expect(runtimeStage).toContain('CMD ["node", "dist/server.js"]')
    expect(runtimeStage).not.toMatch(/COPY[^\n]*\bsrc\b|src\/server\.js/u)
    expect(dockerfile.match(/^FROM .+@sha256:[a-f0-9]{64}/gmu)).toHaveLength(2)
  })
})
