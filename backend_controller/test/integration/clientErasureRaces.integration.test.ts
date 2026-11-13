import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import {
  clientLogin,
  envelopeOf,
  erase,
  recordFor,
  seedClient,
  startErasureHarness,
  userRow,
  type ErasureHarness,
} from "./erasureSupport.js"

interface Outcome {
  readonly userId: string
  readonly outcome: string
  readonly path: string
  readonly keptBecause: string | null
  readonly erasedAt: string
}

const ROUNDS = 4

let harness: ErasureHarness

beforeAll(async () => {
  harness = await startErasureHarness()
}, 220_000)

afterAll(async () => {
  await harness.app.close()
  await harness.stack.stop()
})

describe("erasure is idempotent", () => {
  test("a replay with the same key returns the first outcome and a new key reports the client already erased", async () => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: true })
    const key = randomUUID()
    const first = await erase(harness, client.id, "kept_as_record", key)
    expect(first.statusCode).toBe(200)
    const auditAfterFirst = await stack.count("audit_events", "entity_id = $1", [client.id])
    const versionAfterFirst = (await userRow(stack, client.id)).version

    const replay = await erase(harness, client.id, "kept_as_record", key)
    expect(replay.statusCode).toBe(200)
    expect(envelopeOf<Outcome>(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf<Outcome>(replay).data).toEqual(envelopeOf<Outcome>(first).data)

    const fresh = await erase(harness, client.id, "kept_as_record")
    expect(fresh.statusCode).toBe(200)
    expect(envelopeOf<Outcome>(fresh).data).toMatchObject({ outcome: "already_erased", path: "kept_as_record" })
    expect(envelopeOf<Outcome>(fresh).data.erasedAt).toBe(envelopeOf<Outcome>(first).data.erasedAt)
    expect(await stack.count("audit_events", "entity_id = $1", [client.id])).toBe(auditAfterFirst)
    expect((await userRow(stack, client.id)).version).toBe(versionAfterFirst)
    expect(await stack.count("audit_events", "entity_id = $1 and command = 'client.erased'", [client.id])).toBe(1)

    const deleted = await seedClient(harness, { verified: false })
    expect((await erase(harness, deleted.id, "deleted")).statusCode).toBe(200)
    const gone = await erase(harness, deleted.id, "deleted")
    expect(gone.statusCode).toBe(200)
    expect(envelopeOf<Outcome>(gone).data).toMatchObject({ outcome: "already_erased", path: "deleted" })
  })

  test("two concurrent erasures with different keys erase once", async () => {
    const client = await seedClient(harness, { verified: true })
    const results = await Promise.all([erase(harness, client.id, "kept_as_record"), erase(harness, client.id, "kept_as_record")])
    expect(results.map((result) => result.statusCode)).toEqual([200, 200])
    expect(results.map((result) => envelopeOf<Outcome>(result).data.outcome).sort()).toEqual(["already_erased", "erased"])
    expect(await harness.stack.count("audit_events", "entity_id = $1 and command = 'client.erased'", [client.id])).toBe(1)
  })
})

describe("erasure does not race money or sign-in into a half state", () => {
  test("a concurrent recording either lands before the erasure, which then refuses, or is refused after it", async () => {
    const { stack } = harness
    for (let round = 0; round < ROUNDS; round += 1) {
      const client = await seedClient(harness, { verified: true })
      const [erased, recorded] = await Promise.allSettled([
        erase(harness, client.id, "kept_as_record"),
        recordFor(harness, client.id, 90_000n),
      ])
      const eraseStatus = erased.status === "fulfilled" ? erased.value.statusCode : 0
      const entries = await stack.count("client_value_entries", "user_id = $1", [client.id])
      const user = await userRow(stack, client.id)
      if (recorded.status === "fulfilled") {
        expect(eraseStatus).toBe(409)
        expect(entries).toBe(1)
        expect(user.pii_tombstoned_at).toBeNull()
        expect(user.account_state).toBe("active")
      } else {
        expect(eraseStatus).toBe(200)
        expect(entries).toBe(0)
        expect(user.pii_tombstoned_at).not.toBeNull()
        expect(await stack.count("investment_orders", "user_id = $1", [client.id])).toBe(0)
      }
    }
  })

  test("a concurrent sign-in either is revoked by the erasure or is refused after it", async () => {
    const { stack } = harness
    for (let round = 0; round < ROUNDS; round += 1) {
      const client = await seedClient(harness, { verified: true })
      const [erased, login] = await Promise.all([erase(harness, client.id, "kept_as_record"), clientLogin(harness, client.email)])
      expect(erased.statusCode).toBe(200)
      expect(await stack.count("auth_sessions", "user_id = $1 and state = 'active'", [client.id])).toBe(0)
      expect(await stack.count("auth_refresh_tokens", "user_id = $1 and revoked_at is null and used_at is null", [client.id])).toBe(0)
      if (login.statusCode === 200) {
        expect(await stack.count("auth_sessions", "user_id = $1 and state = 'revoked'", [client.id])).toBeGreaterThan(0)
      }
    }
  })
})
