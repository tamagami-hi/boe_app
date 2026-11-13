import { randomUUID } from "node:crypto"

import type { PoolClient } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import {
  clientLogin,
  envelopeOf,
  erase,
  recordFor,
  seedClient,
  startErasureHarness,
  tableSnapshot,
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

type Claim = (connection: PoolClient, deliveryId: string, outboxId: string) => Promise<void>

const IN_FLIGHT: readonly (readonly [string, string, Claim])[] = [
  [
    "a delivery marked sending",
    "email_deliveries",
    async (connection, deliveryId) => {
      await connection.query("select id from email_deliveries where id = $1 for update", [deliveryId])
      await connection.query(
        "update email_deliveries set state = 'sending', attempt_count = attempt_count + 1, last_attempt_at = now() where id = $1",
        [deliveryId],
      )
    },
  ],
  [
    "an outbox event claimed by the worker",
    "outbox_events",
    async (connection, _deliveryId, outboxId) => {
      await connection.query(
        "update outbox_events set state = 'processing', lease_generation = lease_generation + 1, locked_at = now(), " +
          "locked_by = 'erase-test-worker', lease_expires_at = now() + interval '5 minutes' where id = $1",
        [outboxId],
      )
    },
  ],
]

const waitForLockWait = async (): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await harness.stack.first(
      "select count(*)::int as c from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
      [],
    )
    if (Number(waiting.c) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("the erasure never waited on the mail lock")
}

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

describe("erasure does not race money, mail or sign-in into a half state", () => {
  test.each(IN_FLIGHT)("refuses and changes nothing when %s commits while erasure waits", async (_label, table, claim) => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: true })
    const delivery = await stack.first(
      "select id, outbox_event_id from email_deliveries where user_id = $1 and state = 'queued' order by created_at limit 1",
      [client.id],
    )
    const before = await tableSnapshot(stack, [table])
    const connection = await stack.pool.connect()
    try {
      await connection.query("begin")
      await claim(connection, String(delivery.id), String(delivery.outbox_event_id))
      const pending = erase(harness, client.id, "kept_as_record")
      await waitForLockWait()
      await connection.query("commit")
      const response = await pending
      expect(response.statusCode).toBe(409)
      expect(envelopeOf<never>(response).error.fields).toHaveProperty("mail_in_flight")
    } finally {
      connection.release()
    }
    expect(await tableSnapshot(stack, [table])).toBe(before)
    expect((await userRow(stack, client.id)).pii_tombstoned_at).toBeNull()
    expect(await stack.count("email_deliveries", "user_id = $1 and recipient_ciphertext is null", [client.id])).toBe(0)
  })

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
