import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { SupportRequestState } from "../db/types.js"

export interface SupportTicketRow {
  readonly id: string
  readonly userId: string
  readonly clientName: string
  readonly reference: string
  readonly category: string
  readonly subject: string
  readonly state: SupportRequestState
  readonly resolvedAt: Date | null
  readonly createdAt: Date
  readonly cursorKey: string
  readonly updatedAt: Date
  readonly version: string
}

export interface SupportTicketDetailRow extends SupportTicketRow {
  readonly body: string
  readonly resolutionNote: string | null
  readonly closedAt: Date | null
}

export interface SupportTicketEventRow {
  readonly id: string
  readonly command: string
  readonly actorType: string
  readonly actorName: string | null
  readonly fromState: string | null
  readonly toState: string | null
  readonly metadata: unknown
  readonly occurredAt: Date
}

export interface SupportPagePosition {
  readonly afterKey?: string
  readonly afterId?: string
}

export interface SupportPageInput extends SupportPagePosition {
  readonly limit: number
}

export interface SupportResponseWrite {
  readonly ticketId: string
  readonly expectedVersion: number
  readonly state: SupportRequestState
  readonly resolutionNote: string
  readonly now: Date
}

export interface AdminSupportRepository {
  listQueue: (
    tx: Transaction,
    input: SupportPageInput & Readonly<{ state?: SupportRequestState }>,
  ) => Promise<readonly SupportTicketRow[]>
  listForUser: (
    tx: Transaction,
    input: SupportPageInput & Readonly<{ userId: string }>,
  ) => Promise<readonly SupportTicketRow[]>
  userExists: (tx: Transaction, userId: string) => Promise<boolean>
  findTicket: (tx: Transaction, ticketId: string) => Promise<SupportTicketDetailRow | null>
  lockTicket: (tx: Transaction, ticketId: string) => Promise<SupportTicketDetailRow | null>
  listEvents: (tx: Transaction, ticketId: string) => Promise<readonly SupportTicketEventRow[]>
  applyResponse: (tx: Transaction, input: SupportResponseWrite) => Promise<boolean>
}

const MAX_HISTORY_EVENTS = 200

const TICKET_COLUMNS = sql`
  s.id,
  s.user_id as "userId",
  case when u.pii_tombstoned_at is null then u.full_name else 'Tombstoned' end as "clientName",
  s.reference,
  s.category,
  s.subject,
  s.state,
  s.resolved_at as "resolvedAt",
  s.created_at as "createdAt",
  to_char(s.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorKey",
  s.updated_at as "updatedAt",
  s.version::text as "version"
`

const DETAIL_COLUMNS = sql`
  ${TICKET_COLUMNS},
  s.body,
  s.resolution_note as "resolutionNote",
  s.closed_at as "closedAt"
`

const TICKET_SOURCE = sql`from support_requests s join users u on u.id = s.user_id`

const keysetClause = (input: SupportPagePosition, direction: "after" | "before") => {
  if (input.afterKey === undefined || input.afterId === undefined) return sql``
  const position = sql`(${input.afterKey}::timestamptz, ${input.afterId}::uuid)`
  return direction === "after" ? sql`and (s.created_at, s.id) > ${position}` : sql`and (s.created_at, s.id) < ${position}`
}

const findDetail = async (
  tx: Transaction,
  ticketId: string,
  lock: boolean,
): Promise<SupportTicketDetailRow | null> => {
  const result = await sql<SupportTicketDetailRow>`
    select ${DETAIL_COLUMNS}
    ${TICKET_SOURCE}
    where s.id = ${ticketId}
    ${lock ? sql`for update of s` : sql``}
  `.execute(tx)
  return result.rows[0] ?? null
}

export const createAdminSupportRepository = (): AdminSupportRepository => ({
  listQueue: async (tx, input) => {
    const stateClause = input.state === undefined ? sql`` : sql`and s.state = ${input.state}::support_request_state`
    const result = await sql<SupportTicketRow>`
      select ${TICKET_COLUMNS}
      ${TICKET_SOURCE}
      where true ${stateClause} ${keysetClause(input, "after")}
      order by s.created_at asc, s.id asc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  listForUser: async (tx, input) => {
    const result = await sql<SupportTicketRow>`
      select ${TICKET_COLUMNS}
      ${TICKET_SOURCE}
      where s.user_id = ${input.userId} ${keysetClause(input, "before")}
      order by s.created_at desc, s.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  userExists: async (tx, userId) => {
    const result = await sql<{ id: string }>`select id from users where id = ${userId}`.execute(tx)
    return result.rows.length > 0
  },

  findTicket: (tx, ticketId) => findDetail(tx, ticketId, false),

  lockTicket: (tx, ticketId) => findDetail(tx, ticketId, true),

  listEvents: async (tx, ticketId) => {
    const result = await sql<SupportTicketEventRow>`
      select
        a.id,
        a.command,
        a.actor_type as "actorType",
        case when u.id is null then null
             when u.pii_tombstoned_at is null then u.full_name
             else 'Tombstoned' end as "actorName",
        a.from_state as "fromState",
        a.to_state as "toState",
        a.metadata,
        a.occurred_at as "occurredAt"
      from audit_events a
      left join users u on u.id = a.actor_user_id
      where a.entity_type = 'support_request' and a.entity_id = ${ticketId}
      order by a.occurred_at asc, a.id asc
      limit ${MAX_HISTORY_EVENTS}
    `.execute(tx)
    return result.rows
  },

  applyResponse: async (tx, input) => {
    const result = await sql<{ id: string }>`
      update support_requests s
      set state = ${input.state}::support_request_state,
          resolution_note = ${input.resolutionNote},
          resolved_at = case when ${input.state}::support_request_state in ('resolved', 'closed')
                             then coalesce(s.resolved_at, ${input.now}::timestamptz) end,
          closed_at = case when ${input.state}::support_request_state = 'closed'
                           then coalesce(s.closed_at, ${input.now}::timestamptz) end,
          updated_at = ${input.now}::timestamptz,
          version = s.version + 1
      where s.id = ${input.ticketId} and s.version = ${String(input.expectedVersion)}::bigint
      returning s.id
    `.execute(tx)
    return result.rows.length === 1
  },
})
