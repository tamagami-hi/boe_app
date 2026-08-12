/**
 * Admin oversight repository (spec 03 §4.1/§4.3/§4.4, §7; spec 04 §3.2).
 *
 * Read projections over authoritative evidence the admin console supervises —
 * user directory, orders/executions, payments, mandates, SIPs, redemption
 * requests, KYC cases, and the audit log — plus the two write paths admins own
 * here: the user account lifecycle and a KYC/redemption decision.
 *
 * Every list is keyset-paginated on `(created_at DESC, id DESC)` with a validated
 * limit, and money/units cross the boundary as strings. Search terms are matched
 * with a bounded prefix/`ILIKE` on indexed identity columns, never a full-text
 * scan over PII ciphertext.
 */
import { sql } from "kysely"

import type { Transaction, User } from "../db/repositories.js"
import type {
  KycCaseState,
  RedemptionMode,
  MandateState,
  OrderState,
  OrderType,
  PaymentState,
  RedemptionState,
  SipState,
  UserAccountState,
} from "../db/types.js"

export interface OversightPageQuery {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  readonly limit: number
}

export interface UserListRow {
  readonly id: string
  readonly fullName: string
  readonly email: string
  readonly phone: string
  readonly accountState: UserAccountState
  readonly isPiiTombstoned: boolean
  readonly activatedAt: Date | null
  readonly suspendedAt: Date | null
  readonly closedAt: Date | null
  readonly kycState: KycCaseState | null
  readonly holdingsCount: number
  readonly ordersCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}

export interface UserListQuery extends OversightPageQuery {
  readonly state?: UserAccountState
  readonly search?: string
}

export interface OrderListRow {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly fundId: string
  readonly fundSlug: string
  readonly fundName: string | null
  readonly sipPlanId: string | null
  readonly type: OrderType
  readonly state: OrderState
  readonly amountPaise: string | null
  readonly currency: string
  readonly requestedAt: Date | null
  readonly bookedAt: Date | null
  readonly failureCode: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface OrderListQuery extends OversightPageQuery {
  readonly fundId?: string
  readonly state?: OrderState
  readonly type?: OrderType
  readonly search?: string
}

export interface PaymentListRow {
  readonly id: string
  readonly orderId: string
  readonly userId: string
  readonly userEmail: string
  readonly amountPaise: string
  readonly currency: string
  readonly state: PaymentState
  readonly attemptCount: number
  readonly provider: string | null
  readonly providerReference: string | null
  readonly succeededAt: Date | null
  readonly failedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface PaymentListQuery extends OversightPageQuery {
  readonly state?: PaymentState
  readonly userId?: string
}

export interface MandateListRow {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly provider: string
  readonly providerMandateId: string | null
  readonly maxAmountPaise: string
  readonly frequency: string
  readonly debitDay: number | null
  readonly state: MandateState
  readonly validFrom: Date | null
  readonly validTo: Date | null
  readonly sipCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface SipListRow {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly fundId: string
  readonly fundSlug: string
  readonly amountPaise: string
  readonly debitDay: number
  readonly state: SipState
  readonly mandateId: string | null
  readonly startDate: string | null
  readonly nextDueDate: string | null
  readonly installments: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface RedemptionListRow {
  readonly id: string
  readonly orderId: string
  readonly userId: string
  readonly userEmail: string
  readonly fundId: string
  readonly fundSlug: string
  readonly state: RedemptionState
  readonly mode: RedemptionMode | null
  readonly requestedAmountPaise: string | null
  readonly principalComponentPaise: string | null
  readonly returnsComponentPaise: string | null
  readonly settledAmountPaise: string | null
  readonly requiresDualApproval: boolean
  readonly financePolicyVersion: number
  readonly submittedAt: Date | null
  readonly approvedAt: Date | null
  readonly settledAt: Date | null
  readonly reasonCode: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}

export interface KycCaseListRow {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly userFullName: string
  readonly state: KycCaseState
  readonly provider: string | null
  readonly submittedAt: Date | null
  readonly decidedAt: Date | null
  readonly expiresAt: Date | null
  readonly reviewCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}

export interface AuditEventListRow {
  readonly id: string
  readonly occurredAt: Date
  readonly actorType: string
  readonly actorUserId: string | null
  readonly actorEmail: string | null
  readonly command: string
  readonly entityType: string
  readonly entityId: string
  readonly fromState: string | null
  readonly toState: string | null
  readonly reasonCode: string | null
  readonly requestId: string
  readonly entityVersion: string
  readonly metadata: unknown
  /** Alias of `occurredAt`, so the shared keyset paginator can sort uniformly. */
  readonly createdAt: Date
}

export interface AuditListQuery extends OversightPageQuery {
  readonly entityType?: string
  readonly command?: string
  readonly actorUserId?: string
  readonly occurredFrom?: Date
  readonly occurredTo?: Date
}

/**
 * One pool the user has money in, as the admin profile shows it. Every figure is
 * derived from that user's ledger for that pool — there is no stored balance and
 * no per-unit price.
 */
export interface AdminUserPositionRow {
  readonly fundId: string
  readonly fundSlug: string
  readonly fundName: string | null
  readonly totalInvestmentPaise: string
  readonly currentValuePaise: string
  readonly sipInstallmentCount: number
  readonly sipTotalPaise: string
  readonly lumpSumCount: number
  readonly lumpSumTotalPaise: string
  readonly redemptionCount: number
  readonly redeemedTotalPaise: string
  readonly allocatedGainPaise: string
  readonly firstInvestmentDate: string | null
  readonly lastActivityDate: string | null
}

export interface UserDetail {
  readonly user: UserListRow
  readonly roles: readonly string[]
  readonly kyc: KycCaseListRow | null
  readonly orders: readonly OrderListRow[]
  readonly payments: readonly PaymentListRow[]
  readonly mandates: readonly MandateListRow[]
  readonly sips: readonly SipListRow[]
  readonly positions: readonly AdminUserPositionRow[]
}

export interface AdminOversightRepository {
  listUsers: (tx: Transaction, query: UserListQuery) => Promise<readonly UserListRow[]>
  findUser: (tx: Transaction, userId: string) => Promise<UserListRow | null>
  userDetail: (tx: Transaction, userId: string) => Promise<UserDetail | null>
  lockUser: (tx: Transaction, userId: string) => Promise<User | null>
  setUserAccountState: (
    tx: Transaction,
    input: {
      readonly userId: string
      readonly state: UserAccountState
      readonly now: Date
      readonly expectedVersion: number
    },
  ) => Promise<User | null>

  listOrders: (tx: Transaction, query: OrderListQuery) => Promise<readonly OrderListRow[]>
  listPayments: (tx: Transaction, query: PaymentListQuery) => Promise<readonly PaymentListRow[]>
  listMandates: (
    tx: Transaction,
    query: OversightPageQuery & { readonly state?: MandateState },
  ) => Promise<readonly MandateListRow[]>
  listSips: (
    tx: Transaction,
    query: OversightPageQuery & { readonly state?: SipState },
  ) => Promise<readonly SipListRow[]>

  listRedemptions: (
    tx: Transaction,
    query: OversightPageQuery & { readonly state?: RedemptionState },
  ) => Promise<readonly RedemptionListRow[]>

  listAuditEvents: (tx: Transaction, query: AuditListQuery) => Promise<readonly AuditEventListRow[]>
}

const keyset = (query: OversightPageQuery, alias: string) =>
  query.afterCreatedAt !== undefined && query.afterId !== undefined
    ? sql`and (${sql.raw(alias)}.created_at < ${query.afterCreatedAt}
        or (${sql.raw(alias)}.created_at = ${query.afterCreatedAt} and ${sql.raw(alias)}.id < ${query.afterId}))`
    : sql``

const USER_COLUMNS = sql`
  u.id as "id",
  case when u.pii_tombstoned_at is null then u.full_name else 'Tombstoned' end as "fullName",
  case when u.pii_tombstoned_at is null then u.email_normalized
       else 'tombstone+' || replace(u.id::text, '-', '') || '@invalid.example' end as "email",
  case when u.pii_tombstoned_at is null then u.phone_e164 else 'tombstone' end as "phone",
  u.account_state as "accountState",
  (u.pii_tombstoned_at is not null) as "isPiiTombstoned",
  u.activated_at as "activatedAt",
  u.suspended_at as "suspendedAt",
  u.closed_at as "closedAt",
  k.state as "kycState",
  coalesce(h.count, 0)::int as "holdingsCount",
  coalesce(o.count, 0)::int as "ordersCount",
  u.created_at as "createdAt",
  u.updated_at as "updatedAt",
  u.version::text as "version"
`

const USER_JOINS = sql`
  from users u
  left join lateral (
    select state from kyc_cases where user_id = u.id order by created_at desc, id desc limit 1
  ) k on true
  left join lateral (select count(*) as count from holdings where user_id = u.id) h on true
  left join lateral (select count(*) as count from investment_orders where user_id = u.id) o on true
`

const ORDER_COLUMNS = sql`
  o.id as "id",
  o.user_id as "userId",
  u.email_normalized as "userEmail",
  o.fund_id as "fundId",
  f.slug as "fundSlug",
  fv.name as "fundName",
  o.sip_plan_id as "sipPlanId",
  o.type as "type",
  o.state as "state",
  o.amount_paise::text as "amountPaise",
  o.currency as "currency",
  o.requested_at as "requestedAt",
  o.booked_at as "bookedAt",
  o.failure_code as "failureCode",
  o.created_at as "createdAt",
  o.updated_at as "updatedAt"
`

const ORDER_JOINS = sql`
  from investment_orders o
  join users u on u.id = o.user_id
  join funds f on f.id = o.fund_id
  left join fund_versions fv on fv.id = f.current_published_version_id
`

const PAYMENT_COLUMNS = sql`
  p.id as "id",
  p.order_id as "orderId",
  p.user_id as "userId",
  u.email_normalized as "userEmail",
  p.amount_paise::text as "amountPaise",
  p.currency as "currency",
  p.state as "state",
  coalesce(a.count, 0)::int as "attemptCount",
  a.provider as "provider",
  a.provider_payment_id as "providerReference",
  p.succeeded_at as "succeededAt",
  p.failed_at as "failedAt",
  p.created_at as "createdAt",
  p.updated_at as "updatedAt"
`

const PAYMENT_JOINS = sql`
  from payments p
  join users u on u.id = p.user_id
  left join lateral (
    select count(*) over () as count, provider, provider_payment_id
    from payment_attempts where payment_id = p.id
    order by created_at desc limit 1
  ) a on true
`

const MANDATE_COLUMNS = sql`
  m.id as "id",
  m.user_id as "userId",
  u.email_normalized as "userEmail",
  m.provider as "provider",
  m.provider_mandate_id as "providerMandateId",
  m.max_amount_paise::text as "maxAmountPaise",
  m.frequency as "frequency",
  m.debit_day as "debitDay",
  m.state as "state",
  m.valid_from as "validFrom",
  m.valid_to as "validTo",
  coalesce(s.count, 0)::int as "sipCount",
  m.created_at as "createdAt",
  m.updated_at as "updatedAt"
`

const MANDATE_JOINS = sql`
  from mandates m
  join users u on u.id = m.user_id
  left join lateral (select count(*) as count from sip_plans where mandate_id = m.id) s on true
`

const SIP_COLUMNS = sql`
  s.id as "id",
  s.user_id as "userId",
  u.email_normalized as "userEmail",
  s.fund_id as "fundId",
  f.slug as "fundSlug",
  s.amount_paise::text as "amountPaise",
  s.debit_day as "debitDay",
  s.state as "state",
  s.mandate_id as "mandateId",
  s.start_date::text as "startDate",
  s.next_due_date::text as "nextDueDate",
  coalesce(i.count, 0)::int as "installments",
  s.created_at as "createdAt",
  s.updated_at as "updatedAt"
`

const SIP_JOINS = sql`
  from sip_plans s
  join users u on u.id = s.user_id
  join funds f on f.id = s.fund_id
  left join lateral (
    select count(*) as count from investment_orders where sip_plan_id = s.id
  ) i on true
`

const REDEMPTION_COLUMNS = sql`
  r.id as "id",
  r.order_id as "orderId",
  r.user_id as "userId",
  u.email_normalized as "userEmail",
  r.fund_id as "fundId",
  f.slug as "fundSlug",
  r.state as "state",
  r.mode as "mode",
  r.requested_amount_paise::text as "requestedAmountPaise",
  r.principal_component_paise::text as "principalComponentPaise",
  r.returns_component_paise::text as "returnsComponentPaise",
  r.settled_amount_paise::text as "settledAmountPaise",
  r.requires_dual_approval as "requiresDualApproval",
  r.finance_policy_version as "financePolicyVersion",
  r.submitted_at as "submittedAt",
  r.approved_at as "approvedAt",
  r.settled_at as "settledAt",
  r.reason_code as "reasonCode",
  r.created_at as "createdAt",
  r.updated_at as "updatedAt",
  r.version::text as "version"
`

const REDEMPTION_JOINS = sql`
  from redemption_requests r
  join users u on u.id = r.user_id
  join funds f on f.id = r.fund_id
`

const KYC_COLUMNS = sql`
  c.id as "id",
  c.user_id as "userId",
  u.email_normalized as "userEmail",
  u.full_name as "userFullName",
  c.state as "state",
  c.provider as "provider",
  c.submitted_at as "submittedAt",
  c.decided_at as "decidedAt",
  c.expires_at as "expiresAt",
  coalesce(r.count, 0)::int as "reviewCount",
  c.created_at as "createdAt",
  c.updated_at as "updatedAt",
  c.version::text as "version"
`

const KYC_JOINS = sql`
  from kyc_cases c
  join users u on u.id = c.user_id
  left join lateral (select count(*) as count from kyc_reviews where kyc_case_id = c.id) r on true
`

export const createAdminOversightRepository = (): AdminOversightRepository => ({
  listUsers: async (tx, query) => {
    const stateClause = query.state === undefined ? sql`` : sql`and u.account_state = ${query.state}`
    const searchClause =
      query.search === undefined
        ? sql``
        : sql`and (u.email_normalized like ${`${query.search.toLowerCase()}%`}
            or u.phone_e164 like ${`%${query.search}%`}
            or u.full_name ilike ${`%${query.search}%`})`
    const result = await sql<UserListRow>`
      select ${USER_COLUMNS} ${USER_JOINS}
      where true
      ${stateClause} ${searchClause} ${keyset(query, "u")}
      order by u.created_at desc, u.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  findUser: async (tx, userId) => {
    const result = await sql<UserListRow>`
      select ${USER_COLUMNS} ${USER_JOINS} where u.id = ${userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  userDetail: async (tx, userId) => {
    const userResult = await sql<UserListRow>`
      select ${USER_COLUMNS} ${USER_JOINS} where u.id = ${userId}
    `.execute(tx)
    const user = userResult.rows[0]
    if (user === undefined) return null

    const [roles, kyc, orders, payments, mandates, sips, positions] = await Promise.all([
      sql<{ code: string }>`
        select r.code as "code" from user_roles ur join roles r on r.id = ur.role_id
        where ur.user_id = ${userId} order by r.code
      `.execute(tx),
      sql<KycCaseListRow>`
        select ${KYC_COLUMNS} ${KYC_JOINS} where c.user_id = ${userId}
        order by c.created_at desc, c.id desc limit 1
      `.execute(tx),
      sql<OrderListRow>`
        select ${ORDER_COLUMNS} ${ORDER_JOINS} where o.user_id = ${userId}
        order by o.created_at desc, o.id desc limit 10
      `.execute(tx),
      sql<PaymentListRow>`
        select ${PAYMENT_COLUMNS} ${PAYMENT_JOINS} where p.user_id = ${userId}
        order by p.created_at desc, p.id desc limit 10
      `.execute(tx),
      sql<MandateListRow>`
        select ${MANDATE_COLUMNS} ${MANDATE_JOINS} where m.user_id = ${userId}
        order by m.created_at desc, m.id desc limit 10
      `.execute(tx),
      sql<SipListRow>`
        select ${SIP_COLUMNS} ${SIP_JOINS} where s.user_id = ${userId}
        order by s.created_at desc, s.id desc limit 10
      `.execute(tx),
      sql<AdminUserPositionRow>`
        select
          l.fund_id as "fundId",
          f.slug as "fundSlug",
          fv.name as "fundName",
          sum(l.principal_delta_paise)::text as "totalInvestmentPaise",
          sum(l.value_delta_paise)::text as "currentValuePaise",
          count(*) filter (where l.entry_type = 'sip_installment')::int as "sipInstallmentCount",
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'sip_installment'), 0)::text
            as "sipTotalPaise",
          count(*) filter (where l.entry_type = 'lump_sum')::int as "lumpSumCount",
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'lump_sum'), 0)::text
            as "lumpSumTotalPaise",
          count(*) filter (where l.entry_type = 'redemption')::int as "redemptionCount",
          coalesce(sum(l.amount_paise) filter (where l.entry_type = 'redemption'), 0)::text
            as "redeemedTotalPaise",
          coalesce(sum(l.value_delta_paise) filter (where l.entry_type = 'gain_allocation'), 0)::text
            as "allocatedGainPaise",
          min(l.effective_date) filter (
            where l.entry_type in ('sip_installment','lump_sum')
          )::text as "firstInvestmentDate",
          max(l.effective_date)::text as "lastActivityDate"
        from investor_ledger_entries l
        join funds f on f.id = l.fund_id
        left join fund_versions fv on fv.id = f.current_published_version_id
        where l.user_id = ${userId}
        group by l.fund_id, f.slug, fv.name
        order by max(l.effective_date) desc
      `.execute(tx),
    ])

    return {
      user,
      roles: roles.rows.map((row) => row.code),
      kyc: kyc.rows[0] ?? null,
      orders: orders.rows,
      payments: payments.rows,
      mandates: mandates.rows,
      sips: sips.rows,
      positions: positions.rows,
    }
  },

  lockUser: async (tx, userId) => {
    const result = await sql<User>`select * from users where id = ${userId} for update`.execute(tx)
    return result.rows[0] ?? null
  },

  setUserAccountState: async (tx, input) => {
    const result = await sql<User>`
      update users set
        account_state = ${input.state},
        activated_at = case when ${input.state} = 'active' then coalesce(activated_at, ${input.now})
                            else activated_at end,
        suspended_at = case when ${input.state} = 'suspended' then ${input.now}
                            when ${input.state} = 'active' then null else suspended_at end,
        closed_at = case when ${input.state} = 'closed' then ${input.now} else closed_at end,
        updated_at = now(),
        version = version + 1
      where id = ${input.userId} and version = ${String(input.expectedVersion)}::bigint
      returning *
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listOrders: async (tx, query) => {
    const fundClause = query.fundId === undefined ? sql`` : sql`and o.fund_id = ${query.fundId}`
    const stateClause = query.state === undefined ? sql`` : sql`and o.state = ${query.state}`
    const typeClause = query.type === undefined ? sql`` : sql`and o.type = ${query.type}`
    const searchClause =
      query.search === undefined
        ? sql``
        : sql`and (o.id::text like ${`${query.search}%`}
            or u.email_normalized like ${`${query.search.toLowerCase()}%`})`
    const result = await sql<OrderListRow>`
      select ${ORDER_COLUMNS} ${ORDER_JOINS}
      where true ${fundClause} ${stateClause} ${typeClause} ${searchClause} ${keyset(query, "o")}
      order by o.created_at desc, o.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  listPayments: async (tx, query) => {
    const stateClause = query.state === undefined ? sql`` : sql`and p.state = ${query.state}`
    const userClause = query.userId === undefined ? sql`` : sql`and p.user_id = ${query.userId}`
    const result = await sql<PaymentListRow>`
      select ${PAYMENT_COLUMNS} ${PAYMENT_JOINS}
      where true ${stateClause} ${userClause} ${keyset(query, "p")}
      order by p.created_at desc, p.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  listMandates: async (tx, query) => {
    const stateClause = query.state === undefined ? sql`` : sql`and m.state = ${query.state}`
    const result = await sql<MandateListRow>`
      select ${MANDATE_COLUMNS} ${MANDATE_JOINS}
      where true ${stateClause} ${keyset(query, "m")}
      order by m.created_at desc, m.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  listSips: async (tx, query) => {
    const stateClause = query.state === undefined ? sql`` : sql`and s.state = ${query.state}`
    const result = await sql<SipListRow>`
      select ${SIP_COLUMNS} ${SIP_JOINS}
      where true ${stateClause} ${keyset(query, "s")}
      order by s.created_at desc, s.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  listRedemptions: async (tx, query) => {
    const stateClause = query.state === undefined ? sql`` : sql`and r.state = ${query.state}`
    const result = await sql<RedemptionListRow>`
      select ${REDEMPTION_COLUMNS} ${REDEMPTION_JOINS}
      where true ${stateClause} ${keyset(query, "r")}
      order by r.created_at desc, r.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  listAuditEvents: async (tx, query) => {
    const entityClause =
      query.entityType === undefined ? sql`` : sql`and a.entity_type = ${query.entityType}`
    const commandClause = query.command === undefined ? sql`` : sql`and a.command = ${query.command}`
    const actorClause =
      query.actorUserId === undefined ? sql`` : sql`and a.actor_user_id = ${query.actorUserId}`
    const fromClause =
      query.occurredFrom === undefined ? sql`` : sql`and a.occurred_at >= ${query.occurredFrom}`
    const toClause = query.occurredTo === undefined ? sql`` : sql`and a.occurred_at <= ${query.occurredTo}`
    // `audit_events` has no `created_at`; `occurred_at` is its append timestamp.
    const keysetClause =
      query.afterCreatedAt !== undefined && query.afterId !== undefined
        ? sql`and (a.occurred_at < ${query.afterCreatedAt}
            or (a.occurred_at = ${query.afterCreatedAt} and a.id < ${query.afterId}))`
        : sql``
    const result = await sql<AuditEventListRow>`
      select
        a.id as "id",
        a.occurred_at as "occurredAt",
        a.occurred_at as "createdAt",
        a.actor_type as "actorType",
        a.actor_user_id as "actorUserId",
        u.email_normalized as "actorEmail",
        a.command as "command",
        a.entity_type as "entityType",
        a.entity_id as "entityId",
        a.from_state as "fromState",
        a.to_state as "toState",
        a.reason_code as "reasonCode",
        a.request_id as "requestId",
        a.entity_version::text as "entityVersion",
        a.metadata as "metadata"
      from audit_events a
      left join users u on u.id = a.actor_user_id
      where true ${entityClause} ${commandClause} ${actorClause} ${fromClause} ${toClause} ${keysetClause}
      order by a.occurred_at desc, a.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },
})
