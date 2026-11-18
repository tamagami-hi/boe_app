import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import { createInvestmentRecordedGuard } from "../../src/domain/email/investmentRecordedGuard.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createRecordingCategoryRepository } from "../../src/repositories/recordingCategoryRepository.js"
import { createClientReceiptRepository } from "../../src/repositories/clientReceiptRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerClientReceiptRoutes } from "../../src/routes/clientReceiptRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack, type Row } from "./passwordMailSupport.js"

interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly idempotencyReplay?: boolean; readonly page?: { nextCursor: string | null; hasMore: boolean } }
  readonly error: { readonly code: string; readonly fields?: Record<string, readonly string[]> }
}

interface Recorded {
  readonly entryId: string
  readonly orderId: string
  readonly principalPaise: string
  readonly currentValuePaise: string
}

interface Receipt {
  readonly entryId: string
  readonly orderId: string
  readonly fundId: string
  readonly fundName: string
  readonly category: string
  readonly categoryLabel: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly recordedAt: string
  readonly reversedAt: string | null
  readonly sipMonth: string | null
}

const FUND_NAME = "Receipts Balanced Fund"
const EFFECTIVE_DATE = "2025-06-02"
const WRITE_TABLES = [
  "investment_orders",
  "payments",
  "investment_allocations",
  "client_value_entries",
  "notifications",
  "audit_events",
  "idempotency_records",
] as const

let stack: PasswordMailStack
let app: FastifyInstance
let finance: AdminSession
let accessTokenService: AccessTokenService
let fundId: string

const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

const writeCounts = async (): Promise<number[]> => Promise.all(WRITE_TABLES.map((table) => stack.count(table)))

interface FundVersionSeed {
  readonly name: string
  readonly createdAt: string | null
}

const seedFund = async (
  actorId: string,
  versions: readonly FundVersionSeed[] = [{ name: FUND_NAME, createdAt: null }],
): Promise<{ fundId: string; versionIds: string[] }> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`receipts-${randomUUID().slice(0, 8)}`, actorId],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), actorId],
  )
  const versionIds: string[] = []
  for (const [index, seed] of versions.entries()) {
    const version = await stack.first(
      "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
        "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id, created_at) " +
        "values ($1, $2, $3, 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $4, $5, $6, coalesce($7::timestamptz, now())) returning id",
      [fund.id, index + 1, seed.name, disclosure.id, randomBytes(32), actorId, seed.createdAt],
    )
    versionIds.push(String(version.id))
  }
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [versionIds.at(-1), fund.id])
  return { fundId: String(fund.id), versionIds }
}

const clientToken = async (userId: string): Promise<string> => {
  const session = await stack.first(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [userId],
  )
  return accessTokenService.sign({ sub: userId, sid: String(session.id) })
}

const record = (userId: string, reasonCode: string, amountPaise: string, key = `record-${randomUUID()}`) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/recorded-contributions`,
    headers: adminHeaders(finance, key),
    payload: { fundId, amountPaise, effectiveDate: EFFECTIVE_DATE, reasonCode },
  })

const recordOk = async (userId: string, reasonCode: string, amountPaise: string): Promise<Recorded> => {
  const response = await record(userId, reasonCode, amountPaise)
  expect(response.statusCode).toBe(201)
  return envelopeOf<Recorded>(response).data
}

const listReceipts = (token: string, query = "") =>
  app.inject({ method: "GET", url: `/v1/client/receipts${query}`, headers: { authorization: `Bearer ${token}` } })

const getReceipt = (token: string, entryId: string) =>
  app.inject({ method: "GET", url: `/v1/client/receipts/${entryId}`, headers: { authorization: `Bearer ${token}` } })

const positionTotals = async (userId: string): Promise<Row> =>
  stack.first(
    "select coalesce(sum(principal_delta_paise), 0)::text as principal, coalesce(sum(value_delta_paise), 0)::text as value " +
      "from client_value_entries where user_id = $1 and fund_id = $2",
    [userId, fundId],
  )

const investmentEmailsOf = async (userId: string): Promise<Row[]> =>
  (
    await stack.pool.query<Row>(
      "select d.id, d.state, o.payload, o.state as outbox_state from email_deliveries d " +
        "join outbox_events o on o.id = d.outbox_event_id " +
        "where d.user_id = $1 and d.template_key = 'investment_recorded' order by d.created_at",
      [userId],
    )
  ).rows

const sealedOf = async (deliveryId: string): Promise<Record<string, unknown>> => {
  const stored = await stack.payloadRow(deliveryId)
  const opened = stack.crypto.decryptDeliveryPayload(deliveryId, {
    ciphertext: stored.ciphertext as Buffer,
    nonce: stored.nonce as Buffer,
    keyVersion: String(stored.key_version),
  })
  if (opened.kind !== "opened") throw new Error("sealed payload not readable")
  return { ...opened.payload }
}

const dispatchInvestmentMail = () => {
  const transport = stack.transport()
  const guard = createInvestmentRecordedGuard({
    clientReceiptRepository: createClientReceiptRepository(),
    userRepository: stack.userRepository,
  })
  return { transport, run: () => stack.dispatch(transport, stack.clock, stack.crypto, [["investment_recorded", guard]]) }
}

const seedGrowth = async (userId: string, deltaPaise: number): Promise<void> => {
  const batch = await stack.first(
    "insert into client_growth_batches (scope, instruction_type, effective_date, reason_code, basis_hash, " +
      "actor_user_id, request_id, target_count, total_delta_paise) " +
      "values ('individual', 'amount', $1, 'monthly_growth', 'seedhash', $2, $3, 1, $4) returning id",
    [EFFECTIVE_DATE, finance.userId, `req-${randomUUID()}`, deltaPaise],
  )
  await stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, growth_batch_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'growth_adjustment', 0, $3, $4, $5, 'monthly_growth', 'admin', $6, $7)",
    [userId, fundId, deltaPaise, EFFECTIVE_DATE, batch.id, finance.userId, `req-${randomUUID()}`],
  )
}

const seedContribution = async (userId: string, orderType: "recorded_offline" | "lump_sum", reasonCode: string): Promise<string> => {
  const version = await stack.first("select current_published_version_id as id from funds where id = $1", [fundId])
  const order = await stack.first(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, accepted_at) " +
      "values ($1, $2, $3, $4::order_type, 'accepted', 700000, now()) returning id",
    [userId, fundId, version.id, orderType],
  )
  const payment = await stack.first(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at) values ($1, $2, 700000, 'succeeded', now()) returning id",
    [order.id, userId],
  )
  const allocation = await stack.first(
    "insert into investment_allocations (order_id, user_id, fund_id, amount_paise, allocated_by_user_id, request_id) " +
      "values ($1, $2, $3, 700000, $4, $5) returning id",
    [order.id, userId, fundId, finance.userId, `req-${randomUUID()}`],
  )
  const entry = await stack.first(
    "insert into client_value_entries (user_id, fund_id, allocation_id, entry_type, principal_delta_paise, value_delta_paise, " +
      "effective_date, order_id, payment_id, reason_code, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, $3, 'contribution', 700000, 700000, $4, $5, $6, $7, 'admin', $8, $9) returning id",
    [userId, fundId, allocation.id, EFFECTIVE_DATE, order.id, payment.id, reasonCode, finance.userId, `req-${randomUUID()}`],
  )
  return String(entry.id)
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  accessTokenService = createAccessTokenService({
    issuer: "https://api.beonedge.test",
    audience: "boe-native",
    currentKid: "k1",
    signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
    verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
  })
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminClientPositionRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: { idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        crypto: stack.crypto,
        clientPositionRepository: createClientPositionRepository(),
        recordingCategoryRepository: createRecordingCategoryRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        userRepository: stack.userRepository,
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository: createNotificationRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
      })
      registerClientReceiptRoutes(instance, {
        accessTokenService,
        database: stack.database,
        clientWeb: { originAllowlist: [] },
        clientReceiptRepository: createClientReceiptRepository(),
        clock: stack.clock,
        config: { cursorKey: randomBytes(32) },
      })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  fundId = (await seedFund(finance.userId)).fundId
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("admin recording categories", () => {
  test.each(["recorded_offline_bonus", "earlier_investment", "growth_adjustment", "Recorded_Offline_Investment", "constructor"])(
    "refuses the reason code %s before any write",
    async (reasonCode) => {
      const client = await stack.seedUser()
      const before = await writeCounts()

      const response = await record(client.id, reasonCode, "500000")

      expect(response.statusCode).toBe(400)
      expect(envelopeOf(response).error.code).toBe("VALIDATION_FAILED")
      expect(envelopeOf(response).error.fields?.reasonCode).toBeDefined()
      expect(await writeCounts()).toEqual(before)
    },
  )

  test("a monthly investment raises invested and current value by exactly the recorded paise", async () => {
    const client = await stack.seedUser()
    await recordOk(client.id, "recorded_offline_investment", "5000000")
    await seedGrowth(client.id, 375_025)
    expect(await positionTotals(client.id)).toEqual({ principal: "5000000", value: "5375025" })

    const monthly = await recordOk(client.id, "recorded_offline_monthly_investment", "1234567")

    expect(monthly.principalPaise).toBe("6234567")
    expect(monthly.currentValuePaise).toBe("6609592")
    expect(await positionTotals(client.id)).toEqual({ principal: "6234567", value: "6609592" })
    expect(
      await stack.first(
        "select entry_type, principal_delta_paise::text as principal, value_delta_paise::text as value, reason_code " +
          "from client_value_entries where id = $1",
        [monthly.entryId],
      ),
    ).toEqual({
      entry_type: "contribution",
      principal: "1234567",
      value: "1234567",
      reason_code: "recorded_offline_monthly_investment",
    })

    expect(
      await stack.first("select title, body from notifications where payload->>'entryId' = $1", [monthly.entryId]),
    ).toEqual({
      title: "Investment added",
      body: `Your monthly investment in ${FUND_NAME} is now in your portfolio. Contact support if you do not recognise it.`,
    })

    const token = await clientToken(client.id)
    const response = await getReceipt(token, monthly.entryId)
    expect(response.statusCode).toBe(200)
    expect(envelopeOf<{ receipt: Receipt }>(response).data.receipt).toMatchObject({
      entryId: monthly.entryId,
      orderId: monthly.orderId,
      fundId,
      fundName: FUND_NAME,
      category: "monthly_investment",
      categoryLabel: "Monthly investment",
      amountPaise: "1234567",
      effectiveDate: EFFECTIVE_DATE,
      reversedAt: null,
      sipMonth: null,
    })
  })

  test("writes the category notification with entryId, orderId and category in the recording's own transaction", async () => {
    const client = await stack.seedUser()

    const recorded = await recordOk(client.id, "recorded_offline_correction", "250050")

    const notifications = (
      await stack.pool.query<Row>(
        "select title, body, payload, xmin::text as tx from notifications where user_id = $1 and kind = 'client_contribution_recorded'",
        [client.id],
      )
    ).rows
    expect(notifications).toHaveLength(1)
    expect(notifications[0]?.payload).toEqual({
      fundId,
      deepLink: "/portfolio",
      entryId: recorded.entryId,
      orderId: recorded.orderId,
      category: "correction",
    })
    expect(notifications[0]?.title).toBe("Investment record corrected")
    expect(notifications[0]?.body).toContain(FUND_NAME)
    const entry = await stack.first("select xmin::text as tx from client_value_entries where id = $1", [recorded.entryId])
    const order = await stack.first("select xmin::text as tx from investment_orders where id = $1", [recorded.orderId])
    expect(notifications[0]?.tx).toBe(entry.tx)
    expect(order.tx).toBe(entry.tx)
  })

  test("replays a recording under the same Idempotency-Key and writes it once, even when sent concurrently", async () => {
    const client = await stack.seedUser()
    const key = `monthly-${randomUUID()}`
    const before = await writeCounts()

    const concurrent = await Promise.all([
      record(client.id, "recorded_offline_monthly_investment", "300000", key),
      record(client.id, "recorded_offline_monthly_investment", "300000", key),
    ])
    const retry = await record(client.id, "recorded_offline_monthly_investment", "300000", key)

    for (const response of concurrent) {
      expect([201, 409]).toContain(response.statusCode)
      if (response.statusCode === 409) expect(envelopeOf(response).error.code).toBe("IDEMPOTENCY_IN_PROGRESS")
    }
    expect(retry.statusCode).toBe(201)
    expect(envelopeOf(retry).meta.idempotencyReplay).toBe(true)
    const created = concurrent.find((response) => response.statusCode === 201)
    expect(created).toBeDefined()
    expect(envelopeOf<Recorded>(retry).data.entryId).toBe(envelopeOf<Recorded>(created!).data.entryId)

    const after = await writeCounts()
    expect(after.map((count, index) => count - (before[index] ?? 0))).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(await positionTotals(client.id)).toEqual({ principal: "300000", value: "300000" })

    const conflicting = await record(client.id, "recorded_offline_correction", "300000", key)
    expect(conflicting.statusCode).toBe(409)
    expect(envelopeOf(conflicting).error.code).toBe("IDEMPOTENCY_KEY_REUSED")
    expect(await writeCounts()).toEqual(after)
  })
})

describe("client receipts", () => {
  test("a client reads only their own recordings, and cursors stay bound to that client", async () => {
    const owner = await stack.seedUser()
    const other = await stack.seedUser()
    const ownerReceipt = await recordOk(owner.id, "recorded_offline_investment", "900000")
    const otherCorrection = await recordOk(other.id, "recorded_offline_correction", "120000")
    const legacyEntryId = await seedContribution(other.id, "recorded_offline", "pre-category free text")
    const gatewayEntryId = await seedContribution(other.id, "lump_sum", "verified_payment_received")
    const ownerToken = await clientToken(owner.id)
    const otherToken = await clientToken(other.id)

    const crossRead = await getReceipt(otherToken, ownerReceipt.entryId)
    expect(crossRead.statusCode).toBe(404)
    expect(envelopeOf(crossRead).error.code).toBe("RESOURCE_NOT_FOUND")
    expect((await getReceipt(otherToken, gatewayEntryId)).statusCode).toBe(404)
    expect((await getReceipt(ownerToken, ownerReceipt.entryId)).statusCode).toBe(200)
    expect(
      (await app.inject({ method: "GET", url: `/v1/client/receipts/${ownerReceipt.entryId}` })).statusCode,
    ).toBe(401)

    const firstPage = await listReceipts(otherToken, "?limit=1")
    expect(firstPage.statusCode).toBe(200)
    const firstEnvelope = envelopeOf<{ items: Receipt[] }>(firstPage)
    expect(firstEnvelope.meta.page?.hasMore).toBe(true)
    const cursor = firstEnvelope.meta.page?.nextCursor ?? ""
    const secondPage = envelopeOf<{ items: Receipt[] }>(
      await listReceipts(otherToken, `?limit=1&after=${encodeURIComponent(cursor)}`),
    )
    const otherItems = [...firstEnvelope.data.items, ...secondPage.data.items]
    expect(secondPage.meta.page?.hasMore).toBe(false)
    expect(otherItems.map((item) => item.entryId).sort()).toEqual([otherCorrection.entryId, legacyEntryId].sort())
    expect(otherItems.find((item) => item.entryId === legacyEntryId)).toMatchObject({
      category: "earlier_investment",
      categoryLabel: "Earlier investment",
      amountPaise: "700000",
    })

    const replayedCursor = await listReceipts(ownerToken, `?limit=1&after=${encodeURIComponent(cursor)}`)
    expect(replayedCursor.statusCode).toBe(400)
    expect(envelopeOf(replayedCursor).error.code).toBe("CURSOR_INVALID")

    const reversal = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${owner.id}/ledger-entries/${ownerReceipt.entryId}/reversal`,
      headers: adminHeaders(finance, `reverse-${randomUUID()}`),
      payload: { reasonCode: "admin_correction_reversal" },
    })
    expect(reversal.statusCode).toBe(201)
    const reversed = envelopeOf<{ receipt: Receipt }>(await getReceipt(ownerToken, ownerReceipt.entryId)).data.receipt
    expect(reversed.reversedAt).not.toBeNull()
    expect(reversed.amountPaise).toBe("900000")
  })

  test("a fund filter lists only that fund's recordings on every page, and its cursors stay bound to it", async () => {
    const client = await stack.seedUser()
    const otherFundId = (await seedFund(finance.userId, [{ name: "Receipts Second Fund", createdAt: null }])).fundId
    const recordIn = async (inFundId: string, amountPaise: string): Promise<Recorded> => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/clients/${client.id}/recorded-contributions`,
        headers: adminHeaders(finance, `fund-filter-${randomUUID()}`),
        payload: { fundId: inFundId, amountPaise, effectiveDate: EFFECTIVE_DATE, reasonCode: "recorded_offline_investment" },
      })
      expect(response.statusCode).toBe(201)
      return envelopeOf<Recorded>(response).data
    }
    const olderInFund = await recordIn(fundId, "300000")
    const inOtherFund = await recordIn(otherFundId, "400000")
    const newerInFund = await recordIn(fundId, "500000")
    const token = await clientToken(client.id)
    const page = async (query: string) => envelopeOf<{ items: Receipt[] }>(await listReceipts(token, query))

    const first = await page(`?fundId=${fundId}&limit=1`)
    const second = await page(`?fundId=${fundId}&limit=1&after=${encodeURIComponent(first.meta.page?.nextCursor ?? "")}`)
    expect([...first.data.items, ...second.data.items].map((item) => [item.entryId, item.fundId])).toEqual([
      [newerInFund.entryId, fundId],
      [olderInFund.entryId, fundId],
    ])
    expect(second.meta.page?.hasMore).toBe(false)
    expect((await page(`?fundId=${otherFundId}`)).data.items.map((item) => item.entryId)).toEqual([inOtherFund.entryId])
    expect((await page("")).data.items).toHaveLength(3)

    const unfiltered = await page("?limit=1")
    const crossed = await listReceipts(
      token,
      `?fundId=${fundId}&limit=1&after=${encodeURIComponent(unfiltered.meta.page?.nextCursor ?? "")}`,
    )
    expect(crossed.statusCode).toBe(400)
    expect(envelopeOf(crossed).error.code).toBe("CURSOR_INVALID")
  })
})

describe("investment added email", () => {
  test("a monthly investment queues one email with the amount, fund and name sealed, and a replay queues none", async () => {
    const client = await stack.seedUser()
    const key = `monthly-mail-${randomUUID()}`

    const first = await record(client.id, "recorded_offline_monthly_investment", "12345678", key)
    const replay = await record(client.id, "recorded_offline_monthly_investment", "12345678", key)

    expect(first.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    const recorded = envelopeOf<Recorded>(first).data
    const emails = await investmentEmailsOf(client.id)
    expect(emails).toHaveLength(1)
    const user = await stack.first("select email_revision::text as revision from users where id = $1", [client.id])
    expect(emails[0]?.payload).toEqual({
      template: "investment_recorded",
      entryId: recorded.entryId,
      category: "monthly_investment",
      effectiveDate: EFFECTIVE_DATE,
      boundEmailRevision: user.revision,
    })
    expect(await sealedOf(String(emails[0]?.id))).toEqual({
      fullName: "Ada Lovelace",
      fundName: FUND_NAME,
      amountPaise: "12345678",
    })
    const plain = await stack.first(
      "select o.payload::text || d::text as text from email_deliveries d join outbox_events o on o.id = d.outbox_event_id where d.id = $1",
      [emails[0]?.id],
    )
    for (const secret of ["12345678", FUND_NAME, "Ada Lovelace"]) expect(String(plain.text)).not.toContain(secret)
  })

  test("an earlier investment queues one email and a correction queues none", async () => {
    const earlier = await stack.seedUser()
    const corrected = await stack.seedUser()

    await recordOk(earlier.id, "recorded_offline_investment", "500000")
    await recordOk(corrected.id, "recorded_offline_correction", "500000")

    expect(await investmentEmailsOf(earlier.id)).toHaveLength(1)
    expect(await investmentEmailsOf(corrected.id)).toHaveLength(0)
  })

  test("sends the formatted amount without a web-app line, and cancels after a reversal, a closure or an email change", async () => {
    const kept = await stack.seedUser()
    const reversed = await stack.seedUser()
    const closed = await stack.seedUser()
    const moved = await stack.seedUser()
    await recordOk(kept.id, "recorded_offline_monthly_investment", "12345678")
    const toReverse = await recordOk(reversed.id, "recorded_offline_monthly_investment", "12345678")
    await recordOk(closed.id, "recorded_offline_investment", "12345678")
    await recordOk(moved.id, "recorded_offline_investment", "12345678")
    const reversal = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${reversed.id}/ledger-entries/${toReverse.entryId}/reversal`,
      headers: adminHeaders(finance, `reverse-${randomUUID()}`),
      payload: { reasonCode: "admin_correction_reversal" },
    })
    expect(reversal.statusCode).toBe(201)
    await stack.setAccountState(closed.id, "closed")
    await stack.pool.query("update users set email_revision = email_revision + 1 where id = $1", [moved.id])
    const mail = dispatchInvestmentMail()

    await mail.run()

    const sent = mail.transport.messages.filter((message) => message.to === kept.email)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toBe("Investment added")
    expect(sent[0]?.text).toContain(
      `Your monthly investment of ₹1,23,456.78 in ${FUND_NAME}, dated 2 June 2025, has been added to your BeOnEdge app.`,
    )
    expect(sent[0]?.text).toContain("Hello Ada Lovelace,")
    expect(sent[0]?.text).not.toContain("web app")
    for (const user of [reversed, closed, moved]) {
      expect(mail.transport.messages.some((message) => message.to === user.email), user.email).toBe(false)
      expect((await investmentEmailsOf(user.id)).map((row) => row.outbox_state)).toEqual(["cancelled"])
    }
  })
})

describe("fund name quoted for a recording", () => {
  test("quotes the fund version in force on the recording date, and the current version when none existed yet", async () => {
    const renamed = await seedFund(finance.userId, [
      { name: "Harbour Growth Fund", createdAt: "2025-01-01T00:00:00Z" },
      { name: "Summit Growth Fund", createdAt: null },
    ])
    const client = await stack.seedUser()
    const token = await clientToken(client.id)
    const recordOn = async (effectiveDate: string) => {
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/clients/${client.id}/recorded-contributions`,
        headers: adminHeaders(finance, `renamed-${randomUUID()}`),
        payload: { fundId: renamed.fundId, amountPaise: "250000", effectiveDate, reasonCode: "recorded_offline_monthly_investment" },
      })
      expect(response.statusCode).toBe(201)
      return envelopeOf<Recorded & { fundVersionId: string; fundVersionEffectiveOnDate: boolean }>(response).data
    }

    const dated = await recordOn("2025-06-02")
    const beforeAnyVersion = await recordOn("2024-12-01")

    expect([dated.fundVersionId, dated.fundVersionEffectiveOnDate]).toEqual([renamed.versionIds[0], true])
    expect([beforeAnyVersion.fundVersionId, beforeAnyVersion.fundVersionEffectiveOnDate]).toEqual([renamed.versionIds[1], false])
    const emails = await investmentEmailsOf(client.id)
    for (const [recorded, quoted] of [
      [dated, "Harbour Growth Fund"],
      [beforeAnyVersion, "Summit Growth Fund"],
    ] as const) {
      const notification = await stack.first("select body from notifications where payload->>'entryId' = $1", [recorded.entryId])
      expect(notification.body).toBe(
        `Your monthly investment in ${quoted} is now in your portfolio. Contact support if you do not recognise it.`,
      )
      const email = emails.find((row) => (row.payload as { entryId?: string }).entryId === recorded.entryId)
      expect((await sealedOf(String(email?.id))).fundName).toBe(quoted)
      const receipt = envelopeOf<{ receipt: Receipt }>(await getReceipt(token, recorded.entryId)).data.receipt
      expect(receipt.fundName).toBe(quoted)
    }
  })
})
