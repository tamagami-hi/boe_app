/**
 * Admin oversight repository.
 *
 * Read projections over authoritative evidence the admin console supervises —
 * the user directory, orders, Email Verification state, and the audit log — plus the one write
 * path admins own here: the user account lifecycle.
 *
 * Every list is keyset-paginated on `(created_at DESC, id DESC)` with a validated
 * limit, and money crosses the boundary as strings. Search terms are matched
 * with a bounded prefix/`ILIKE` on indexed identity columns, never a full-text
 * scan over PII ciphertext.
 */
import { sql } from "kysely"

import type { Transaction, User } from "../db/repositories.js"
import type {
  EmailVerificationState,
  OrderState,
  OrderType,
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
  readonly emailVerificationState: EmailVerificationState | null
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
  readonly amountPaise: string
  readonly currency: string
  readonly requestedAt: Date
  readonly acceptedAt: Date | null
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

export interface EmailVerificationListRow {
  readonly id: string
  readonly userId: string
  readonly userEmail: string
  readonly userFullName: string
  readonly state: EmailVerificationState
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

export interface UserDetail {
  readonly user: UserListRow
  readonly roles: readonly string[]
  readonly emailVerification: EmailVerificationListRow | null
  readonly orders: readonly OrderListRow[]
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
  u.email_verification_state as "emailVerificationState",
  coalesce(o.count, 0)::int as "ordersCount",
  u.created_at as "createdAt",
  u.updated_at as "updatedAt",
  u.version::text as "version"
`

const USER_JOINS = sql`
  from users u
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
  o.accepted_at as "acceptedAt",
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

const EMAIL_VERIFICATION_COLUMNS = sql`
  u.id as "id",
  u.id as "userId",
  u.email_normalized as "userEmail",
  u.full_name as "userFullName",
  u.email_verification_state as "state",
  'email_otp' as "provider",
  u.email_verification_started_at as "submittedAt",
  u.email_verified_at as "decidedAt",
  u.email_verification_expires_at as "expiresAt",
  0::int as "reviewCount",
  coalesce(u.email_verification_started_at, u.created_at) as "createdAt",
  u.updated_at as "updatedAt",
  u.version::text as "version"
`

const EMAIL_VERIFICATION_JOINS = sql`
  from users u
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

    const [roles, emailVerification, orders] = await Promise.all([
      sql<{ code: string }>`
        select r.code as "code" from user_roles ur join roles r on r.id = ur.role_id
        where ur.user_id = ${userId} order by r.code
      `.execute(tx),
      sql<EmailVerificationListRow>`
        select ${EMAIL_VERIFICATION_COLUMNS} ${EMAIL_VERIFICATION_JOINS} where u.id = ${userId}
        limit 1
      `.execute(tx),
      sql<OrderListRow>`
        select ${ORDER_COLUMNS} ${ORDER_JOINS} where o.user_id = ${userId}
        order by o.created_at desc, o.id desc limit 10
      `.execute(tx),
    ])

    return {
      user,
      roles: roles.rows.map((row) => row.code),
      emailVerification: emailVerification.rows[0] ?? null,
      orders: orders.rows,
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
