import { randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import type { AccessTokenService } from "../../src/auth/accessToken.js"
import { createClientValueEntryRepository } from "../../src/repositories/clientValueEntryRepository.js"
import { registerClientStatementLinkRoutes } from "../../src/routes/clientStatementLinkRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminWebAuth } from "./adminSessionSupport.js"
import {
  envelopeOf,
  erase,
  recordFor,
  reverseEntry,
  rowsMentioningId,
  seedClient,
  startErasureHarness,
  type ErasureHarness,
  type SeededClient,
} from "./erasureSupport.js"
import { TTL_MS } from "./passwordMailSupport.js"

interface Client extends SeededClient {
  readonly bearer: string
}

interface IssuedLink {
  readonly token: string
}

const CONCURRENT_OPENS = 8
const LOCK_POLL_MS = 20
const LOCK_WAIT_LIMIT_MS = 10_000
const A_MONTHLY_PAISE = 12_000_000n
const B_MONTHLY_PAISE = 77_777_700n

let harness: ErasureHarness
let app: FastifyInstance
let tokens: AccessTokenService

const signIn = async (client: SeededClient): Promise<Client> => {
  const session = await harness.stack.first(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [client.id],
  )
  return { ...client, bearer: await tokens.sign({ sub: client.id, sid: String(session.id) }) }
}

const request = (client: Client, payload: object) =>
  app.inject({ method: "POST", url: "/v1/client/statement-links", headers: { authorization: `Bearer ${client.bearer}` }, payload })

const issue = async (client: Client, fromPeriod: string, toPeriod: string): Promise<IssuedLink> => {
  const response = await request(client, { fromPeriod, toPeriod })
  expect(response.statusCode).toBe(201)
  return envelopeOf<IssuedLink>(response).data
}

const open = (token: string) => app.inject({ method: "GET", url: `/v1/public/statement-links/${token}` })

const linkRow = (userId: string) => harness.stack.first("select * from client_statement_links where user_id = $1", [userId])

const waitForLockWaiter = async (): Promise<void> => {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS
  while (Date.now() < deadline) {
    const waiting = await harness.stack.first(
      "select count(*)::int as c from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      [],
    )
    if (Number(waiting.c) > 0) return
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
  }
  throw new Error("no request waited on the client's row")
}

beforeAll(async () => {
  harness = await startErasureHarness()
  tokens = (await adminWebAuth(harness.stack)).accessTokenService
  const { stack } = harness
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientStatementLinkRoutes(instance, {
        accessTokenService: tokens,
        database: stack.database,
        clientWeb: { originAllowlist: [] },
        unitOfWork: stack.unitOfWork,
        clientValueEntryRepository: createClientValueEntryRepository(),
        crypto: stack.crypto,
        clock: stack.clock,
        config: { linkTtlMs: TTL_MS },
      })
    },
  })
}, 220_000)

afterAll(async () => {
  await app.close()
  await harness.app.close()
  await harness.stack.stop()
})

describe("one-time statement links", () => {
  test("a link opens its own client's statement once and stores only a hash", async () => {
    const alice = await signIn(await seedClient(harness, { verified: true }))
    const bob = await signIn(await seedClient(harness, { verified: true }))
    await recordFor(harness, alice.id, A_MONTHLY_PAISE, "2025-01-15")
    await recordFor(harness, alice.id, A_MONTHLY_PAISE, "2025-02-15")
    await recordFor(harness, bob.id, B_MONTHLY_PAISE, "2025-03-15")
    await harness.stack.pool.query("update users set full_name = $2 where id = $1", [alice.id, `${alice.name} <b>&`])

    const aliceLink = await issue(alice, "2025-01", "2025-02")
    await issue(bob, "2025-03", "2025-03")
    expect(Object.keys(aliceLink)).toEqual(["token"])
    const stored = await linkRow(alice.id)
    expect(stored.token_hash).toEqual(harness.stack.crypto.hashToken(aliceLink.token).hash)
    expect(Number(stored.expires_at) - Number(stored.created_at)).toBe(TTL_MS)
    expect(await rowsMentioningId(harness.stack, aliceLink.token)).toEqual({})

    const first = await open(aliceLink.token)
    expect(first.statusCode).toBe(200)
    expect(first.headers["content-type"]).toBe("text/html; charset=utf-8")
    expect(first.headers["cache-control"]).toBe("no-store")
    expect(first.headers["referrer-policy"]).toBe("no-referrer")
    expect(first.headers["content-security-policy"]).toMatch(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/]+=*'; /u)
    expect(first.body).toContain(`Prepared for ${alice.name} &lt;b&gt;&amp; on `)
    expect(first.body).toContain("Covering Jan 2025 to Feb 2025")
    expect(first.body).toContain("₹1,20,000")
    expect(first.body).toContain("₹2,40,000")
    expect(first.body).toContain("Investments are subject to market risk.")
    expect(first.body).toContain("Last updated 15 Feb 2025")
    expect(first.body).not.toContain("<script")
    expect(first.body).not.toContain(bob.name)
    expect(first.body).not.toContain("₹7,77,777")
    expect(first.body).not.toContain("Mar 2025")

    const unknown = await open("A".repeat(43))
    const again = await open(aliceLink.token)
    expect(again.statusCode).toBe(404)
    expect(again.body).toBe(unknown.body)
    expect(unknown.statusCode).toBe(404)
    expect((await linkRow(bob.id)).consumed_at).toBeNull()
  })

  test("an expired link is refused and a suspended account's link renders nothing", async () => {
    const carol = await signIn(await seedClient(harness, { verified: true }))
    await recordFor(harness, carol.id, A_MONTHLY_PAISE, "2025-01-15")
    try {
      const late = await issue(carol, "2025-01", "2025-01")
      harness.stack.clockOffsetMs = TTL_MS
      expect((await open(late.token)).statusCode).toBe(404)
      harness.stack.clockOffsetMs = 0
      const inTime = await issue(carol, "2025-01", "2025-01")
      harness.stack.clockOffsetMs = TTL_MS - 1_000
      expect((await open(inTime.token)).statusCode).toBe(200)
    } finally {
      harness.stack.clockOffsetMs = 0
    }

    const held = await issue(carol, "2025-01", "2025-01")
    await harness.stack.setAccountState(carol.id, "suspended")
    expect((await open(held.token)).statusCode).toBe(404)
    expect((await linkRow(carol.id)).consumed_at).toBeNull()
  })

  test("a client can ask only for months of their own statement", async () => {
    const dave = await signIn(await seedClient(harness, { verified: true }))
    const erin = await signIn(await seedClient(harness, { verified: true }))
    await recordFor(harness, dave.id, A_MONTHLY_PAISE, "2025-01-15")
    await recordFor(harness, erin.id, B_MONTHLY_PAISE, "2025-03-15")
    const before = await linkRow(dave.id)

    const foreign = await request(dave, { fromPeriod: "2025-03", toPeriod: "2025-03" })
    expect(foreign.statusCode).toBe(404)
    expect(envelopeOf(foreign).error.code).toBe("RESOURCE_NOT_FOUND")
    const widened = await request(dave, { fromPeriod: "2025-01", toPeriod: "2025-03" })
    expect(widened.statusCode).toBe(404)
    const named = await request(dave, { fromPeriod: "2025-03", toPeriod: "2025-03", userId: erin.id })
    expect(named.statusCode).toBe(400)
    const reversed = await request(dave, { fromPeriod: "2025-02", toPeriod: "2025-01" })
    expect(reversed.statusCode).toBe(400)
    const anonymous = await app.inject({ method: "POST", url: "/v1/client/statement-links", payload: { fromPeriod: "2025-01", toPeriod: "2025-01" } })
    expect(anonymous.statusCode).toBe(401)
    expect(await linkRow(dave.id)).toEqual(before)
  })

  test("concurrent opens of one link render it exactly once", async () => {
    const frank = await signIn(await seedClient(harness, { verified: true }))
    await recordFor(harness, frank.id, A_MONTHLY_PAISE, "2025-01-15")
    const link = await issue(frank, "2025-01", "2025-01")
    const statuses = (await Promise.all(Array.from({ length: CONCURRENT_OPENS }, () => open(link.token)))).map(
      (response) => response.statusCode,
    )
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(statuses.filter((status) => status === 404)).toHaveLength(CONCURRENT_OPENS - 1)
  })

  test("a link requested while erasure holds the client cannot outlive it", async () => {
    const henry = await signIn(await seedClient(harness, { verified: true }))
    await recordFor(harness, henry.id, A_MONTHLY_PAISE, "2025-01-15")
    const eraser = await harness.stack.pool.connect()
    try {
      await eraser.query("begin")
      await eraser.query("select id from users where id = $1 for update", [henry.id])
      await eraser.query("update users set account_state = 'closed', closed_at = now() where id = $1", [henry.id])
      await eraser.query("delete from client_statement_links where user_id = $1", [henry.id])
      const pending = request(henry, { fromPeriod: "2025-01", toPeriod: "2025-01" })
      await waitForLockWaiter()
      await eraser.query("commit")
      const response = await pending
      expect(response.statusCode).toBe(403)
      expect(envelopeOf(response).error.code).toBe("ACCOUNT_NOT_ACTIVE")
      expect(await harness.stack.count("client_statement_links", "user_id = $1", [henry.id])).toBe(0)
    } finally {
      eraser.release()
    }
  })

  test("a new link retires the previous one and erasure removes the client's link", async () => {
    const grace = await signIn(await seedClient(harness, { verified: true }))
    const recorded = await recordFor(harness, grace.id, A_MONTHLY_PAISE, "2025-01-15")
    const replaced = await issue(grace, "2025-01", "2025-01")
    const live = await issue(grace, "2025-01", "2025-01")
    expect((await open(replaced.token)).statusCode).toBe(404)

    await reverseEntry(harness, grace.id, recorded.entryId, A_MONTHLY_PAISE)
    expect((await erase(harness, grace.id, "kept_as_record", randomUUID())).statusCode).toBe(200)
    expect(await harness.stack.count("client_statement_links", "user_id = $1", [grace.id])).toBe(0)
    expect((await open(live.token)).statusCode).toBe(404)
  })
})
