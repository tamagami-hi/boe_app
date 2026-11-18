import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { expect } from "vitest"

import { createAccessTokenService, type AccessTokenService } from "../../src/auth/accessToken.js"
import type { IdempotencyRepository } from "../../src/db/repositories.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createClientReceiptRepository } from "../../src/repositories/clientReceiptRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createInvestmentBreakdownRepository } from "../../src/repositories/investmentBreakdownRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createRecordingCategoryRepository } from "../../src/repositories/recordingCategoryRepository.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerAdminInvestmentCleanupRoutes } from "../../src/routes/adminInvestmentCleanupRoutes.js"
import { registerAdminRecordingCategoryRoutes } from "../../src/routes/adminRecordingCategoryRoutes.js"
import { registerAdminSipScheduleRoutes } from "../../src/routes/adminSipScheduleRoutes.js"
import { registerClientInvestmentBreakdownRoutes } from "../../src/routes/clientInvestmentBreakdownRoutes.js"
import { registerClientReceiptRoutes } from "../../src/routes/clientReceiptRoutes.js"
import { registerClientSipScheduleRoutes } from "../../src/routes/clientSipScheduleRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { CRYPTO_ENV, PasswordMailStack, type Row } from "./passwordMailSupport.js"

export interface Envelope<T> {
  readonly data: T
  readonly meta: { readonly idempotencyReplay?: boolean }
  readonly error: { readonly code: string; readonly message?: string; readonly fields?: Record<string, readonly string[]> }
}

export interface Recording {
  readonly entryId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly reversed: boolean
  readonly category: string | null
  readonly categoryLabel: string
  readonly sipScheduleId: string | null
  readonly sipMonth: string | null
  readonly sipLinkAllowed: boolean
  readonly oneTimeAllowed: boolean
}

export interface Schedule {
  readonly scheduleId: string
  readonly version: number
  readonly monthCount: number
  readonly monthsPaid: number
  readonly nextUnpaidMonth: string | null
  readonly paidMonths: readonly string[]
}

export interface ProposalMonth {
  readonly month: string
  readonly monthNumber: number
  readonly paid: boolean
  readonly linkedEntryId: string | null
  readonly proposedEntryId: string | null
}

export interface Proposal {
  readonly scheduleId: string
  readonly months: readonly ProposalMonth[]
  readonly candidates: readonly Recording[]
}

export type HistoryLink = Readonly<{ month: string; entryId: string }>

export const MONTHLY = "recorded_offline_monthly_investment"
export const EARLIER = "recorded_offline_investment"
export const CORRECTION = "recorded_offline_correction"

export const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

export interface HarnessFailures {
  receiptWrite: boolean
}

export class RecordingCategoryHarness {
  private constructor(
    readonly stack: PasswordMailStack,
    readonly app: FastifyInstance,
    readonly finance: AdminSession,
    readonly failures: HarnessFailures,
    private readonly tokens: AccessTokenService,
  ) {}

  static async start(): Promise<RecordingCategoryHarness> {
    const stack = await PasswordMailStack.start({ seed: true })
    const webAuth = await adminWebAuth(stack)
    const keyPair = await generateKeyPair("ES256", { extractable: true })
    const tokens = createAccessTokenService({
      issuer: "https://api.beonedge.test",
      audience: "boe-native",
      currentKid: "k1",
      signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
      verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
    })
    const failures: HarnessFailures = { receiptWrite: false }
    const receipts = createIdempotencyRepository()
    const idempotencyRepository: IdempotencyRepository = {
      ...receipts,
      insertCompleted: (tx, input) =>
        failures.receiptWrite ? Promise.reject(new Error("receipt write failed")) : receipts.insertCompleted(tx, input),
    }
    const sipScheduleRepository = createAdminSipScheduleRepository()
    const recordingCategoryRepository = createRecordingCategoryRepository()
    const shared = {
      webAuth,
      unitOfWork: stack.unitOfWork,
      database: stack.database,
      clock: stack.clock,
      userRepository: stack.userRepository,
      auditRepository: stack.auditRepository,
      idempotencyRepository,
      sipScheduleRepository,
      recordingCategoryRepository,
      clientGrowthRepository: createClientGrowthRepository(),
    }
    const app = createApplication({
      logger: false,
      registerRoutes: (instance) => {
        registerAdminLogin(instance, stack, webAuth)
        registerAdminClientPositionRoutes(instance, {
          ...shared,
          config: { idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
          outboxRepository: stack.outboxRepository,
          emailDeliveryRepository: stack.emailDeliveryRepository,
          crypto: stack.crypto,
          clientPositionRepository: createClientPositionRepository(),
          notificationRepository: createNotificationRepository(),
        })
        registerAdminRecordingCategoryRoutes(instance, { ...shared, config: { idempotencyTtlMs: 86_400_000 } })
        const investmentBreakdownRepository = createInvestmentBreakdownRepository()
        registerAdminInvestmentCleanupRoutes(instance, {
          ...shared,
          investmentBreakdownRepository,
          config: { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32) },
        })
        registerAdminSipScheduleRoutes(instance, { ...shared, config: { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32) } })
        const clientDeps = { accessTokenService: tokens, database: stack.database, clientWeb: { originAllowlist: [] }, clock: stack.clock }
        registerClientSipScheduleRoutes(instance, { ...clientDeps, sipScheduleRepository })
        registerClientInvestmentBreakdownRoutes(instance, { ...clientDeps, investmentBreakdownRepository })
        registerClientReceiptRoutes(instance, {
          ...clientDeps,
          clientReceiptRepository: createClientReceiptRepository(),
          config: { cursorKey: randomBytes(32) },
        })
      },
    })
    const finance = await signInRoleAdmin(app, stack, "finance")
    return new RecordingCategoryHarness(stack, app, finance, failures, tokens)
  }

  async stop(): Promise<void> {
    await this.app.close()
    await this.stack.stop()
  }

  async seedFund(name: string): Promise<string> {
    const fund = await this.stack.first(
      "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
      [`cat-${randomUUID().slice(0, 8)}`, this.finance.userId],
    )
    const disclosure = await this.stack.first(
      "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
        "values ($1, 1, 'Scheme disclosure', 'Full disclosure body.', $2, now(), $3) returning id",
      [fund.id, randomBytes(32), this.finance.userId],
    )
    const version = await this.stack.first(
      "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
        "minimum_purchase_paise, minimum_duration_months, disclosure_version_id, terms_sha256, created_by_user_id, created_at) " +
        "values ($1, 1, $2, 'hybrid', 'Balanced growth.', 'moderate', 'moderate', 50000, 500000, 6, $3, $4, $5, '2020-01-01') returning id",
      [fund.id, name, disclosure.id, randomBytes(32), this.finance.userId],
    )
    await this.stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
    return String(fund.id)
  }

  record(userId: string, body: Readonly<Record<string, unknown>>, key = `record-${randomUUID()}`) {
    return this.app.inject({
      method: "POST",
      url: `/v1/admin/clients/${userId}/recorded-contributions`,
      headers: adminHeaders(this.finance, key),
      payload: { amountPaise: "500000", ...body },
    })
  }

  async recordOk(userId: string, body: Readonly<Record<string, unknown>>): Promise<string> {
    const response = await this.record(userId, body)
    expect(response.statusCode).toBe(201)
    return envelopeOf<{ entryId: string }>(response).data.entryId
  }

  async scheduleFor(userId: string, fundId: string, startMonth: string, monthCount: number): Promise<Schedule> {
    const response = await this.app.inject({
      method: "POST",
      url: `/v1/admin/clients/${userId}/sip-schedules`,
      headers: adminHeaders(this.finance, `schedule-${randomUUID()}`),
      payload: { fundId, monthlyAmountPaise: "500000", startMonth, monthCount },
    })
    expect(response.statusCode).toBe(201)
    return envelopeOf<{ schedule: Schedule }>(response).data.schedule
  }

  async proposal(userId: string, scheduleId: string): Promise<Proposal> {
    const response = await this.app.inject({
      method: "GET",
      url: `/v1/admin/clients/${userId}/sip-schedules/${scheduleId}/link-proposal`,
      headers: adminHeaders(this.finance),
    })
    expect(response.statusCode).toBe(200)
    return envelopeOf<Proposal>(response).data
  }

  linkMonths(userId: string, scheduleId: string, links: readonly HistoryLink[], key = `links-${randomUUID()}`) {
    return this.app.inject({
      method: "POST",
      url: `/v1/admin/clients/${userId}/sip-schedules/${scheduleId}/month-links`,
      headers: adminHeaders(this.finance, key),
      payload: { links },
    })
  }

  markOneTime(userId: string, entryId: string, key = `one-time-${randomUUID()}`) {
    return this.app.inject({
      method: "POST",
      url: `/v1/admin/clients/${userId}/recorded-contributions/${entryId}/category`,
      headers: adminHeaders(this.finance, key),
      payload: { category: "one_time" },
    })
  }

  async recordings(userId: string, fundId?: string): Promise<readonly Recording[]> {
    const response = await this.app.inject({
      method: "GET",
      url: `/v1/admin/clients/${userId}/recorded-contributions${fundId === undefined ? "" : `?fundId=${fundId}`}`,
      headers: adminHeaders(this.finance),
    })
    expect(response.statusCode).toBe(200)
    return envelopeOf<{ items: Recording[] }>(response).data.items
  }

  async clientGet<T>(userId: string, url: string): Promise<T> {
    const session = await this.stack.first(
      "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
      [userId],
    )
    const token = await this.tokens.sign({ sub: userId, sid: String(session.id) })
    const response = await this.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(200)
    return envelopeOf<T>(response).data
  }

  async mailOf(userId: string, templateKey: string): Promise<Row[]> {
    return (
      await this.stack.pool.query<Row>(
        "select d.id, d.state, d.last_error_code, o.payload, o.state as outbox_state, d.xmin::text as tx from email_deliveries d " +
          "join outbox_events o on o.id = d.outbox_event_id where d.user_id = $1 and d.template_key = $2 order by d.created_at",
        [userId, templateKey],
      )
    ).rows
  }

  async sealedOf(deliveryId: string): Promise<Record<string, unknown>> {
    const stored = await this.stack.payloadRow(deliveryId)
    const opened = this.stack.crypto.decryptDeliveryPayload(deliveryId, {
      ciphertext: stored.ciphertext as Buffer,
      nonce: stored.nonce as Buffer,
      keyVersion: String(stored.key_version),
    })
    if (opened.kind !== "opened") throw new Error("sealed payload not readable")
    return { ...opened.payload }
  }

  workerEnv(): Record<string, string> {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" })
    return {
      ...CRYPTO_ENV,
      DATABASE_URL: this.stack.container.getConnectionUri(),
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
    }
  }
}
