/**
 * Investment-order write repository (spec 03 §4.3, §5.2, §6, §7). Owns order-row
 * creation and the guarded state transitions of the client order lifecycle. Every
 * query is scoped by `user_id`; transitions use guarded
 * `UPDATE ... WHERE id = ? AND user_id = ? AND state IN (...) AND version = ?
 * RETURNING *` so exactly one concurrent transition can win. Also exposes the
 * order-guard reads (published fund terms, latest compliance state) the
 * createOrder command needs under lock.
 */
import { sql } from "kysely"

import type { InvestmentOrder, Transaction } from "../db/repositories.js"
import type { FundState, KycCaseState, RiskAssessmentState } from "../db/types.js"

export interface CreateOrderInput {
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly currency: string
  readonly now: Date
}

export interface FundOrderTermsRow {
  readonly fundState: FundState
  readonly currency: string
  /** null when the fund has never had a published version. */
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
  lockById: (
    tx: Transaction,
    input: Readonly<{ orderId: string; userId: string }>,
  ) => Promise<InvestmentOrder | null>
  /** submitted -> payment_pending for a purchase/SIP order; null when the guard fails. */
  beginPayment: (
    tx: Transaction,
    input: Readonly<{ orderId: string; userId: string; now: Date }>,
  ) => Promise<InvestmentOrder | null>
  /** payment_pending -> payment_confirmed; null when the guard fails. */
  confirmPayment: (
    tx: Transaction,
    input: Readonly<{ orderId: string; userId: string; now: Date }>,
  ) => Promise<InvestmentOrder | null>
  /** payment_confirmed -> booked; null when the guard fails. */
  book: (
    tx: Transaction,
    input: Readonly<{ orderId: string; userId: string; now: Date }>,
  ) => Promise<InvestmentOrder | null>
}

export const createOrderRepository = (): OrderWriteRepository => ({
  findFundOrderTerms: async (tx, fundId) => {
    const result = await sql<FundOrderTermsRow>`
      select
        f.state as "fundState",
        coalesce(fv.currency, 'INR') as "currency",
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
        type: "purchase",
        amount_paise: input.amountPaise,
        currency: input.currency,
        requested_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

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

  beginPayment: async (tx, input) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({
        state: "payment_pending",
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.orderId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "submitted")
      .where("type", "in", ["purchase", "sip_installment"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  confirmPayment: async (tx, input) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({
        state: "payment_confirmed",
        payment_confirmed_at: input.now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.orderId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "payment_pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  book: async (tx, input) => {
    const row = await tx
      .updateTable("investment_orders")
      .set({
        state: "booked",
        booked_at: input.now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.orderId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "payment_confirmed")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },
})
