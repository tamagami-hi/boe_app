import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ClientMaturityResolution, ClientMaturityScheduleState } from "../db/types.js"
import { cursorTime, keysetCondition, type KeysetBoundary, type WithCursor } from "./keysetBoundary.js"

export interface MaturityScheduleRow {
  readonly id: string
  readonly userId: string
  readonly clientName: string
  readonly fundId: string
  readonly fundName: string
  readonly maturityDate: string
  readonly state: ClientMaturityScheduleState
  readonly resolution: ClientMaturityResolution | null
  readonly maturityId: string | null
  readonly followUpSipScheduleId: string | null
  readonly version: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly resolvedAt: Date | null
  readonly cancelledAt: Date | null
}

export interface LockedMaturitySchedule {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly maturityDate: string
  readonly state: ClientMaturityScheduleState
  readonly version: string
  readonly createdAt: Date
}

export interface InsertMaturityScheduleInput {
  readonly userId: string
  readonly fundId: string
  readonly maturityDate: string
  readonly actorUserId: string
  readonly requestId: string
}

interface VersionedChange {
  readonly scheduleId: string
  readonly expectedVersion: string
  readonly actorUserId: string
  readonly now: Date
}

export interface ResolveMaturityScheduleInput extends VersionedChange {
  readonly resolution: ClientMaturityResolution
  readonly maturityId: string | null
  readonly followUpSipScheduleId: string | null
}

export interface MaturityDashboardQuery extends KeysetBoundary {
  readonly state: ClientMaturityScheduleState
  readonly limit: number
}

export interface ClientMaturityScheduleRepository {
  insert: (tx: Transaction, input: InsertMaturityScheduleInput) => Promise<{ readonly id: string }>
  hasOpen: (tx: Transaction, input: Readonly<{ userId: string; fundId: string }>) => Promise<boolean>
  findOwner: (tx: Transaction, scheduleId: string) => Promise<Readonly<{ userId: string; fundId: string }> | null>
  lockById: (tx: Transaction, scheduleId: string) => Promise<LockedMaturitySchedule | null>
  findSettledMaturitySince: (
    tx: Transaction,
    input: Readonly<{ userId: string; fundId: string; since: Date }>,
  ) => Promise<Readonly<{ settledOn: string }> | null>
  changeDate: (tx: Transaction, input: VersionedChange & Readonly<{ maturityDate: string }>) => Promise<boolean>
  cancel: (tx: Transaction, input: VersionedChange) => Promise<boolean>
  resolve: (tx: Transaction, input: ResolveMaturityScheduleInput) => Promise<boolean>
  findForUser: (tx: Transaction, input: Readonly<{ userId: string; scheduleId: string }>) => Promise<MaturityScheduleRow | null>
  listByUser: (tx: Transaction, userId: string) => Promise<readonly MaturityScheduleRow[]>
  listDashboard: (tx: Transaction, query: MaturityDashboardQuery) => Promise<readonly WithCursor<MaturityScheduleRow>[]>
  listDue: (tx: Transaction, input: Readonly<{ dueThrough: string; limit: number }>) => Promise<readonly MaturityScheduleRow[]>
  countDue: (tx: Transaction, dueThrough: string) => Promise<number>
}

const SCHEDULE_COLUMNS = sql`
  s.id,
  s.user_id as "userId",
  u.full_name as "clientName",
  s.fund_id as "fundId",
  coalesce(fv.name, f.slug) as "fundName",
  to_char(s.maturity_date, 'YYYY-MM-DD') as "maturityDate",
  s.state,
  s.resolution,
  s.maturity_id as "maturityId",
  s.follow_up_sip_schedule_id as "followUpSipScheduleId",
  s.version::text as version,
  s.created_at as "createdAt",
  s.updated_at as "updatedAt",
  s.resolved_at as "resolvedAt",
  s.cancelled_at as "cancelledAt"
`

const SCHEDULE_SOURCE = sql`
  from client_maturity_schedules s
  join users u on u.id = s.user_id
  join funds f on f.id = s.fund_id
  left join fund_versions fv on fv.id = f.current_published_version_id
`

const applied = (result: { readonly numAffectedRows?: bigint }): boolean => result.numAffectedRows === 1n

export const createClientMaturityScheduleRepository = (): ClientMaturityScheduleRepository => ({
  insert: async (tx, input) =>
    tx
      .insertInto("client_maturity_schedules")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        maturity_date: input.maturityDate,
        created_by_user_id: input.actorUserId,
        updated_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  hasOpen: async (tx, input) => {
    const result = await sql<{ readonly found: boolean }>`
      select exists (
        select 1 from client_maturity_schedules
        where user_id = ${input.userId} and fund_id = ${input.fundId} and state = 'scheduled'
      ) as found
    `.execute(tx)
    return result.rows[0]?.found === true
  },

  findOwner: async (tx, scheduleId) =>
    (await tx
      .selectFrom("client_maturity_schedules")
      .select(["user_id as userId", "fund_id as fundId"])
      .where("id", "=", scheduleId)
      .executeTakeFirst()) ?? null,

  lockById: async (tx, scheduleId) => {
    const result = await sql<LockedMaturitySchedule>`
      select
        id,
        user_id as "userId",
        fund_id as "fundId",
        to_char(maturity_date, 'YYYY-MM-DD') as "maturityDate",
        state,
        version::text as version,
        created_at as "createdAt"
      from client_maturity_schedules
      where id = ${scheduleId}
      for update
    `.execute(tx)
    return result.rows[0] ?? null
  },

  findSettledMaturitySince: async (tx, input) => {
    const result = await sql<{ readonly settledOn: string }>`
      select to_char(settled_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as "settledOn"
      from client_position_maturities
      where user_id = ${input.userId}
        and fund_id = ${input.fundId}
        and state = 'settled'
        and settled_at >= ${input.since}
      order by settled_at desc
      limit 1
    `.execute(tx)
    return result.rows[0] ?? null
  },

  changeDate: async (tx, input) =>
    applied(
      await sql`
        update client_maturity_schedules
        set maturity_date = ${input.maturityDate}::date,
            updated_by_user_id = ${input.actorUserId},
            updated_at = ${input.now},
            version = version + 1
        where id = ${input.scheduleId} and version = ${input.expectedVersion} and state = 'scheduled'
      `.execute(tx),
    ),

  cancel: async (tx, input) =>
    applied(
      await sql`
        update client_maturity_schedules
        set state = 'cancelled',
            cancelled_at = ${input.now},
            updated_by_user_id = ${input.actorUserId},
            updated_at = ${input.now},
            version = version + 1
        where id = ${input.scheduleId} and version = ${input.expectedVersion} and state = 'scheduled'
      `.execute(tx),
    ),

  resolve: async (tx, input) =>
    applied(
      await sql`
        update client_maturity_schedules
        set state = 'resolved',
            resolution = ${input.resolution},
            maturity_id = ${input.maturityId},
            follow_up_sip_schedule_id = ${input.followUpSipScheduleId},
            resolved_at = ${input.now},
            updated_by_user_id = ${input.actorUserId},
            updated_at = ${input.now},
            version = version + 1
        where id = ${input.scheduleId} and version = ${input.expectedVersion} and state = 'scheduled'
      `.execute(tx),
    ),

  findForUser: async (tx, input) => {
    const result = await sql<MaturityScheduleRow>`
      select ${SCHEDULE_COLUMNS} ${SCHEDULE_SOURCE}
      where s.id = ${input.scheduleId} and s.user_id = ${input.userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listByUser: async (tx, userId) => {
    const result = await sql<MaturityScheduleRow>`
      select ${SCHEDULE_COLUMNS} ${SCHEDULE_SOURCE}
      where s.user_id = ${userId}
      order by (s.state = 'scheduled') desc, s.maturity_date, s.id
    `.execute(tx)
    return result.rows
  },

  listDashboard: async (tx, query) => {
    const result = await sql<WithCursor<MaturityScheduleRow>>`
      select q.*, ${cursorTime("q.maturityAt")} as "cursorAt"
      from (
        select ${SCHEDULE_COLUMNS}, (s.maturity_date::timestamp at time zone 'UTC') as "maturityAt"
        ${SCHEDULE_SOURCE}
        where s.state = ${query.state}
      ) q
      where ${keysetCondition({ time: "q.maturityAt", id: "q.id" }, "after", query)}
      order by q."maturityAt", q.id
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  listDue: async (tx, input) => {
    const result = await sql<MaturityScheduleRow>`
      select ${SCHEDULE_COLUMNS} ${SCHEDULE_SOURCE}
      where s.state = 'scheduled' and s.maturity_date <= ${input.dueThrough}::date
      order by s.maturity_date, s.id
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  countDue: async (tx, dueThrough) => {
    const result = await sql<{ readonly total: number }>`
      select count(*)::int as total
      from client_maturity_schedules
      where state = 'scheduled' and maturity_date <= ${dueThrough}::date
    `.execute(tx)
    return result.rows[0]?.total ?? 0
  },
})
