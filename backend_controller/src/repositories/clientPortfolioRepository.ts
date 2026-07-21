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
  FundRiskLevel,
  FundState,
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

export interface HoldingPositionRow {
  readonly id: string
  readonly fundId: string
  readonly fundSlug: string
  readonly fundState: FundState
  readonly fundName: string | null
  readonly fundCategory: string | null
  readonly fundRiskLevel: FundRiskLevel | null
  readonly currency: string
  readonly totalUnits: string
  readonly reservedUnits: string
  readonly availableUnits: string
  readonly costBasisPaise: string
  readonly currentNav: string | null
  readonly navAsOfDate: string | null
  /** round(total_units * nav * 100); a presentation estimate, not booked evidence. */
  readonly marketValuePaise: string | null
  readonly version: string
  readonly createdAt: Date
  readonly updatedAt: Date
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

export interface ClientPortfolioReadRepository {
  eligibilityInputs: (tx: Transaction, userId: string) => Promise<EligibilityInputsRow | null>
  listHoldings: (tx: Transaction, query: HistoryPageQuery) => Promise<readonly HoldingPositionRow[]>
  listOrders: (tx: Transaction, query: HistoryPageQuery) => Promise<readonly OrderRow[]>
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

  listHoldings: async (tx, query) => {
    const keyset =
      query.afterCreatedAt !== undefined && query.afterId !== undefined
        ? sql`and (h.created_at < ${query.afterCreatedAt}
              or (h.created_at = ${query.afterCreatedAt} and h.id < ${query.afterId}))`
        : sql``
    const result = await sql<HoldingPositionRow>`
      select
        h.id as "id",
        h.fund_id as "fundId",
        f.slug as "fundSlug",
        f.state as "fundState",
        fv.name as "fundName",
        fv.category as "fundCategory",
        fv.risk_level as "fundRiskLevel",
        coalesce(fv.currency, 'INR') as "currency",
        h.total_units::text as "totalUnits",
        h.reserved_units::text as "reservedUnits",
        (h.total_units - h.reserved_units)::text as "availableUnits",
        h.cost_basis_paise::text as "costBasisPaise",
        nav.nav::text as "currentNav",
        nav.as_of_date::text as "navAsOfDate",
        case when nav.nav is not null then round(h.total_units * nav.nav * 100)::text else null end
          as "marketValuePaise",
        h.version::text as "version",
        h.created_at as "createdAt",
        h.updated_at as "updatedAt"
      from holdings h
      join funds f on f.id = h.fund_id
      left join fund_versions fv on fv.id = f.current_published_version_id
      left join lateral (
        select nav, as_of_date from fund_nav_prices
        where fund_id = h.fund_id order by as_of_date desc, revision desc limit 1
      ) nav on true
      where h.user_id = ${query.userId}
      ${keyset}
      order by h.created_at desc, h.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
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
})
