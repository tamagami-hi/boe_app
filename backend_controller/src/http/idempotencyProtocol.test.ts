import { describe, expect, test } from "vitest"

import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope,
  Transaction,
} from "../db/repositories.js"

import { AppError } from "./errorCatalog.js"
import { executeIdempotent, idempotencyKeySchema } from "./idempotencyProtocol.js"

const TX = {} as Transaction
const SCOPE: IdempotencyScope = {
  actorScope: "public",
  actorScopeKeyVersion: null,
  candidateActorScopes: ["public"],
  method: "POST",
  routeTemplate: "/v1/applications",
  key: "abcd1234efgh",
}
const HASH = new Uint8Array(Array.from({ length: 32 }, (_value, index) => index + 1))

const record = (overrides: Partial<{ request_hash: Uint8Array; response_status: number; response_body: unknown }>) =>
  ({
    request_hash: overrides.request_hash ?? HASH,
    response_status: overrides.response_status ?? 202,
    response_body: overrides.response_body ?? { accepted: true },
  }) as unknown as IdempotencyRecord

class FakeRepo implements IdempotencyRepository {
  inserted = 0
  constructor(
    private readonly lockAcquired: boolean,
    private readonly completed: IdempotencyRecord | null = null,
  ) {}
  tryAcquireTransactionLock(): Promise<boolean> {
    return Promise.resolve(this.lockAcquired)
  }
  findCompleted(): Promise<IdempotencyRecord | null> {
    return Promise.resolve(this.completed)
  }
  insertCompleted(): Promise<IdempotencyRecord> {
    this.inserted += 1
    return Promise.resolve(record({}))
  }
}

const run = (repository: IdempotencyRepository) =>
  executeIdempotent({
    repository,
    tx: TX,
    scope: SCOPE,
    requestHash: HASH,
    now: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-02T00:00:00.000Z",
    execute: () => Promise.resolve({ status: 202, body: { accepted: true } }),
  })

describe("idempotencyKeySchema", () => {
  test("accepts valid keys and rejects malformed ones", () => {
    expect(idempotencyKeySchema.safeParse("abcd1234efgh").success).toBe(true)
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false)
    expect(idempotencyKeySchema.safeParse("has space!!").success).toBe(false)
  })
})

describe("executeIdempotent", () => {
  test("executes and persists when the lock is acquired", async () => {
    const repo = new FakeRepo(true)
    const outcome = await run(repo)
    expect(outcome).toEqual({ status: 202, body: { accepted: true }, replay: false })
    expect(repo.inserted).toBe(1)
  })

  test("replays a byte-identical completed record", async () => {
    const outcome = await run(new FakeRepo(false, record({ request_hash: new Uint8Array(HASH) })))
    expect(outcome.replay).toBe(true)
    expect(outcome.status).toBe(202)
  })

  test("rejects a different request hash as reused", async () => {
    const mismatched = record({ request_hash: new Uint8Array(32).fill(9) })
    await expect(run(new FakeRepo(false, mismatched))).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" })
  })

  test("reports an in-progress request when no record exists", async () => {
    await expect(run(new FakeRepo(false, null))).rejects.toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      retryAfterSeconds: 1,
    })
    await expect(run(new FakeRepo(false, null))).rejects.toBeInstanceOf(AppError)
  })
})
