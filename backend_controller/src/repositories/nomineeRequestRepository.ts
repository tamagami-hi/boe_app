import { sql, type RawBuilder } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { NomineeRequestState } from "../db/types.js"
import { cursorTime, keysetCondition, type KeysetBoundary, type WithCursor } from "./keysetBoundary.js"
import type { Nominee } from "./userNomineeRepository.js"

export type ClosedNomineeRequestState = Exclude<NomineeRequestState, "pending">

export interface NomineeRequestRow {
  readonly id: string
  readonly userId: string
  readonly nomineeName: string
  readonly nomineeRelation: string
  readonly state: NomineeRequestState
  readonly declineReason: string | null
  readonly decidedAt: Date | null
  readonly createdAt: Date
  readonly version: string
}

export interface AdminNomineeRequestRow extends NomineeRequestRow {
  readonly clientName: string
  readonly decidedByName: string | null
}

export type AdminNomineeRequestPageRow = WithCursor<AdminNomineeRequestRow>

export type QueuedNomineeRequestRow = AdminNomineeRequestPageRow & Readonly<{ queueRank: string }>

export interface QueuePosition {
  readonly afterRank?: string
  readonly afterCreatedAt?: string
  readonly afterId?: string
}

export interface NomineeRequestClosure {
  readonly requestId: string
  readonly expectedVersion: number
  readonly state: ClosedNomineeRequestState
  readonly declineReason: string | null
  readonly decidedByUserId: string | null
  readonly now: Date
}

export interface PendingNomineeRequestSummary {
  readonly pendingCount: number
  readonly oldestPendingAt: Date | null
}

export interface NomineeRequestRepository {
  findLatestForUser: (tx: Transaction, userId: string) => Promise<NomineeRequestRow | null>
  findPendingForUser: (tx: Transaction, userId: string) => Promise<NomineeRequestRow | null>
  insertPending: (tx: Transaction, input: Readonly<{ userId: string; nominee: Nominee; now: Date }>) => Promise<NomineeRequestRow | null>
  find: (tx: Transaction, requestId: string) => Promise<NomineeRequestRow | null>
  lock: (tx: Transaction, requestId: string) => Promise<NomineeRequestRow | null>
  close: (tx: Transaction, input: NomineeRequestClosure) => Promise<NomineeRequestRow | null>
  findForAdmin: (tx: Transaction, requestId: string) => Promise<AdminNomineeRequestRow | null>
  listQueue: (
    tx: Transaction,
    input: QueuePosition & Readonly<{ state?: NomineeRequestState; limit: number }>,
  ) => Promise<readonly QueuedNomineeRequestRow[]>
  listForUser: (
    tx: Transaction,
    input: KeysetBoundary & Readonly<{ userId: string; limit: number }>,
  ) => Promise<readonly AdminNomineeRequestPageRow[]>
  summarizePending: (tx: Transaction) => Promise<PendingNomineeRequestSummary>
  userExists: (tx: Transaction, userId: string) => Promise<boolean>
}

const REQUEST_COLUMNS = sql`
  r.id,
  r.user_id as "userId",
  r.nominee_name as "nomineeName",
  r.nominee_relation as "nomineeRelation",
  r.state,
  r.decline_reason as "declineReason",
  r.decided_at as "decidedAt",
  r.created_at as "createdAt",
  r.version::text as "version"
`

const ADMIN_COLUMNS = sql`
  ${REQUEST_COLUMNS},
  u.full_name as "clientName",
  d.full_name as "decidedByName",
  ${cursorTime("r.created_at")} as "cursorAt"
`

const ADMIN_SOURCE = sql`
  from client_nominee_requests r
  join users u on u.id = r.user_id
  left join users d on d.id = r.decided_by_user_id
`

const QUEUE_RANK = sql`(case when r.state = 'pending' then 0 else 1 end)`

const NEWEST_FIRST = { time: "r.created_at", id: "r.id" } as const

const queueCondition = (input: QueuePosition): RawBuilder<boolean> => {
  const { afterRank, afterCreatedAt, afterId } = input
  if (afterRank === undefined || afterCreatedAt === undefined || afterId === undefined) return sql<boolean>`true`
  const rank = Number(afterRank)
  return sql<boolean>`(
    ${QUEUE_RANK} > ${rank}
    or (${QUEUE_RANK} = ${rank} and ${keysetCondition(NEWEST_FIRST, "before", { afterCreatedAt, afterId })})
  )`
}

const first = async <Row>(query: Promise<{ readonly rows: readonly Row[] }>): Promise<Row | null> =>
  (await query).rows[0] ?? null

export const createNomineeRequestRepository = (): NomineeRequestRepository => ({
  findLatestForUser: (tx, userId) =>
    first(
      sql<NomineeRequestRow>`
        select ${REQUEST_COLUMNS} from client_nominee_requests r
        where r.user_id = ${userId}
        order by r.created_at desc, r.id desc
        limit 1
      `.execute(tx),
    ),

  findPendingForUser: (tx, userId) =>
    first(
      sql<NomineeRequestRow>`
        select ${REQUEST_COLUMNS} from client_nominee_requests r
        where r.user_id = ${userId} and r.state = 'pending'
      `.execute(tx),
    ),

  insertPending: (tx, input) =>
    first(
      sql<NomineeRequestRow>`
        insert into client_nominee_requests as r (user_id, nominee_name, nominee_relation, created_at, updated_at)
        values (${input.userId}, ${input.nominee.name}, ${input.nominee.relation}, ${input.now}::timestamptz, ${input.now}::timestamptz)
        on conflict (user_id) where state = 'pending' do nothing
        returning ${REQUEST_COLUMNS}
      `.execute(tx),
    ),

  find: (tx, requestId) =>
    first(sql<NomineeRequestRow>`select ${REQUEST_COLUMNS} from client_nominee_requests r where r.id = ${requestId}`.execute(tx)),

  lock: (tx, requestId) =>
    first(
      sql<NomineeRequestRow>`
        select ${REQUEST_COLUMNS} from client_nominee_requests r where r.id = ${requestId} for update of r
      `.execute(tx),
    ),

  close: (tx, input) =>
    first(
      sql<NomineeRequestRow>`
        update client_nominee_requests r
        set state = ${input.state},
            decline_reason = ${input.declineReason},
            decided_by_user_id = ${input.decidedByUserId},
            decided_at = ${input.now}::timestamptz,
            updated_at = ${input.now}::timestamptz,
            version = r.version + 1
        where r.id = ${input.requestId}
          and r.state = 'pending'
          and r.version = ${String(input.expectedVersion)}::bigint
        returning ${REQUEST_COLUMNS}
      `.execute(tx),
    ),

  findForAdmin: (tx, requestId) =>
    first(sql<AdminNomineeRequestRow>`select ${ADMIN_COLUMNS} ${ADMIN_SOURCE} where r.id = ${requestId}`.execute(tx)),

  listQueue: async (tx, input) => {
    const stateClause = input.state === undefined ? sql`` : sql`and r.state = ${input.state}`
    const result = await sql<QueuedNomineeRequestRow>`
      select ${ADMIN_COLUMNS}, ${QUEUE_RANK}::text as "queueRank"
      ${ADMIN_SOURCE}
      where ${queueCondition(input)} ${stateClause}
      order by ${QUEUE_RANK} asc, r.created_at desc, r.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  listForUser: async (tx, input) => {
    const result = await sql<AdminNomineeRequestPageRow>`
      select ${ADMIN_COLUMNS}
      ${ADMIN_SOURCE}
      where r.user_id = ${input.userId} and ${keysetCondition(NEWEST_FIRST, "before", input)}
      order by r.created_at desc, r.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  summarizePending: async (tx) => {
    const row = await first(
      sql<{ readonly pendingCount: number; readonly oldestPendingAt: Date | null }>`
        select count(*)::int as "pendingCount", min(created_at) as "oldestPendingAt"
        from client_nominee_requests where state = 'pending'
      `.execute(tx),
    )
    return { pendingCount: row?.pendingCount ?? 0, oldestPendingAt: row?.oldestPendingAt ?? null }
  },

  userExists: async (tx, userId) =>
    (await sql<{ readonly id: string }>`select id from users where id = ${userId}`.execute(tx)).rows.length > 0,
})
