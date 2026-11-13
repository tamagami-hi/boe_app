import { sql, type RawBuilder } from "kysely"

import type { Transaction } from "../db/repositories.js"
import { cursorTime, keysetCondition, type KeysetBoundary, type WithCursor } from "./keysetBoundary.js"

export interface AuditTrailRow {
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
  readonly requestId: string
  readonly clientUserId: string | null
  readonly clientName: string | null
  readonly amountPaise: string | null
  readonly fundId: string | null
  readonly orderId: string | null
  readonly ledgerEntryId: string | null
}

export interface AuditLogFilter {
  readonly commands: readonly string[] | null
  readonly entityType: string | null
  readonly command: string | null
  readonly occurredFrom: Date | null
  readonly occurredBefore: Date | null
}

export type AuditTrailScope =
  | Readonly<{ kind: "log"; filter: AuditLogFilter }>
  | Readonly<{ kind: "user"; userId: string }>

export interface AuditTrailQuery extends KeysetBoundary {
  readonly scope: AuditTrailScope
  readonly limit: number
}

export interface AuditTrailRepository {
  listAuditTrail: (tx: Transaction, query: AuditTrailQuery) => Promise<readonly WithCursor<AuditTrailRow>[]>
  userExists: (tx: Transaction, userId: string) => Promise<boolean>
}

const UUID_TEXT = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
const PAISE_TEXT = "^-?(0|[1-9][0-9]{0,17})$"
const AMOUNT_KEYS = ["amountPaise", "valueDeltaPaise", "totalDeltaPaise", "currentValuePaise"] as const

const metadataText = (key: string): RawBuilder<unknown> => sql`(a.metadata->>${sql.lit(key)})`

const metadataUuid = (key: string): RawBuilder<unknown> =>
  sql`case when ${metadataText(key)} ~ ${UUID_TEXT} then ${metadataText(key)}::uuid end`

const metadataPaise = (key: string): RawBuilder<unknown> =>
  sql`case when ${metadataText(key)} ~ ${PAISE_TEXT} then ${metadataText(key)} end`

const logClause = (filter: AuditLogFilter): RawBuilder<unknown> => sql`
  true
  ${filter.commands === null ? sql`` : sql`and a.command = any(${[...filter.commands]}::text[])`}
  ${filter.entityType === null ? sql`` : sql`and a.entity_type = ${filter.entityType}`}
  ${filter.command === null ? sql`` : sql`and a.command = ${filter.command}`}
  ${filter.occurredFrom === null ? sql`` : sql`and a.occurred_at >= ${filter.occurredFrom}`}
  ${filter.occurredBefore === null ? sql`` : sql`and a.occurred_at < ${filter.occurredBefore}`}
`

const KEYSET_COLUMNS = { time: "a.occurred_at", id: "a.id" } as const

const logPage = (filter: AuditLogFilter, query: AuditTrailQuery): RawBuilder<unknown> => sql`
  select a.*
  from audit_events a
  where ${logClause(filter)}
    and ${keysetCondition(KEYSET_COLUMNS, "before", query)}
  order by a.occurred_at desc, a.id desc
  limit ${query.limit}
`

const userBranch = (match: RawBuilder<unknown>, query: AuditTrailQuery): RawBuilder<unknown> => sql`
  (
    select a.id, a.occurred_at
    from audit_events a
    where ${match}
      and ${keysetCondition(KEYSET_COLUMNS, "before", query)}
    order by a.occurred_at desc, a.id desc
    limit ${query.limit}
  )
`

const userMatches = (userId: string): readonly RawBuilder<unknown>[] => [
  sql`a.entity_type = 'user' and a.entity_id = ${userId}::uuid`,
  sql`a.actor_user_id = ${userId}::uuid`,
  sql`a.metadata ? 'userId' and ${metadataText("userId")} = ${userId}`,
  sql`a.entity_type = 'refund_operation' and a.entity_id in (
    select r.id from refund_operations r
    join investment_orders o on o.id = r.order_id
    where o.user_id = ${userId}::uuid
  )`,
  sql`a.entity_type = 'client_growth_batch' and a.entity_id in (
    select e.growth_batch_id from client_value_entries e
    where e.user_id = ${userId}::uuid and e.growth_batch_id is not null
  )`,
]

const userPage = (userId: string, query: AuditTrailQuery): RawBuilder<unknown> => sql`
  select a.*
  from (${sql.join(
    userMatches(userId).map((match) => userBranch(match, query)),
    sql` union `,
  )}) candidate
  join audit_events a on a.id = candidate.id
  order by a.occurred_at desc, a.id desc
  limit ${query.limit}
`

const pageOf = (query: AuditTrailQuery): RawBuilder<unknown> =>
  query.scope.kind === "log" ? logPage(query.scope.filter, query) : userPage(query.scope.userId, query)

export const createAuditTrailRepository = (): AuditTrailRepository => ({
  listAuditTrail: async (tx, query) => {
    const scopeUserId = query.scope.kind === "user" ? query.scope.userId : null
    const result = await sql<WithCursor<AuditTrailRow>>`
      with page as (${pageOf(query)})
      select
        a.id,
        a.occurred_at as "occurredAt",
        ${cursorTime("a.occurred_at")} as "cursorAt",
        a.actor_type::text as "actorType",
        a.actor_user_id as "actorUserId",
        case when actor.pii_tombstoned_at is null then actor.email_normalized end as "actorEmail",
        a.command,
        a.entity_type as "entityType",
        a.entity_id as "entityId",
        a.from_state as "fromState",
        a.to_state as "toState",
        a.request_id::text as "requestId",
        subject.user_id as "clientUserId",
        case when client.id is null then null
             when client.pii_tombstoned_at is null then client.full_name
             else 'Tombstoned' end as "clientName",
        subject.amount_paise as "amountPaise",
        subject.fund_id as "fundId",
        subject.order_id as "orderId",
        subject.ledger_entry_id as "ledgerEntryId"
      from page a
      left join users actor on actor.id = a.actor_user_id
      left join refund_operations ro on a.entity_type = 'refund_operation' and ro.id = a.entity_id
      left join investment_orders ro_order on ro_order.id = ro.order_id
      left join withdrawal_operations wo on a.entity_type = 'withdrawal_operation' and wo.id = a.entity_id
      left join lateral (
        select e.id, e.user_id, e.fund_id, e.value_delta_paise::text as delta
        from client_value_entries e
        where a.entity_type = 'client_growth_batch'
          and e.growth_batch_id = a.entity_id
          and e.entry_type = 'growth_adjustment'
          and e.user_id = coalesce(${scopeUserId}::uuid, ${metadataUuid("userId")})
        order by e.created_at asc, e.id asc
        limit 1
      ) member on true
      cross join lateral (
        select
          coalesce(
            case when a.entity_type = 'user' then a.entity_id end,
            ${metadataUuid("userId")},
            ro_order.user_id,
            wo.user_id,
            member.user_id
          ) as user_id,
          coalesce(
            member.delta,
            ro.amount_paise::text,
            wo.amount_paise::text,
            ${sql.join(AMOUNT_KEYS.map(metadataPaise))}
          ) as amount_paise,
          coalesce(${metadataUuid("fundId")}, wo.fund_id, ro_order.fund_id, member.fund_id) as fund_id,
          coalesce(${metadataUuid("orderId")}, ro.order_id) as order_id,
          coalesce(
            case when a.entity_type = 'client_value_entry' then a.entity_id end,
            ${metadataUuid("entryId")},
            wo.ledger_entry_id,
            member.id
          ) as ledger_entry_id
      ) subject
      left join users client on client.id = subject.user_id
      order by a.occurred_at desc, a.id desc
    `.execute(tx)
    return result.rows
  },

  userExists: async (tx, userId) => {
    const result = await sql<{ readonly id: string }>`select u.id from users u where u.id = ${userId}::uuid`.execute(tx)
    return result.rows.length > 0
  },
})
