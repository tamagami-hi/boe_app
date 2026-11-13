import { randomBytes } from "node:crypto"

import type { FastifyInstance, LightMyRequestResponse } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import type { AccessTokenService } from "../../src/auth/accessToken.js"
import { computeFilterHash, encodeCursor } from "../../src/http/cursor.js"
import { createClientAccountRepository } from "../../src/repositories/clientAccountRepository.js"
import { createClientValueEntryRepository } from "../../src/repositories/clientValueEntryRepository.js"
import { createFundReceiptAcknowledgementRepository } from "../../src/repositories/fundReceiptAcknowledgementRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createInvestmentSettlementRepository } from "../../src/repositories/investmentSettlementRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createPaymentsRepository } from "../../src/repositories/paymentsRepository.js"
import { createRefundRepository } from "../../src/repositories/refundRepository.js"
import { registerAdminFundReceiptRoutes } from "../../src/routes/adminFundReceiptRoutes.js"
import { registerClientAccountRoutes } from "../../src/routes/clientAccountRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface Client {
  readonly userId: string
  readonly token: string
}

interface Receipt {
  readonly acknowledgementId: string
  readonly paymentId: string
}

const MAX_WALKED_PAGES = 50
const FUND_RECEIPTS = "/v1/admin/fund-receipts"
const NOTIFICATIONS = "/v1/client/notifications"
const cursorKey = randomBytes(32)

let stack: PasswordMailStack
let app: FastifyInstance
let tokens: AccessTokenService
let finance: AdminSession
let fundId: string
let versionId: string

const itemsOf = (response: LightMyRequestResponse): readonly Readonly<Record<string, unknown>>[] =>
  response.json<{ data: { items: readonly Readonly<Record<string, unknown>>[] } }>().data.items
const nextCursorOf = (response: LightMyRequestResponse): string | null =>
  response.json<{ meta: { page?: { nextCursor: string | null } } }>().meta.page?.nextCursor ?? null
const codeOf = (response: LightMyRequestResponse): string => response.json<{ error: { code: string } }>().error.code

const receiptIdOf = (item: Readonly<Record<string, unknown>>): string =>
  String((item.acknowledgement as { id: string }).id)
const plainIdOf = (item: Readonly<Record<string, unknown>>): string => String(item.id)

const adminGet = (url: string) => app.inject({ method: "GET", url, headers: adminHeaders(finance) })
const clientGet = (client: Client, url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${client.token}` } })

const pageUrl = (url: string, after: string | null): string =>
  `${url}${url.includes("?") ? "&" : "?"}limit=1${after === null ? "" : `&after=${encodeURIComponent(after)}`}`

const walk = async (
  get: (url: string) => Promise<LightMyRequestResponse>,
  url: string,
  idOf: (item: Readonly<Record<string, unknown>>) => string,
): Promise<string[]> => {
  const seen: string[] = []
  let after: string | null = null
  do {
    const page = await get(pageUrl(url, after))
    expect(page.statusCode).toBe(200)
    seen.push(...itemsOf(page).map(idOf))
    after = nextCursorOf(page)
  } while (after !== null && seen.length < MAX_WALKED_PAGES)
  return seen
}

const legacyCursor = (route: string, filters: Readonly<Record<string, unknown>>, sortValues: readonly string[]) =>
  encodeCursor(cursorKey, { route, filterHash: computeFilterHash(filters), sortValues, now: stack.clock() })

const seedClient = async (): Promise<Client> => {
  const user = await stack.seedUser()
  const session = await stack.pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [user.id],
  )
  return { userId: user.id, token: await tokens.sign({ sub: user.id, sid: session.rows[0]?.id ?? "" }) }
}

const seedFund = async (actorId: string): Promise<void> => {
  const fund = await stack.pool.query<{ id: string }>(
    "insert into funds (slug, state, published_at, created_by_user_id) values ('keyset-fund', 'published', now(), $1) returning id",
    [actorId],
  )
  fundId = fund.rows[0]?.id ?? ""
  const disclosure = await stack.pool.query<{ id: string }>(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
    [fundId, randomBytes(32), actorId],
  )
  const version = await stack.pool.query<{ id: string }>(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, " +
      "minimum_sip_paise, minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id) " +
      "values ($1, 1, 'Keyset Fund', 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $2, $3, $4) returning id",
    [fundId, disclosure.rows[0]?.id, randomBytes(32), actorId],
  )
  versionId = version.rows[0]?.id ?? ""
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [versionId, fundId])
}

const seedReceipt = async (userId: string, createdAt: string): Promise<Receipt> => {
  const order = await stack.pool.query<{ id: string }>(
    "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, created_at, updated_at) " +
      "values ($1, $2, $3, 'lump_sum', 'submitted', 500000, $4::timestamptz, $4::timestamptz) returning id",
    [userId, fundId, versionId, createdAt],
  )
  const orderId = order.rows[0]?.id ?? ""
  const payment = await stack.pool.query<{ id: string }>(
    "insert into payments (order_id, user_id, amount_paise, state, succeeded_at, created_at, updated_at) " +
      "values ($1, $2, 500000, 'succeeded', $3::timestamptz, $3::timestamptz, $3::timestamptz) returning id",
    [orderId, userId, createdAt],
  )
  const acknowledgement = await stack.pool.query<{ id: string }>(
    "insert into fund_receipt_acknowledgements (order_id, created_at, updated_at) values ($1, $2::timestamptz, $2::timestamptz) returning id",
    [orderId, createdAt],
  )
  return { acknowledgementId: acknowledgement.rows[0]?.id ?? "", paymentId: payment.rows[0]?.id ?? "" }
}

const seedNotification = async (userId: string, createdAt: string): Promise<string> => {
  const inserted = await stack.pool.query<{ id: string }>(
    "insert into notifications (user_id, kind, title, body, created_at, updated_at) " +
      "values ($1, 'keyset_check', 'Keyset check', 'Created within one millisecond.', $2::timestamptz, $2::timestamptz) returning id",
    [userId, createdAt],
  )
  return inserted.rows[0]?.id ?? ""
}

const byId = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  tokens = webAuth.accessTokenService
  const notificationRepository = createNotificationRepository()
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminFundReceiptRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: { cursorKey, idempotencyTtlMs: 86_400_000 },
        acknowledgementRepository: createFundReceiptAcknowledgementRepository(),
        paymentsRepository: createPaymentsRepository(),
        settlementRepository: createInvestmentSettlementRepository(),
        refundRepository: createRefundRepository(),
        paymentGateway: null,
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository,
      })
      registerClientAccountRoutes(instance, {
        accessTokenService: tokens,
        database: stack.database,
        clientWeb: { originAllowlist: [] },
        clientAccountRepository: createClientAccountRepository(),
        clientValueEntryRepository: createClientValueEntryRepository(),
        auditRepository: stack.auditRepository,
        notificationRepository,
        unitOfWork: stack.unitOfWork,
        clock: stack.clock,
        config: { cursorKey },
      })
    },
  })
  finance = await signInRoleAdmin(app, stack, "finance")
  await seedFund(finance.userId)
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("keyset paging across rows created microseconds apart", () => {
  test("the fund receipt queue and the admin payments list neither repeat nor skip the boundary row", async () => {
    const client = await stack.seedUser()
    const earlier = await seedReceipt(client.id, "2019-01-01T00:00:00.000100Z")
    const later = await seedReceipt(client.id, "2019-01-01T00:00:00.000103Z")

    const queue = await walk(adminGet, `${FUND_RECEIPTS}?state=pending`, receiptIdOf)
    expect(new Set(queue).size).toBe(queue.length)
    expect(queue.indexOf(earlier.acknowledgementId)).toBeGreaterThanOrEqual(0)
    expect(queue.indexOf(later.acknowledgementId)).toBe(queue.indexOf(earlier.acknowledgementId) + 1)

    const payments = await walk(adminGet, "/v1/admin/payments", plainIdOf)
    expect(new Set(payments).size).toBe(payments.length)
    expect(payments.indexOf(later.paymentId)).toBeGreaterThanOrEqual(0)
    expect(payments.indexOf(earlier.paymentId)).toBe(payments.indexOf(later.paymentId) + 1)
  })

  test("client notifications page newest first without skipping one created microseconds earlier", async () => {
    const client = await seedClient()
    const earlier = await seedNotification(client.userId, "2019-01-01T00:00:00.000100Z")
    const later = await seedNotification(client.userId, "2019-01-01T00:00:00.000103Z")

    expect(await walk((url) => clientGet(client, url), NOTIFICATIONS, plainIdOf)).toEqual([later, earlier])
  })

  test("a millisecond cursor minted before this change still continues after its row", async () => {
    const owner = await stack.seedUser()
    const siblings = [
      await seedReceipt(owner.id, "2019-02-01T00:00:00.000500Z"),
      await seedReceipt(owner.id, "2019-02-01T00:00:00.000500Z"),
    ].sort((left, right) => byId(left.acknowledgementId, right.acknowledgementId))
    const [first, second] = siblings
    const ascending = legacyCursor(FUND_RECEIPTS, { state: "pending" }, [
      "2019-02-01T00:00:00.000Z",
      first?.acknowledgementId ?? "",
    ])
    const nextReceipt = await adminGet(pageUrl(`${FUND_RECEIPTS}?state=pending`, ascending))
    expect(nextReceipt.statusCode).toBe(200)
    expect(itemsOf(nextReceipt).map(receiptIdOf)).toEqual([second?.acknowledgementId])

    const client = await seedClient()
    const notices = [
      await seedNotification(client.userId, "2019-02-01T00:00:00.000500Z"),
      await seedNotification(client.userId, "2019-02-01T00:00:00.000500Z"),
    ].sort(byId)
    const descending = legacyCursor(NOTIFICATIONS, { userId: client.userId }, [
      "2019-02-01T00:00:00.000Z",
      notices[1] ?? "",
    ])
    const nextNotice = await clientGet(client, pageUrl(NOTIFICATIONS, descending))
    expect(nextNotice.statusCode).toBe(200)
    expect(itemsOf(nextNotice).map(plainIdOf)).toEqual([notices[0]])

    const unreadable = legacyCursor(NOTIFICATIONS, { userId: client.userId }, ["2019-02-01T00:00:00Z", notices[1] ?? ""])
    const refused = await clientGet(client, pageUrl(NOTIFICATIONS, unreadable))
    expect(refused.statusCode).toBe(400)
    expect(codeOf(refused)).toBe("CURSOR_INVALID")
  })
})
