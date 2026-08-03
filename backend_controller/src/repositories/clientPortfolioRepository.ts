/**
 * Client portfolio read repository (spec 03 §2.3, §4.3, §7). Native-authenticated
 * read slice: derived investing-eligibility inputs, authoritative holdings valued
 * at the current published NAV, and the client's order history. Every query is
 * scoped by `user_id` so a row can never expose another user's data, uses the
 * `(user_id, created_at DESC, id DESC)` history keyset with a validated limit,
 * and exposes paise (bigint) and units/NAV (numeric) as strings — never a
 * JavaScript number. Reads never derive `eligible`; the pure decision function
 * consumes these inputs and the investing command re-derives under lock.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type {
  KycCaseState,
  OrderState,
  OrderType,
  RiskAssessmentState,
  UserAccountState,
} from "../db/types.js"

export interface EligibilityInputsRow {
  readonly accountState: UserAccountState
  readonly kycState: KycCaseState | null
  readonly kycExpiresAt: Date | null
  readonly riskState: RiskAssessmentState | null
}

export interface OrderRow {
  readonly id: string
  readonly fundId: string
  readonly sipPlanId: string | null
  readonly type: OrderType
  readonly state: OrderState
  readonly amountPaise: string | null
  readonly requestedUnits: string | null
  readonly currency: string
  readonly requestedAt: Date | null
  readonly paymentConfirmedAt: Date | null
  readonly bookedAt: Date | null
  readonly cancelledAt: Date | null
  readonly failureCode: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}

export interface HistoryPageQuery {
  readonly userId: string
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  /** validated integer 1..MAX_QUERY_LIMIT (+1 for hasMore probing) */
  readonly limit: number
}

export interface PaymentDetailRow {
  readonly id: string
  readonly orderId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly currency: string
  readonly state: string
  readonly provider: string | null
  readonly providerPaymentId: string | null
  readonly attemptState: string | null
  readonly failureCode: string | null
  readonly expiresAt: Date | null
  readonly succeededAt: Date | null
  readonly failedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface ClientPortfolioReadRepository {
  eligibilityInputs: (tx: Transaction, userId: string) => Promise<EligibilityInputsRow | null>
  listOrders: (tx: Transaction, query: HistoryPageQuery) => Promise<readonly OrderRow[]>
  /** Owner-scoped single order; null when it does not belong to `userId`. */
  findOrder: (tx: Transaction, userId: string, orderId: string) => Promise<OrderRow | null>
  /** Owner-scoped payment with its latest attempt (provider + failure detail). */
  findPayment: (tx: Transaction, userId: string, paymentId: string) => Promise<PaymentDetailRow | null>
}

export const createClientPortfolioRepository = (): ClientPortfolioReadRepository => ({
  eligibilityInputs: async (tx, userId) => {
    const result = await sql<EligibilityInputsRow>`
      select
        u.account_state as "accountState",
        k.state as "kycState",
        k.expires_at as "kycExpiresAt",
        r.state as "riskState"
      from users u
      left join lateral (
        select state, expires_at from kyc_cases
        where user_id = u.id order by created_at desc, id desc limit 1
      ) k on true
      left join lateral (
        select state from risk_assessments
        where user_id = u.id order by created_at desc, id desc limit 1
      ) r on true
      where u.id = ${userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listOrders: async (tx, query) => {
    const keyset =
      query.afterCreatedAt !== undefined && query.afterId !== undefined
        ? sql`and (created_at < ${query.afterCreatedAt}
              or (created_at = ${query.afterCreatedAt} and id < ${query.afterId}))`
        : sql``
    const result = await sql<OrderRow>`
      select
        id as "id",
        fund_id as "fundId",
        sip_plan_id as "sipPlanId",
        type as "type",
        state as "state",
        amount_paise::text as "amountPaise",
        requested_units::text as "requestedUnits",
        currency as "currency",
        requested_at as "requestedAt",
        payment_confirmed_at as "paymentConfirmedAt",
        booked_at as "bookedAt",
        cancelled_at as "cancelledAt",
        failure_code as "failureCode",
        created_at as "createdAt",
        updated_at as "updatedAt",
        version::text as "version"
      from investment_orders
      where user_id = ${query.userId}
      ${keyset}
      order by created_at desc, id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  findOrder: async (tx, userId, orderId) => {
    const result = await sql<OrderRow>`
      select
        id as "id",
        fund_id as "fundId",
        sip_plan_id as "sipPlanId",
        type as "type",
        state as "state",
        amount_paise::text as "amountPaise",
        requested_units::text as "requestedUnits",
        currency as "currency",
        requested_at as "requestedAt",
        payment_confirmed_at as "paymentConfirmedAt",
        booked_at as "bookedAt",
        cancelled_at as "cancelledAt",
        failure_code as "failureCode",
        created_at as "createdAt",
        updated_at as "updatedAt",
        version::text as "version"
      from investment_orders
      where id = ${orderId} and user_id = ${userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  findPayment: async (tx, userId, paymentId) => {
    // The latest attempt carries the provider identifiers and failure code the
    // status screen shows; the payment row carries the authoritative state.
    const result = await sql<PaymentDetailRow>`
      select
        p.id as "id",
        p.order_id as "orderId",
        o.fund_id as "fundId",
        p.amount_paise::text as "amountPaise",
        p.currency as "currency",
        p.state as "state",
        a.provider as "provider",
        a.provider_payment_id as "providerPaymentId",
        a.state as "attemptState",
        a.failure_code as "failureCode",
        a.expires_at as "expiresAt",
        p.succeeded_at as "succeededAt",
        p.failed_at as "failedAt",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt"
      from payments p
      join investment_orders o on o.id = p.order_id
      left join lateral (
        select provider, provider_payment_id, state, failure_code, expires_at
        from payment_attempts
        where payment_id = p.id
        order by attempt_number desc limit 1
      ) a on true
      where p.id = ${paymentId} and p.user_id = ${userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },
})
