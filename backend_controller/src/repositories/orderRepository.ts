/**
 * Investment-order write repository. Owns order-row creation and the guarded
 * reads the createOrder command needs under lock (published fund terms, latest
 * compliance state). Every query is scoped by `user_id`; the created order pins
 * the fund's current published version (`fund_version_id`) at creation time.
 */
import { sql } from "kysely"

import type { InvestmentOrder, Transaction } from "../db/repositories.js"
import type { FundState, KycCaseState, RiskAssessmentState } from "../db/types.js"

export interface CreateOrderInput {
  readonly userId: string
  readonly fundId: string
  readonly fundVersionId: string
  readonly amountPaise: string
  readonly currency: string
  readonly now: Date
}

export interface CreateSipInstallmentInput {
  readonly userId: string
  readonly fundId: string
  readonly fundVersionId: string
  readonly sipPlanId: string
  readonly amountPaise: string
  readonly currency: string
  readonly duePeriod: string
  readonly now: Date
}

export interface FundOrderTermsRow {
  readonly fundState: FundState
  readonly currency: string
  /** null when the fund has never had a published version. */
  readonly fundVersionId: string | null
  readonly minimumPurchasePaise: string | null
  readonly minimumSipPaise: string | null
}

export interface LatestComplianceRow {
  readonly kycState: KycCaseState | null
  readonly kycExpiresAt: Date | null
  readonly riskState: RiskAssessmentState | null
}

export interface OrderWriteRepository {
  findFundOrderTerms: (tx: Transaction, fundId: string) => Promise<FundOrderTermsRow | null>
  latestCompliance: (tx: Transaction, userId: string) => Promise<LatestComplianceRow>
  createPurchase: (tx: Transaction, input: CreateOrderInput) => Promise<InvestmentOrder>
  createSipInstallment: (tx: Transaction, input: CreateSipInstallmentInput) => Promise<InvestmentOrder | null>
  findOpenInstallment: (tx: Transaction, sipPlanId: string) => Promise<InvestmentOrder | null>
  findInstallmentByPeriod: (
    tx: Transaction,
    input: Readonly<{ sipPlanId: string; duePeriod: string }>,
  ) => Promise<InvestmentOrder | null>
  lockById: (
    tx: Transaction,
    input: Readonly<{ orderId: string; userId: string }>,
  ) => Promise<InvestmentOrder | null>
}

export const createOrderRepository = (): OrderWriteRepository => ({
  findFundOrderTerms: async (tx, fundId) => {
    const result = await sql<FundOrderTermsRow>`
      select
        f.state as "fundState",
        coalesce(fv.currency, 'INR') as "currency",
        f.current_published_version_id as "fundVersionId",
        fv.minimum_purchase_paise::text as "minimumPurchasePaise",
        fv.minimum_sip_paise::text as "minimumSipPaise"
      from funds f
      left join fund_versions fv on fv.id = f.current_published_version_id
      where f.id = ${fundId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  latestCompliance: async (tx, userId) => {
    const result = await sql<LatestComplianceRow>`
      select
        k.state as "kycState",
        k.expires_at as "kycExpiresAt",
        r.state as "riskState"
      from (select ${userId}::uuid as user_id) u
      left join lateral (
        select state, expires_at from kyc_cases
        where user_id = u.user_id order by created_at desc, id desc limit 1
      ) k on true
      left join lateral (
        select state from risk_assessments
        where user_id = u.user_id order by created_at desc, id desc limit 1
      ) r on true
    `.execute(tx)
    return result.rows[0] ?? { kycState: null, kycExpiresAt: null, riskState: null }
  },

  createPurchase: async (tx, input) =>
    tx
      .insertInto("investment_orders")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        fund_version_id: input.fundVersionId,
        type: "lump_sum",
        amount_paise: input.amountPaise,
        currency: input.currency,
        requested_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  createSipInstallment: async (tx, input) => {
    const row = await tx
      .insertInto("investment_orders")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        fund_version_id: input.fundVersionId,
        sip_plan_id: input.sipPlanId,
        type: "sip_installment",
        amount_paise: input.amountPaise,
        currency: input.currency,
        due_period: input.duePeriod,
        requested_at: input.now,
      })
      .onConflict((builder) => builder.columns(["sip_plan_id", "due_period"])
        .where("type", "=", "sip_installment").doNothing())
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  findOpenInstallment: async (tx, sipPlanId) => {
    const row = await tx
      .selectFrom("investment_orders")
      .selectAll()
      .where("sip_plan_id", "=", sipPlanId)
      .where("type", "=", "sip_installment")
      .where("state", "in", ["submitted", "payment_pending", "review_pending"])
      .orderBy("due_period", "desc")
      .limit(1)
      .executeTakeFirst()
    return row ?? null
  },

  findInstallmentByPeriod: async (tx, input) => {
    const row = await tx
      .selectFrom("investment_orders")
      .selectAll()
      .where("sip_plan_id", "=", input.sipPlanId)
      .where("type", "=", "sip_installment")
      .where(sql<boolean>`due_period = ${input.duePeriod}`)
      .executeTakeFirst()
    return row ?? null
  },

  lockById: async (tx, input) => {
    const row = await tx
      .selectFrom("investment_orders")
      .selectAll()
      .where("id", "=", input.orderId)
      .where("user_id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },
})
