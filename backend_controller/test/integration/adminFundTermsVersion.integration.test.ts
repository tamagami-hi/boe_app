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

interface FundState {
  readonly versions: number
  readonly disclosures: number
  readonly audits: number
  readonly row: Readonly<Record<string, unknown>>
}

let stack: PasswordMailStack
let app: FastifyInstance
let editor: AdminSession

const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): { code: string; fields?: Record<string, unknown> } =>
  (r.json() as { error: { code: string; fields?: Record<string, unknown> } }).error

const createFund = async (): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/funds",
    headers: adminHeaders(editor, `create-${randomUUID()}`),
    payload: {
      slug: `terms-${randomUUID()}`,
      terms: TERMS,
      openingAum: { aumPaise: "10000000", asOfDate: "2026-07-31", reasonCode: "initial_publication" },
    },
  })
  expect(response.statusCode).toBe(201)
  return dataOf<{ fund: { id: string } }>(response).fund.id
}

const publish = (fundId: string, name: string, expectedVersion?: number, key = `version-${randomUUID()}`) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/funds/${fundId}/versions${expectedVersion === undefined ? "" : `?expectedVersion=${String(expectedVersion)}`}`,
    headers: adminHeaders(editor, key),
    payload: { ...TERMS, name },
  })

const versionOf = (response: { json: () => unknown }): number => dataOf<{ version: number }>(response).version

const stateOf = async (fundId: string): Promise<FundState> => ({
  versions: await stack.count("fund_versions", "fund_id = $1", [fundId]),
  disclosures: await stack.count("fund_disclosure_versions", "fund_id = $1", [fundId]),
  audits: await stack.count("audit_events", "entity_id = $1 and command = 'fund.version_published'", [fundId]),
  row: await stack.first(
    "select f.current_published_version_id, f.version, f.updated_at, fv.name from funds f " +
      "join fund_versions fv on fv.id = f.current_published_version_id where f.id = $1",
    [fundId],
  ),
})

const waitForBlockedPublishes = async (count: number): Promise<void> => {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS
  while (Date.now() < deadline) {
    const waiting = await stack.first(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      [],
    )
    if (Number(waiting.n) >= count) return
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS))
  }
  throw new Error("the publishes never waited on the fund lock")
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

describe("publishing fund terms from the version the form was opened on", () => {
  test("refuses terms opened on an older version and changes nothing, while the current version publishes", async () => {
    const fundId = await createFund()
    const fromOne = await publish(fundId, "Published by the other admin", 1)
    const before = await stateOf(fundId)
    const staleKey = `version-${randomUUID()}`

    const stale = await publish(fundId, "Edited from version 1", 1, staleKey)

    expect([fromOne.statusCode, versionOf(fromOne)]).toEqual([201, 2])
    expect([stale.statusCode, errorOf(stale).code]).toEqual([409, "STATE_CONFLICT"])
    expect(errorOf(stale).fields).toHaveProperty("expectedVersion")
    expect(await stateOf(fundId)).toEqual(before)
    expect(await stack.count("idempotency_records", "key = $1", [staleKey])).toBe(0)

    const current = await publish(fundId, "Edited from version 2", 2)

    expect([current.statusCode, versionOf(current)]).toEqual([201, 3])
    expect((await stateOf(fundId)).row.name).toBe("Edited from version 2")
  })

  test("still publishes a request without the expected version, as released admin apps send it", async () => {
    const fundId = await createFund()
    await publish(fundId, "Second terms", 1)

    const released = await publish(fundId, "Released app terms")

    expect([released.statusCode, versionOf(released)]).toEqual([201, 3])
    expect((await stateOf(fundId)).row.name).toBe("Released app terms")
  })

  test("resending an accepted publish with its key replays it instead of refusing it as stale", async () => {
    const fundId = await createFund()
    const key = `version-${randomUUID()}`
    const first = await publish(fundId, "Sent once", 1, key)
    await publish(fundId, "Published afterwards", 2)

    const resent = await publish(fundId, "Sent once", 1, key)

    expect([resent.statusCode, versionOf(resent)]).toEqual([201, versionOf(first)])
    expect(resent.json<{ meta: { idempotencyReplay?: boolean } }>().meta.idempotencyReplay).toBe(true)
    expect((await stateOf(fundId)).versions).toBe(3)
  })
})

describe("simultaneous publishes of fund terms", () => {
  test("of two forms opened on the same version exactly one publishes", async () => {
    const fundId = await createFund()
    const before = await stateOf(fundId)
    const writer = await stack.pool.connect()
    try {
      await writer.query("begin")
      await writer.query("select id from funds where id = $1 for update", [fundId])
      const pending = Promise.all([publish(fundId, "Tab one", 1), publish(fundId, "Tab two", 1)])
      await waitForBlockedPublishes(2)
      await writer.query("commit")

      const responses = await pending

      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409])
      const after = await stateOf(fundId)
      expect([after.versions, after.audits]).toEqual([before.versions + 1, before.audits + 1])
    } finally {
      await writer.query("rollback")
      writer.release()
    }
  })
})
