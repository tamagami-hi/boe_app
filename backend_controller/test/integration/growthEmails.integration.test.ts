import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import type { IdempotencyRepository } from "../../src/db/repositories.js"
import { createInvestmentGrowthGuard } from "../../src/domain/email/investmentGrowthGuard.js"
import { createClientGrowthMailRepository } from "../../src/repositories/clientGrowthMailRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { composeEmailDispatchWorker } from "../../src/runtime/workerComposition.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { GROWTH_CONFIG, growthMailDeps } from "./growthMailSupport.js"
import { CRYPTO_ENV, PasswordMailStack, type AccountState, type Row } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly idempotencyReplay?: boolean }
}

interface Committed {
  readonly batchId: string
}

type Change = Readonly<{ growthPaise: string }> | Readonly<{ growthBasisPoints: number }>
type CollectiveMode = Readonly<{ growthBasisPoints: number }> | Readonly<{ items: readonly { userId: string; growthPaise: string }[] }>

const EFFECTIVE_DATE = "2026-08-20"

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let receiptWriteFails = false

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const seedFund = async (name: string): Promise<{ fundId: string; versionId: string }> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`growth-mail-${randomUUID().slice(0, 8)}`, finance.userId],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), finance.userId],
  )
  const version = await stack.first(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, $2, 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $3, $4, $5) returning id",
    [fund.id, name, disclosure.id, randomBytes(32), finance.userId],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  return { fundId: String(fund.id), versionId: String(version.id) }
}

const seedClient = async (fullName: string, state: AccountState = "active"): Promise<{ id: string; email: string }> => {
  const client = await stack.seedUser({ state })
  await stack.pool.query("update users set full_name = $2 where id = $1", [client.id, fullName])
  return client
}

const seedPosition = async (userId: string, fund: { fundId: string; versionId: string }, amountPaise: number): Promise<void> => {
  const order = await stack.first(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, 'lump_sum', 'accepted', $4, now()) returning id",
    [userId, fund.fundId, fund.versionId, amountPaise],
  )
  const payment = await stack.first(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, $3, 'succeeded', now()) returning id",
    [order.id, userId, amountPaise],
  )
  const allocation = await stack.first(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, $4, $5, $6) returning id",
    [order.id, userId, fund.fundId, amountPaise, finance.userId, `req-${randomUUID()}`],
  )
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', $4, $4, current_date, $5, $6, 'investment_accepted', 'admin', $7, $8)",
    [userId, fund.fundId, allocation.id, amountPaise, order.id, payment.id, finance.userId, `req-${randomUUID()}`],
  )
}

const seedZeroValuePosition = async (userId: string, fund: { fundId: string; versionId: string }, amountPaise: number): Promise<void> => {
  await seedPosition(userId, fund, amountPaise)
  const batch = await stack.first(
    "insert into client_growth_batches (scope, instruction_type, effective_date, reason_code, basis_hash, " +
      "actor_user_id, request_id, target_count, total_delta_paise) " +
      "values ('individual', 'amount', current_date, 'seed_correction', 'seedhash', $1, $2, 1, $3) returning id",
    [finance.userId, `req-${randomUUID()}`, -amountPaise],
  )
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, growth_batch_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'growth_adjustment', 0, $3, current_date, $4, 'seed_correction', 'admin', $5, $6)",
    [userId, fund.fundId, -amountPaise, batch.id, finance.userId, `req-${randomUUID()}`],
  )
}

const individual = (userId: string, fundId: string, change: Change, key = `growth-one-${randomUUID()}`) =>
  app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/individual",
    headers: adminHeaders(finance, key),
    payload: { userId, fundId, ...change, effectiveDate: EFFECTIVE_DATE, reasonCode: "performance_update" },
  })

const collective = async (fundId: string, mode: CollectiveMode, key = `growth-many-${randomUUID()}`) => {
  const preview = await app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/collective/preview",
    headers: adminHeaders(finance),
    payload: { fundId, ...mode },
  })
  expect(preview.statusCode).toBe(200)
  const payload = {
    fundId,
    ...mode,
    basisHash: envelopeOf<{ basisHash: string }>(preview).data.basisHash,
    effectiveDate: EFFECTIVE_DATE,
    reasonCode: "monthly",
  }
  const commit = () =>
    app.inject({ method: "POST", url: "/v1/admin/client-growth/collective", headers: adminHeaders(finance, key), payload })
  return { first: await commit(), again: commit }
}

const growthEmailsOf = async (userId: string): Promise<Row[]> =>
  (
    await stack.pool.query<Row>(
      "select d.id, d.state, d.template_version, o.payload, o.state as outbox_state, o.deduplication_key, o.aggregate_id " +
        "from email_deliveries d join outbox_events o on o.id = d.outbox_event_id " +
        "where d.user_id = $1 and d.template_key = 'investment_growth' order by d.created_at",
      [userId],
    )
  ).rows

const sealedOf = async (deliveryId: unknown): Promise<Record<string, unknown>> => {
  const stored = await stack.payloadRow(String(deliveryId))
  const opened = stack.crypto.decryptDeliveryPayload(String(deliveryId), {
    ciphertext: stored.ciphertext as Buffer,
    nonce: stored.nonce as Buffer,
    keyVersion: String(stored.key_version),
  })
  if (opened.kind !== "opened") throw new Error("sealed payload not readable")
  return { ...opened.payload }
}

const ledgerOf = async (userId: string, fundId: string, batchId: string): Promise<{ delta: string; value: string }> => {
  const delta = await stack.first(
    "select value_delta_paise::text as v from client_value_entries where user_id = $1 and fund_id = $2 and growth_batch_id = $3",
    [userId, fundId, batchId],
  )
  const value = await stack.first(
    "select sum(value_delta_paise)::text as v from client_value_entries where user_id = $1 and fund_id = $2",
    [userId, fundId],
  )
  return { delta: String(delta.v), value: String(value.v) }
}

const expectOneEmail = async (
  client: { id: string },
  fund: { fundId: string },
  batchId: string,
  expected: Readonly<{ fullName: string; fundName: string; deltaPaise: string; valueAfterPaise: string }>,
): Promise<void> => {
  const emails = await growthEmailsOf(client.id)
  expect(emails, client.id).toHaveLength(1)
  const revision = await stack.first("select email_revision::text as r from users where id = $1", [client.id])
  expect(emails[0]?.payload).toEqual({
    template: "investment_growth",
    batchId,
    fundId: fund.fundId,
    effectiveDate: EFFECTIVE_DATE,
    boundEmailRevision: revision.r,
  })
  expect(emails[0]?.deduplication_key).toBe(`investment_growth:${batchId}:${client.id}`)
  expect(emails[0]?.template_version).toBe("v1")
  expect(await sealedOf(emails[0]?.id)).toEqual(expected)
  const ledger = await ledgerOf(client.id, fund.fundId, batchId)
  expect({ deltaPaise: expected.deltaPaise, valueAfterPaise: expected.valueAfterPaise }).toEqual({
    deltaPaise: ledger.delta,
    valueAfterPaise: ledger.value,
  })
  const plain = await stack.first(
    "select o.payload::text || d::text as text from email_deliveries d join outbox_events o on o.id = d.outbox_event_id where d.id = $1",
    [emails[0]?.id],
  )
  for (const secret of [expected.fullName, expected.fundName, expected.valueAfterPaise]) {
    expect(String(plain.text)).not.toContain(secret)
  }
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const receipts = createIdempotencyRepository()
  const failingReceipts: IdempotencyRepository = {
    ...receipts,
    insertCompleted: (tx, input) =>
      receiptWriteFails ? Promise.reject(new Error("receipt write failed")) : receipts.insertCompleted(tx, input),
  }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminClientGrowthRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: GROWTH_CONFIG,
        ...growthMailDeps(stack.crypto),
        clientGrowthRepository: createClientGrowthRepository(),
        auditRepository: stack.auditRepository,
        idempotencyRepository: failingReceipts,
        notificationRepository: createNotificationRepository(),
      })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("growth emails are queued in the growth write's own transaction", () => {
  test.each([
    ["an amount gain", { growthPaise: "25000" }, "25000", "1025000"],
    ["a rate loss", { growthBasisPoints: -150 }, "-15000", "985000"],
  ] as const)("one investor's %s queues one email with the ledger change and value, and a replay queues none", async (_label, change, deltaPaise, valueAfterPaise) => {
    const fund = await seedFund("Harbour Growth Fund")
    const client = await seedClient("Rahul Kumar")
    await seedPosition(client.id, fund, 1_000_000)
    const key = `growth-one-${randomUUID()}`

    const first = await individual(client.id, fund.fundId, change, key)
    const replay = await individual(client.id, fund.fundId, change, key)

    expect(first.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    const { batchId } = envelopeOf<Committed>(first).data
    await expectOneEmail(client, fund, batchId, { fullName: "Rahul Kumar", fundName: "Harbour Growth Fund", deltaPaise, valueAfterPaise })
  })

  test("a collective rate update emails each active client in the fund once, not a suspended or excluded one, and a replay queues none", async () => {
    const fund = await seedFund("Lighthouse Balanced Fund")
    const other = await seedFund("Other Fund")
    const first = await seedClient("Asha Rao")
    const second = await seedClient("Vikram Shah")
    const suspended = await seedClient("Meera Iyer", "suspended")
    const excluded = await seedClient("Kiran Das")
    const elsewhere = await seedClient("Neha Jain")
    await seedPosition(first.id, fund, 1_000_000)
    await seedPosition(second.id, fund, 500_000)
    await seedPosition(suspended.id, fund, 200_000)
    await seedZeroValuePosition(excluded.id, fund, 300_000)
    await seedPosition(elsewhere.id, other, 400_000)

    const run = await collective(fund.fundId, { growthBasisPoints: 200 })
    const replay = await run.again()

    expect(run.first.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    const { batchId } = envelopeOf<Committed>(run.first).data
    await expectOneEmail(first, fund, batchId, { fullName: "Asha Rao", fundName: "Lighthouse Balanced Fund", deltaPaise: "20000", valueAfterPaise: "1020000" })
    await expectOneEmail(second, fund, batchId, { fullName: "Vikram Shah", fundName: "Lighthouse Balanced Fund", deltaPaise: "10000", valueAfterPaise: "510000" })
    expect(await stack.count("client_value_entries", "user_id = $1 and growth_batch_id = $2", [suspended.id, batchId])).toBe(1)
    expect(await stack.count("notifications", "user_id = $1", [suspended.id])).toBe(1)
    for (const client of [suspended, excluded, elsewhere]) expect(await growthEmailsOf(client.id), client.id).toHaveLength(0)
    expect(await stack.count("outbox_events", "aggregate_id = $1", [batchId])).toBe(2)
  })

  test("a monthly value update emails each listed client its own change once, no unlisted client, and a replay queues none", async () => {
    const fund = await seedFund("Monthly Value Fund")
    const gaining = await seedClient("Arjun Menon")
    const losing = await seedClient("Divya Pillai")
    const unlisted = await seedClient("Sanjay Gupta")
    await seedPosition(gaining.id, fund, 1_000_000)
    await seedPosition(losing.id, fund, 800_000)
    await seedPosition(unlisted.id, fund, 300_000)
    const items = [
      { userId: gaining.id, growthPaise: "12345" },
      { userId: losing.id, growthPaise: "-800" },
    ]

    const run = await collective(fund.fundId, { items })
    const replay = await run.again()

    expect(run.first.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    const { batchId } = envelopeOf<Committed>(run.first).data
    await expectOneEmail(gaining, fund, batchId, { fullName: "Arjun Menon", fundName: "Monthly Value Fund", deltaPaise: "12345", valueAfterPaise: "1012345" })
    await expectOneEmail(losing, fund, batchId, { fullName: "Divya Pillai", fundName: "Monthly Value Fund", deltaPaise: "-800", valueAfterPaise: "799200" })
    expect(await growthEmailsOf(unlisted.id)).toHaveLength(0)
  })

  test.each(["one investor", "collective rate", "monthly value update"] as const)(
    "a %s write that rolls back after the ledger rows queues no email",
    async (operation) => {
      const fund = await seedFund("Rollback Fund")
      const client = await seedClient("Pooja Nair")
      await seedPosition(client.id, fund, 1_000_000)
      const batchesBefore = await stack.count("client_growth_batches")
      receiptWriteFails = true
      try {
        const response =
          operation === "one investor"
            ? await individual(client.id, fund.fundId, { growthPaise: "5000" })
            : (
                await collective(
                  fund.fundId,
                  operation === "collective rate" ? { growthBasisPoints: 100 } : { items: [{ userId: client.id, growthPaise: "5000" }] },
                )
              ).first
        expect(response.statusCode).toBe(500)
      } finally {
        receiptWriteFails = false
      }

      expect(await stack.count("client_growth_batches")).toBe(batchesBefore)
      expect(await stack.count("client_value_entries", "user_id = $1 and entry_type = 'growth_adjustment'", [client.id])).toBe(0)
      expect(await stack.count("notifications", "user_id = $1", [client.id])).toBe(0)
      expect(await growthEmailsOf(client.id)).toHaveLength(0)
      expect(await stack.count("email_deliveries", "user_id = $1", [client.id])).toBe(0)
    },
  )
})

describe("the email worker", () => {
  test("sends the email to an active client and skips it once the client is closed, suspended, erased, has a new address or the change is reversed", async () => {
    const fund = await seedFund("Harbour Growth Fund")
    const kept = await seedClient("Rahul Kumar")
    const closed = await seedClient("Closed Client")
    const suspended = await seedClient("Suspended Client")
    const erased = await seedClient("Erased Client")
    const moved = await seedClient("Moved Client")
    const reversed = await seedClient("Reversed Client")
    const skipped = [closed, suspended, erased, moved, reversed]
    for (const client of [kept, ...skipped]) await seedPosition(client.id, fund, 1_000_000)
    const run = await collective(fund.fundId, { growthBasisPoints: 250 })
    expect(run.first.statusCode).toBe(201)
    const { batchId } = envelopeOf<Committed>(run.first).data
    await stack.setAccountState(closed.id, "closed")
    await stack.setAccountState(suspended.id, "suspended")
    await stack.pool.query("update users set pii_tombstoned_at = now() where id = $1", [erased.id])
    await stack.pool.query("update users set email_revision = email_revision + 1 where id = $1", [moved.id])
    await stack.pool.query(
      "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
        "reverses_entry_id, reason_code, actor_type, created_by_user_id, request_id) " +
        "select user_id, fund_id, 'reversal', 0, -value_delta_paise, effective_date, id, 'admin_correction_reversal', 'admin', $3, $4 " +
        "from client_value_entries where user_id = $1 and growth_batch_id = $2",
      [reversed.id, batchId, finance.userId, `req-${randomUUID()}`],
    )
    const transport = stack.transport()
    const guard = createInvestmentGrowthGuard({
      clientGrowthMailRepository: createClientGrowthMailRepository(),
      userRepository: stack.userRepository,
    })

    await stack.dispatch(transport, stack.clock, stack.crypto, [["investment_growth", guard]])

    const sent = transport.messages.filter((message) => message.to === kept.email)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toBe("Investment value updated")
    expect(sent[0]?.text).toContain("Hello Rahul Kumar,")
    expect(sent[0]?.text).toContain(
      "The value of your investment in Harbour Growth Fund was updated as of 20 August 2026. This update is a gain of ₹250.00.",
    )
    expect(sent[0]?.text).toContain("After this update, your value in this fund is ₹10,250.00.")
    expect(sent[0]?.text).toContain("Investments are subject to market risk.")
    expect((await growthEmailsOf(kept.id)).map((row) => row.state)).toEqual(["sent"])
    for (const client of skipped) {
      expect(transport.messages.some((message) => message.to === client.email), client.email).toBe(false)
      const rows = await growthEmailsOf(client.id)
      expect(rows.map((row) => [row.state, row.outbox_state]), client.email).toEqual([["cancelled", "cancelled"]])
    }
  })

  test("the deployed worker composition guards and renders the template rather than failing it as unknown", async () => {
    const fund = await seedFund("Composed Worker Fund")
    const active = await seedClient("Active Client")
    const closed = await seedClient("Closed Later")
    await seedPosition(active.id, fund, 1_000_000)
    await seedPosition(closed.id, fund, 1_000_000)
    const run = await collective(fund.fundId, { growthBasisPoints: 100 })
    expect(run.first.statusCode).toBe(201)
    await stack.setAccountState(closed.id, "closed")
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" })
    const worker = composeEmailDispatchWorker({
      ...CRYPTO_ENV,
      DATABASE_URL: stack.container.getConnectionUri(),
      ACCESS_TOKEN_ISSUER: "https://test.example",
      ACCESS_TOKEN_AUDIENCE: "boe-test",
      ACCESS_TOKEN_CURRENT_KID: "test-k1",
      ACCESS_TOKEN_SIGNING_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      ACCESS_TOKEN_VERIFICATION_KEYS: JSON.stringify({ "test-k1": pair.publicKey.export({ type: "spki", format: "pem" }) as string }),
      REFRESH_HMAC_KEY: randomBytes(32).toString("base64"),
      REFRESH_KEY_VERSION: "rt1",
      CSRF_KEY_VERSION: "cs1",
      CURSOR_HMAC_KEY: randomBytes(32).toString("base64"),
      WEB_COOKIE_SECURE: "false",
      WEB_ORIGIN_ALLOWLIST: "https://admin.beonedge.test",
      PASSWORD_BREACH_CHECK_MODE: "bypass",
      NODE_ENV: "test",
    })

    try {
      await worker.runOnce()
    } finally {
      await worker.dispose()
    }

    const activeRow = await stack.first(
      "select state, last_error_code from email_deliveries where user_id = $1 and template_key = 'investment_growth'",
      [active.id],
    )
    expect(activeRow).toEqual({ state: "retryable_failed", last_error_code: "EMAIL_TRANSPORT_NOT_CONFIGURED" })
    expect((await growthEmailsOf(closed.id)).map((row) => [row.state, row.outbox_state])).toEqual([["cancelled", "cancelled"]])
  })
})
