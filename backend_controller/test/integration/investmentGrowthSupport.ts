import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { expect } from "vitest"

import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createInvestmentBreakdownRepository } from "../../src/repositories/investmentBreakdownRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createRecordingCategoryRepository } from "../../src/repositories/recordingCategoryRepository.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminClientPositionRoutes } from "../../src/routes/adminClientPositionRoutes.js"
import { registerAdminInvestmentGrowthRoutes } from "../../src/routes/adminInvestmentGrowthRoutes.js"
import { registerAdminRecordingCategoryRoutes } from "../../src/routes/adminRecordingCategoryRoutes.js"
import { registerAdminSipScheduleRoutes } from "../../src/routes/adminSipScheduleRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { GROWTH_CONFIG, growthMailDeps } from "./growthMailSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

export const EARLIER = "recorded_offline_investment"
export const MONTHLY = "recorded_offline_monthly_investment"

export const envelopeOf = <T>(response: { json: () => unknown }) =>
  response.json() as { data: T; meta: { idempotencyReplay?: boolean }; error: { code: string; message?: string } }

export class InvestmentGrowthHarness {
  private constructor(
    readonly stack: PasswordMailStack,
    readonly app: FastifyInstance,
    readonly finance: AdminSession,
  ) {}

  static async start(): Promise<InvestmentGrowthHarness> {
    const stack = await PasswordMailStack.start({ seed: true })
    const webAuth = await adminWebAuth(stack)
    const shared = {
      webAuth,
      unitOfWork: stack.unitOfWork,
      database: stack.database,
      clock: stack.clock,
      userRepository: stack.userRepository,
      auditRepository: stack.auditRepository,
      idempotencyRepository: createIdempotencyRepository(),
      sipScheduleRepository: createAdminSipScheduleRepository(),
      recordingCategoryRepository: createRecordingCategoryRepository(),
      clientGrowthRepository: createClientGrowthRepository(),
      notificationRepository: createNotificationRepository(),
    }
    const growth = { ...shared, ...growthMailDeps(stack.crypto), config: GROWTH_CONFIG }
    const app = createApplication({
      logger: false,
      registerRoutes: (instance) => {
        registerAdminLogin(instance, stack, webAuth)
        registerAdminClientPositionRoutes(instance, {
          ...growth,
          clientPositionRepository: createClientPositionRepository(),
        })
        registerAdminRecordingCategoryRoutes(instance, { ...shared, config: { idempotencyTtlMs: 86_400_000 } })
        registerAdminSipScheduleRoutes(instance, { ...shared, config: { idempotencyTtlMs: 86_400_000, cursorKey: randomBytes(32) } })
        registerAdminClientGrowthRoutes(instance, growth)
        registerAdminInvestmentGrowthRoutes(instance, { ...growth, investmentBreakdownRepository: createInvestmentBreakdownRepository() })
      },
    })
    const finance = await signInRoleAdmin(app, stack, "finance")
    return new InvestmentGrowthHarness(stack, app, finance)
  }

  async stop(): Promise<void> {
    await this.app.close()
    await this.stack.stop()
  }

  async seedFund(name: string): Promise<string> {
    const fund = await this.stack.first(
      "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
      [`growth-${randomUUID().slice(0, 8)}`, this.finance.userId],
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

  post(url: string, payload: Readonly<Record<string, unknown>>, key: string | null = `growth-${randomUUID()}`) {
    return this.app.inject({ method: "POST", url, headers: adminHeaders(this.finance, key ?? undefined), payload })
  }

  async recordOk(userId: string, body: Readonly<Record<string, unknown>>): Promise<string> {
    const response = await this.post(`/v1/admin/clients/${userId}/recorded-contributions`, { amountPaise: "500000", ...body })
    expect(response.statusCode).toBe(201)
    return envelopeOf<{ entryId: string }>(response).data.entryId
  }

  async markOneTime(userId: string, entryId: string): Promise<void> {
    const response = await this.post(`/v1/admin/clients/${userId}/recorded-contributions/${entryId}/category`, { category: "one_time" })
    expect(response.statusCode).toBe(201)
  }

  async sipSchedule(userId: string, fundId: string): Promise<string> {
    const created = await this.post(`/v1/admin/clients/${userId}/sip-schedules`, {
      fundId,
      monthlyAmountPaise: "500000",
      startMonth: "2026-01",
      monthCount: 12,
    })
    expect(created.statusCode).toBe(201)
    return envelopeOf<{ schedule: { scheduleId: string } }>(created).data.schedule.scheduleId
  }

  async linkMonths(userId: string, scheduleId: string, entryIds: readonly string[]): Promise<void> {
    const links = entryIds.map((entryId, index) => ({ month: `2026-0${String(index + 1)}`, entryId }))
    const linked = await this.post(`/v1/admin/clients/${userId}/sip-schedules/${scheduleId}/month-links`, { links })
    expect(linked.statusCode).toBe(201)
  }

  async closeSchedule(userId: string, scheduleId: string): Promise<void> {
    const closed = await this.post(`/v1/admin/clients/${userId}/sip-schedules/${scheduleId}/close`, { expectedVersion: 1 })
    expect(closed.statusCode).toBe(200)
  }

  async allocationOf(entryId: string): Promise<string> {
    const row = await this.stack.first("select allocation_id from client_value_entries where id = $1", [entryId])
    return String(row.allocation_id)
  }

  async growthCounts(): Promise<readonly number[]> {
    return Promise.all(
      ["client_growth_batches", "client_value_entries", "client_growth_parts", "email_deliveries", "notifications"].map((table) =>
        this.stack.count(table),
      ),
    )
  }
}
