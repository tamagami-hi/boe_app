import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createUncachedCache } from "../../src/cache/cache.js"
import { createAdminCatalogRepository } from "../../src/repositories/adminCatalogRepository.js"
import { createFundAumRepository } from "../../src/repositories/fundAumRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerAdminCatalogRoutes } from "../../src/routes/adminCatalogRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

const LOCK_WAIT_POLL_MS = 25
const LOCK_WAIT_LIMIT_MS = 10_000

const LIFECYCLE_AUDITS = "entity_id = $1 and command in ('fund.published', 'fund.paused', 'fund.archived')"

const TERMS = {
  name: "Compounding Equity",
  category: "equity",
  objective: "Long-horizon compounding.",
  riskLevel: "high",
  returnTier: "high",
  minimumSipPaise: 500000,
  minimumPurchasePaise: 2500000,
  minimumDurationMonths: 12,
  recommendedHoldingMonths: 60,
  disclosure: { title: "Risk disclosure", body: "Equity investments can lose value." },
} as const

type Status = "published" | "paused" | "archived"

interface Lifecycle {
  readonly fundId: string
  readonly status: Status
  readonly version: number
}

interface FundSnapshot {
  readonly row: Readonly<Record<string, unknown>>
  readonly audits: number
}

let stack: PasswordMailStack
let app: FastifyInstance
let editor: AdminSession

const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): { code: string; fields?: Record<string, unknown> } =>
  (r.json() as { error: { code: string; fields?: Record<string, unknown> } }).error
const isReplay = (r: { json: () => unknown }): boolean | undefined =>
  (r.json() as { meta: { idempotencyReplay?: boolean } }).meta.idempotencyReplay

const quoted = (version: number): string => `"${String(version)}"`

const createFund = async (): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/funds",
    headers: adminHeaders(editor, `create-${randomUUID()}`),
    payload: {
      slug: `lifecycle-${randomUUID()}`,
      terms: TERMS,
      openingAum: { aumPaise: "10000000", asOfDate: "2026-07-31", reasonCode: "initial_publication" },
    },
  })
  expect(response.statusCode).toBe(201)
  return dataOf<{ fund: { id: string } }>(response).fund.id
}

const transition = (fundId: string, status: Status, ifMatch?: string, key = `lifecycle-${randomUUID()}`) =>
  app.inject({
    method: "PATCH",
    url: `/v1/admin/funds/${fundId}`,
    headers: { ...adminHeaders(editor, key), ...(ifMatch === undefined ? {} : { "if-match": ifMatch }) },
    payload: { status },
  })

const versionOf = async (fundId: string): Promise<number> =>
  Number((await stack.first("select version from funds where id = $1", [fundId])).version)

const snapshotOf = async (fundId: string): Promise<FundSnapshot> => ({
  row: await stack.first(
    "select state, version, updated_at, published_at, paused_at, archived_at from funds where id = $1",
    [fundId],
  ),
  audits: await stack.count("audit_events", LIFECYCLE_AUDITS, [fundId]),
})

const waitForBlockedChanges = async (count: number): Promise<void> => {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS
  while (Date.now() < deadline) {
    const waiting = await stack.first(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      [],
    )
    if (Number(waiting.n) >= count) return
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS))
  }
  throw new Error("the lifecycle changes never waited on the fund lock")
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminCatalogRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        cache: createUncachedCache(),
        config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
        catalogRepository: createAdminCatalogRepository(),
        aumRepository: createFundAumRepository(),
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
      })
    },
  })
  editor = await signInRoleAdmin(app, stack, "superadmin")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("changing a fund's state from the version the page was opened on", () => {
  test("refuses a stale If-Match and changes nothing, with no audit row or receipt", async () => {
    const fundId = await createFund()
    const opened = await versionOf(fundId)
    const other = await transition(fundId, "published", quoted(opened))
    const before = await snapshotOf(fundId)
    const staleKey = `lifecycle-${randomUUID()}`

    const stale = await transition(fundId, "archived", quoted(opened), staleKey)

    expect(other.statusCode).toBe(200)
    expect([stale.statusCode, errorOf(stale).code]).toEqual([409, "STATE_CONFLICT"])
    expect(errorOf(stale).fields).toHaveProperty("if-match")
    expect(await snapshotOf(fundId)).toEqual(before)
    expect(await stack.count("idempotency_records", "key = $1", [staleKey])).toBe(0)
  })

  test("applies a change whose If-Match is the fund's current version", async () => {
    const fundId = await createFund()
    const opened = await versionOf(fundId)

    const response = await transition(fundId, "published", quoted(opened))

    expect(response.statusCode).toBe(200)
    expect(dataOf<Lifecycle>(response)).toEqual({ fundId, status: "published", version: opened + 1 })
    expect((await snapshotOf(fundId)).audits).toBe(1)
  })

  test("applies a change sent without If-Match, as before", async () => {
    const fundId = await createFund()
    const opened = await versionOf(fundId)

    const response = await transition(fundId, "published")

    expect(response.statusCode).toBe(200)
    expect(dataOf<Lifecycle>(response)).toEqual({ fundId, status: "published", version: opened + 1 })
  })

  test("replays an accepted change resent with its key, also when its receipt was hashed without the header", async () => {
    const fundId = await createFund()
    const opened = await versionOf(fundId)
    const key = `lifecycle-${randomUUID()}`
    const first = await transition(fundId, "published", quoted(opened), key)
    const priorKey = `lifecycle-${randomUUID()}`
    const prior = await transition(fundId, "paused", undefined, priorKey)

    const resent = await transition(fundId, "published", quoted(opened), key)
    const resentPrior = await transition(fundId, "paused", quoted(opened + 1), priorKey)

    expect([first.statusCode, prior.statusCode]).toEqual([200, 200])
    expect([resent.statusCode, isReplay(resent), dataOf(resent)]).toEqual([200, true, dataOf(first)])
    expect([resentPrior.statusCode, isReplay(resentPrior), dataOf(resentPrior)]).toEqual([200, true, dataOf(prior)])
    expect((await snapshotOf(fundId)).audits).toBe(2)
  })
})

describe("simultaneous lifecycle changes of one fund", () => {
  test("of two changes sent from the same version exactly one applies", async () => {
    const fundId = await createFund()
    expect((await transition(fundId, "published")).statusCode).toBe(200)
    const opened = await versionOf(fundId)
    const before = await snapshotOf(fundId)
    const writer = await stack.pool.connect()
    try {
      await writer.query("begin")
      await writer.query("select id from funds where id = $1 for update", [fundId])
      const statuses: readonly Status[] = ["paused", "archived"]
      const pending = Promise.all(statuses.map((status) => transition(fundId, status, quoted(opened))))
      await waitForBlockedChanges(2)
      await writer.query("commit")

      const responses = await pending

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])
      const loser = responses.find((response) => response.statusCode === 409)!
      expect(errorOf(loser).fields).toHaveProperty("if-match")
      const after = await snapshotOf(fundId)
      expect([after.audits, Number(after.row.version)]).toEqual([before.audits + 1, opened + 1])
      expect(after.row.state).toBe(statuses[responses.findIndex((response) => response.statusCode === 200)])
    } finally {
      await writer.query("rollback")
      writer.release()
    }
  })
})
