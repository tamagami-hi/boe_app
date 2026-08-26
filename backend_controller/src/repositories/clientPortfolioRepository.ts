/**
 * Client portfolio read repository. Native-authenticated read slice: derived
 * investing-eligibility inputs and the client's order/payment history. Every
 * query is scoped by `user_id` so a row can never expose another user's data,
 * uses the `(user_id, created_at DESC, id DESC)` history keyset with a validated
 * limit, and exposes paise (bigint) as strings — never a JavaScript number.
 * Reads never derive `eligible`; the pure decision function consumes these
 * inputs and the investing command re-derives under lock.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type {
  EmailVerificationState,
  OrderState,
  OrderType,
  PaymentState,
  UserAccountState,
} from "../db/types.js"

export interface EligibilityInputsRow {
  readonly accountState: UserAccountState
  readonly emailVerificationState: EmailVerificationState | null
  readonly emailVerificationExpiresAt: Date | null
}

export interface OrderRow {
  readonly id: string
  readonly fundId: string
  readonly fundVersionId: string
  readonly sipPlanId: string | null
  readonly type: OrderType
  readonly state: OrderState
  readonly amountPaise: string
  readonly currency: string
  readonly requestedAt: Date
  readonly paymentConfirmedAt: Date | null
  readonly acceptedAt: Date | null
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
  readonly state: PaymentState
  readonly orderState: OrderState
  readonly acceptedAt: Date | null
  readonly provider: string | null
  readonly merchantOrderId: string | null
  readonly providerOrderId: string | null
  readonly attemptState: PaymentState | null
  readonly failureCode: string | null
  readonly expiresAt: Date | null
  readonly succeededAt: Date | null
  readonly failedAt: Date | null
  readonly refundedAt: Date | null
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

const ORDER_COLUMNS = sql`
  id as "id",
  fund_id as "fundId",
  fund_version_id as "fundVersionId",
  sip_plan_id as "sipPlanId",
  type as "type",
  state as "state",
  amount_paise::text as "amountPaise",
  currency as "currency",
  requested_at as "requestedAt",
  payment_confirmed_at as "paymentConfirmedAt",
  accepted_at as "acceptedAt",
  cancelled_at as "cancelledAt",
  failure_code as "failureCode",
  created_at as "createdAt",
  updated_at as "updatedAt",
  version::text as "version"
`

export const createClientPortfolioRepository = (): ClientPortfolioReadRepository => ({
  eligibilityInputs: async (tx, userId) => {
    const result = await sql<EligibilityInputsRow>`
      select
        u.account_state as "accountState",
        u.email_verification_state as "emailVerificationState",
        u.email_verification_expires_at as "emailVerificationExpiresAt"
      from users u
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
      select ${ORDER_COLUMNS}
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
      select ${ORDER_COLUMNS}
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
        o.state as "orderState",
        o.accepted_at as "acceptedAt",
        a.provider as "provider",
        a.merchant_order_id as "merchantOrderId",
        a.provider_order_id as "providerOrderId",
        a.state as "attemptState",
        a.failure_code as "failureCode",
        a.checkout_expires_at as "expiresAt",
        p.succeeded_at as "succeededAt",
        p.failed_at as "failedAt",
        p.refunded_at as "refundedAt",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt"
      from payments p
      join investment_orders o on o.id = p.order_id
      left join lateral (
        select provider, merchant_order_id, provider_order_id, state, failure_code, checkout_expires_at
        from payment_attempts
        where payment_id = p.id
        order by attempt_number desc limit 1
      ) a on true
      where p.id = ${paymentId} and p.user_id = ${userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },
})
