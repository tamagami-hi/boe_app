import { createUncachedCache } from "../../src/cache/cache.js"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createClientAccountRepository } from "../../src/repositories/clientAccountRepository.js"
import { createInvestorLedgerRepository } from "../../src/repositories/investorLedgerRepository.js"
import {
  registerClientAccountRoutes,
  type ClientAccountDeps,
} from "../../src/routes/clientAccountRoutes.js"
import { registerPublicContentRoutes } from "../../src/routes/publicContentRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

let container: StartedPostgreSqlContainer
let pool: Pool
let app: FastifyInstance
let accessTokenService: AccessTokenService

let investorId: string
let investorToken: string
let otherToken: string
let fundId: string

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): string =>
  (response.json() as { error: { code: string } }).error.code
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

const seedUserWithSession = async (
  email: string,
  phone: string,
): Promise<{ userId: string; token: string }> => {
  const user = await pool.query<{ id: string }>(
    "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
      "values ($1,$2,'Account Test','active', now()) returning id",
    [email, phone],
  )
  const userId = user.rows[0]?.id as string
  const session = await pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1,'native','rt1', now() + interval '90 days') returning id",
    [userId],
  )
  const token = await accessTokenService.sign({ sub: userId, sid: session.rows[0]?.id as string })
  return { userId, token }
}

/** Append a ledger entry; the statement surface is derived from these. */
const appendEntry = async (
  userId: string,
  entryType: "lump_sum" | "gain_allocation" | "redemption",
  effectiveDate: string,
  principalDelta: bigint,
  valueDelta: bigint,
): Promise<void> => {
  const amount = valueDelta < 0n ? -valueDelta : valueDelta
  const allocator = entryType === "gain_allocation" ? investorId : null
  await pool.query(
    "insert into investor_ledger_entries (user_id, fund_id, entry_type, principal_delta_paise, " +
      "value_delta_paise, amount_paise, effective_date, allocated_by_user_id, request_id) " +
      "values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      userId,
      fundId,
      entryType,
      principalDelta.toString(),
      valueDelta.toString(),
      amount.toString(),
      effectiveDate,
      allocator,
      randomUUID(),
    ],
  )
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({
    connectionString: container.getConnectionUri(),
    poolMax: 5,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
  })
  const migrations = await loadMigrationFiles(fileURLToPath(new URL("../../db/migrations", import.meta.url)))
  await runMigrations(pool, migrations)
  await runSeed(pool)

  const database = createDatabase(pool)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })

  const clientAccountRepository = createClientAccountRepository()
  const unitOfWork = createUnitOfWork(database)
  const deps: ClientAccountDeps = {
    accessTokenService,
    database,
    clientAccountRepository,
    investorLedgerRepository: createInvestorLedgerRepository(),
    auditRepository: createAuditRepository(),
    notificationRepository: createNotificationRepository(),
    unitOfWork,
    clock: () => new Date(),
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientAccountRoutes(instance, deps)
      registerPublicContentRoutes(instance, {
          clientAccountRepository,
          unitOfWork,
          cache: createUncachedCache(),
          config: { publicContentTtlMs: 0 },
        })
    },
  })

  const investor = await seedUserWithSession("account-investor@example.com", "+14155550701")
  investorId = investor.userId
  investorToken = investor.token
  const other = await seedUserWithSession("account-other@example.com", "+14155550702")
  otherToken = other.token

  const fund = await pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) " +
      "values ('account-pool','published', now(), $1) returning id",
    [investorId],
  )
  fundId = fund.rows[0]?.id as string
}, 200_000)

afterAll(async () => {
  await app.close()
  await pool.end()
  await container.stop()
})

describe("client notifications (integration)", () => {
  test("lists the investor's inbox with an unread count and marks one read", async () => {
    const inserted = await pool.query<{ id: string }>(
      "insert into notifications (user_id, kind, title, body) values " +
        "($1,'order_booked','Investment booked','Your investment is now live.')," +
        "($1,'gain_allocated','Returns credited','Returns were credited to your account.') returning id",
      [investorId],
    )
    const first = inserted.rows[0]?.id as string

    const listed = await app.inject({
      method: "GET",
      url: "/v1/client/notifications",
      headers: bearer(investorToken),
    })
    expect(listed.statusCode).toBe(200)
    const inbox = dataOf<{ items: { id: string; read: boolean }[]; unreadCount: number }>(listed)
    expect(inbox.items).toHaveLength(2)
    expect(inbox.unreadCount).toBe(2)

    const marked = await app.inject({
      method: "PATCH",
      url: `/v1/client/notifications/${first}`,
      headers: bearer(investorToken),
      payload: { read: true },
    })
    expect(marked.statusCode).toBe(200)
    expect(dataOf<{ read: boolean; readAt: string | null }>(marked).read).toBe(true)

    const after = await app.inject({
      method: "GET",
      url: "/v1/client/notifications",
      headers: bearer(investorToken),
    })
    expect(dataOf<{ unreadCount: number }>(after).unreadCount).toBe(1)
  })

  test("another investor's notification is not readable or markable", async () => {
    const row = await pool.query<{ id: string }>(
      "insert into notifications (user_id, kind, title, body) values ($1,'x','Private','Body') returning id",
      [investorId],
    )
    const foreign = await app.inject({
      method: "PATCH",
      url: `/v1/client/notifications/${row.rows[0]?.id as string}`,
      headers: bearer(otherToken),
      payload: { read: true },
    })
    expect(foreign.statusCode).toBe(404)
    expect(errorOf(foreign)).toBe("RESOURCE_NOT_FOUND")

    const otherInbox = await app.inject({
      method: "GET",
      url: "/v1/client/notifications",
      headers: bearer(otherToken),
    })
    expect(dataOf<{ items: unknown[] }>(otherInbox).items).toEqual([])
  })

  test("an unauthenticated inbox read is refused", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/client/notifications" })
    expect(response.statusCode).toBe(401)
  })
})

describe("client payments (integration)", () => {
  test("lists payments newest first and filters by status group", async () => {
    const order = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_at) " +
        "values ($1,$2,'purchase','booked',10000000, now()) returning id",
      [investorId, fundId],
    )
    const orderId = order.rows[0]?.id as string
    const succeeded = await pool.query<{ id: string }>(
      "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) " +
        "values ($1,$2,10000000,'succeeded', now()) returning id",
      [orderId, investorId],
    )
    await pool.query(
      "insert into payment_attempts (payment_id, user_id, attempt_number, state, provider, expires_at) " +
        "values ($1,$2,1,'succeeded','manual', now() + interval '1 hour')",
      [succeeded.rows[0]?.id, investorId],
    )
    const pendingOrder = await pool.query<{ id: string }>(
      "insert into investment_orders (user_id, fund_id, type, state, amount_paise, requested_at) " +
        "values ($1,$2,'purchase','payment_pending',2500000, now()) returning id",
      [investorId, fundId],
    )
    await pool.query(
      "insert into payments (order_id, user_id, amount_paise, state) values ($1,$2,2500000,'created')",
      [pendingOrder.rows[0]?.id, investorId],
    )

    const all = await app.inject({
      method: "GET",
      url: "/v1/client/payments",
      headers: bearer(investorToken),
    })
    expect(all.statusCode).toBe(200)
    const items = dataOf<{ items: { status: string; amountPaise: string; provider: string | null }[] }>(all)
      .items
    expect(items).toHaveLength(2)
    // Newest first: the pending payment was created last.
    expect(items[0]?.status).toBe("created")
    expect(items[0]?.amountPaise).toBe("2500000")
    // The provider comes off the latest attempt.
    expect(items[1]?.provider).toBe("manual")

    // The app asks with its own vocabulary; aliases resolve to storage states.
    const settled = await app.inject({
      method: "GET",
      url: "/v1/client/payments?status=success,confirmed,reconciled",
      headers: bearer(investorToken),
    })
    expect(dataOf<{ items: { status: string }[] }>(settled).items.map((row) => row.status)).toEqual([
      "succeeded",
    ])

    const pending = await app.inject({
      method: "GET",
      url: "/v1/client/payments?status=pending",
      headers: bearer(investorToken),
    })
    expect(dataOf<{ items: { status: string }[] }>(pending).items).toHaveLength(1)
  })

  test("an unknown status is rejected rather than silently ignored", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/payments?status=not_a_state",
      headers: bearer(investorToken),
    })
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("VALIDATION_FAILED")
  })

  test("payments are scoped to the owner", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/payments",
      headers: bearer(otherToken),
    })
    expect(dataOf<{ items: unknown[] }>(response).items).toEqual([])
  })
})

describe("client statements (integration)", () => {
  test("derives a statement per month from the ledger, newest first", async () => {
    // ₹1,00,000 in July, ₹20,000 of growth in August, ₹5,000 paid out in August.
    await appendEntry(investorId, "lump_sum", "2026-07-10", 10_000_000n, 10_000_000n)
    await appendEntry(investorId, "gain_allocation", "2026-08-31", 0n, 2_000_000n)
    await appendEntry(investorId, "redemption", "2026-08-31", 0n, -500_000n)

    const response = await app.inject({
      method: "GET",
      url: "/v1/client/statements",
      headers: bearer(investorToken),
    })
    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: Record<string, string>[] }>(response).items
    expect(items.map((row) => row.period)).toEqual(["2026-08", "2026-07"])

    expect(items[1]).toMatchObject({
      period: "2026-07",
      openingValuePaise: "0",
      contributionsPaise: "10000000",
      closingValuePaise: "10000000",
    })
    expect(items[0]).toMatchObject({
      period: "2026-08",
      // August opens where July closed and closes on the live figures.
      openingValuePaise: "10000000",
      returnsPaise: "2000000",
      withdrawalsPaise: "500000",
      closingValuePaise: "11500000",
      // The payout drew only from returns, so nothing left total investment.
      totalInvestmentPaise: "10000000",
    })
  })

  test("an investor with no ledger has no statements", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/statements",
      headers: bearer(otherToken),
    })
    expect(dataOf<{ items: unknown[] }>(response).items).toEqual([])
  })
})

describe("client support (integration)", () => {
  test("serves the published FAQs", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/support/faqs",
      headers: bearer(investorToken),
    })
    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: { q: string; a: string }[] }>(response).items
    expect(items.length).toBeGreaterThan(3)
    expect(items.every((item) => item.q.length > 0 && item.a.length > 0)).toBe(true)
    // The seeded copy must not describe the retired unit/NAV model.
    expect(JSON.stringify(items).toLowerCase()).not.toContain("nav")
  })

  test("raises a request, returns it with a reference, and keeps it owner-scoped", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/client/support/tickets",
      headers: bearer(investorToken),
      payload: { subject: "Withdrawal not received", body: "I redeemed last week.", category: "payouts" },
    })
    expect(created.statusCode).toBe(201)
    const ticket = dataOf<{ id: string; reference: string; status: string }>(created)
    expect(ticket.status).toBe("open")
    expect(ticket.reference).toMatch(/^BOE-[0-9A-F]{8}$/u)

    const listed = await app.inject({
      method: "GET",
      url: "/v1/client/support/tickets",
      headers: bearer(investorToken),
    })
    expect(dataOf<{ items: { id: string }[] }>(listed).items.map((row) => row.id)).toContain(ticket.id)

    // Another investor sees none of it.
    const foreign = await app.inject({
      method: "GET",
      url: "/v1/client/support/tickets",
      headers: bearer(otherToken),
    })
    expect(dataOf<{ items: unknown[] }>(foreign).items).toEqual([])

    // The request is audited under the investor.
    const audit = await pool.query<{ command: string }>(
      "select command from audit_events where entity_id = $1",
      [ticket.id],
    )
    expect(audit.rows.map((row) => row.command)).toContain("support.request_created")
  })

  test("an empty subject or body is refused", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/support/tickets",
      headers: bearer(investorToken),
      payload: { subject: "   ", body: "" },
    })
    expect(response.statusCode).toBe(400)
    expect(errorOf(response)).toBe("VALIDATION_FAILED")
  })
})

describe("client research context (integration)", () => {
  test("serves the published context items", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/client/research-context",
      headers: bearer(investorToken),
    })
    expect(response.statusCode).toBe(200)
    const body = dataOf<{ items: { title: string }[]; title: string }>(response)
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((item) => typeof item.title === "string")).toBe(true)
  })
})

describe("public content (integration)", () => {
  test("disclosures, charter and grievance policy are readable without a session", async () => {
    const disclosures = await app.inject({ method: "GET", url: "/v1/public/disclosures" })
    expect(disclosures.statusCode).toBe(200)
    expect(dataOf<{ riskometer: { level: string }; expenseRatio: string }>(disclosures)).toMatchObject({
      riskometer: { level: "moderate" },
    })

    const charter = await app.inject({ method: "GET", url: "/v1/public/investor-charter" })
    expect(charter.statusCode).toBe(200)
    const charterBody = dataOf<{ title: string; sections: { heading: string }[] }>(charter)
    expect(charterBody.title).toBe("Investor Charter")
    expect(charterBody.sections.length).toBeGreaterThan(2)

    const grievance = await app.inject({ method: "GET", url: "/v1/public/grievance" })
    expect(grievance.statusCode).toBe(200)
    const grievanceBody = dataOf<{ steps: { step: number }[]; timelines: unknown[] }>(grievance)
    expect(grievanceBody.steps.map((step) => step.step)).toEqual([1, 2, 3])
    expect(grievanceBody.timelines.length).toBeGreaterThan(0)
  })

  test("an unpublished document is a 404, so the app can fall back", async () => {
    await pool.query("update content_items set state = 'archived' where content_key = 'disclosures'")
    const response = await app.inject({ method: "GET", url: "/v1/public/disclosures" })
    expect(response.statusCode).toBe(404)
    await pool.query("update content_items set state = 'published' where content_key = 'disclosures'")
  })
})


/**
 * POST /v1/client/app-version — the authenticated report that drives the update
 * notification. Exercised against real Postgres because the whole point is which
 * `notifications` rows exist afterwards.
 *
 * `latest` is resolved from the release directory, which is not mounted in this
 * harness, so these cases cover the reconciliation contract that does not depend
 * on it: authentication, validation, and the "nothing published" branch that must
 * retire a stale prompt. The behind/notify/supersede matrix is covered by the
 * unit tests in src/domain/client/reconcileAppVersion.test.ts.
 */
describe("client app-version report (integration)", () => {
  const validBody = {
    platform: "android" as const,
    variant: "client" as const,
    applicationId: "com.beonedge.app.dev",
    versionName: "0.7.5",
    versionCode: 705,
  }

  test("requires a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/app-version",
      payload: validBody,
    })
    expect(response.statusCode).toBe(401)
  })

  test("rejects an unknown field instead of ignoring it", async () => {
    const { token } = await seedUserWithSession("appver-strict@example.com", "+14155550301")
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/app-version",
      headers: bearer(token),
      payload: { ...validBody, surprise: true },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } })
  })

  test("rejects a variant outside the known set", async () => {
    const { token } = await seedUserWithSession("appver-variant@example.com", "+14155550302")
    const response = await app.inject({
      method: "POST",
      url: "/v1/client/app-version",
      headers: bearer(token),
      payload: { ...validBody, variant: "../../etc" },
    })
    expect(response.statusCode).toBe(400)
  })

  test("retires a stale update prompt when nothing is published", async () => {
    // The release directory is unmounted here, so `latest` is null — the same
    // state a deployment without the APK mount is in. A leftover prompt must not
    // survive it, or the inbox would nag about a build nobody can offer.
    const { userId, token } = await seedUserWithSession("appver-retire@example.com", "+14155550303")
    await pool.query(
      "insert into notifications (user_id, kind, title, body, payload) " +
        "values ($1,'app_update_available','App update available','Version 0.7.6 is ready to install.', $2)",
      [userId, JSON.stringify({ versionCode: 706, version: "0.7.6" })],
    )

    const response = await app.inject({
      method: "POST",
      url: "/v1/client/app-version",
      headers: bearer(token),
      payload: validBody,
    })

    expect(response.statusCode).toBe(200)
    expect(dataOf<{ updateAvailable: boolean; retired: number }>(response)).toMatchObject({
      updateAvailable: false,
      notified: false,
      retired: 1,
    })

    const remaining = await pool.query<{ unread: string }>(
      "select count(*)::text as unread from notifications where user_id = $1 and kind = 'app_update_available' and read_at is null",
      [userId],
    )
    expect(remaining.rows[0]?.unread).toBe("0")
  })

  test("reporting twice does not duplicate rows", async () => {
    const { userId, token } = await seedUserWithSession("appver-idempotent@example.com", "+14155550304")
    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/client/app-version",
        headers: bearer(token),
        payload: validBody,
      })
      expect(response.statusCode).toBe(200)
    }
    const rows = await pool.query<{ total: string }>(
      "select count(*)::text as total from notifications where user_id = $1 and kind = 'app_update_available'",
      [userId],
    )
    expect(rows.rows[0]?.total).toBe("0")
  })
})
