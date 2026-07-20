import { describe, expect, test } from "vitest"

import { buildSeedStatements } from "../db/seedCatalog.js"

import { runSeed } from "./seed.js"

interface RecordedQuery {
  text: string
  values: readonly unknown[] | undefined
}

class FakeClient {
  readonly queries: RecordedQuery[] = []
  released = false
  constructor(private readonly throwOn?: string) {}
  query(text: string, values?: readonly unknown[]): Promise<unknown> {
    this.queries.push({ text, values })
    if (this.throwOn !== undefined && text.includes(this.throwOn)) {
      return Promise.reject(new Error("forced failure"))
    }
    return Promise.resolve()
  }
  release(): void {
    this.released = true
  }
}

const poolFor = (client: FakeClient) => ({ connect: () => Promise.resolve(client) })

describe("runSeed", () => {
  test("runs every catalog statement inside one committed transaction", async () => {
    const client = new FakeClient()
    const count = await runSeed(poolFor(client))

    expect(count).toBe(buildSeedStatements().length)
    expect(client.queries[0]?.text).toBe("BEGIN")
    expect(client.queries.at(-1)?.text).toBe("COMMIT")
    expect(client.queries.filter((query) => query.text.includes("INSERT INTO roles"))).toHaveLength(5)
    expect(client.released).toBe(true)
  })

  test("rolls back and rethrows when a statement fails", async () => {
    const client = new FakeClient("INSERT INTO permissions")
    await expect(runSeed(poolFor(client))).rejects.toThrow("forced failure")
    expect(client.queries.some((query) => query.text === "ROLLBACK")).toBe(true)
    expect(client.queries.some((query) => query.text === "COMMIT")).toBe(false)
    expect(client.released).toBe(true)
  })
})
