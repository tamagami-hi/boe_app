import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { AdminSipScheduleState } from "../db/types.js"

export interface AdminSipScheduleRow {
  readonly id: string
  readonly userId: string
  readonly clientName: string
  readonly fundId: string
  readonly fundName: string
  readonly monthlyAmountPaise: string
  readonly startMonth: string
  readonly monthCount: number
  readonly state: AdminSipScheduleState
  readonly version: string
  readonly paidMonths: readonly string[]
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly closedAt: Date | null
}

export interface LockedSipSchedule {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly startMonth: string
  readonly monthCount: number
  readonly monthlyAmountPaise: string
  readonly state: AdminSipScheduleState
  readonly version: string
}

export interface LiveSipMonthLink {
  readonly id: string
  readonly entryId: string
}

export interface ReleasedSipMonthLink {
  readonly id: string
  readonly scheduleId: string
  readonly userId: string
  readonly fundId: string
  readonly month: string
  readonly scheduleVersion: string
}

export interface InsertSipScheduleInput {
  readonly userId: string
  readonly fundId: string
  readonly monthlyAmountPaise: bigint
  readonly startMonth: string
  readonly monthCount: number
  readonly actorUserId: string
  readonly requestId: string
}

export interface UpdateSipScheduleInput {
  readonly scheduleId: string
  readonly expectedVersion: string
  readonly monthlyAmountPaise: bigint
  readonly monthCount: number
  readonly state: AdminSipScheduleState
  readonly actorUserId: string
  readonly now: Date
}

export interface InsertSipMonthLinkInput {
  readonly scheduleId: string
  readonly userId: string
  readonly fundId: string
  readonly month: string
  readonly entryId: string
  readonly actorUserId: string
  readonly requestId: string
}

export interface AdminSipScheduleRepository {
  findForUser: (tx: Transaction, input: Readonly<{ userId: string; scheduleId: string }>) => Promise<AdminSipScheduleRow | null>
  listByUser: (tx: Transaction, userId: string) => Promise<readonly AdminSipScheduleRow[]>
  listByFund: (
    tx: Transaction,
    input: Readonly<{ fundId: string; state: AdminSipScheduleState | null; afterScheduleId: string | null; limit: number }>,
  ) => Promise<readonly AdminSipScheduleRow[]>
  findOwner: (
    tx: Transaction,
    scheduleId: string,
  ) => Promise<Readonly<{ userId: string; fundId: string }> | null>
  lockById: (tx: Transaction, scheduleId: string) => Promise<LockedSipSchedule | null>
  hasOtherActive: (
    tx: Transaction,
    input: Readonly<{ userId: string; fundId: string; exceptScheduleId: string | null }>,
  ) => Promise<boolean>
  findPublishedFund: (tx: Transaction, fundId: string) => Promise<{ readonly id: string } | null>
  insert: (tx: Transaction, input: InsertSipScheduleInput) => Promise<{ readonly id: string }>
  update: (tx: Transaction, input: UpdateSipScheduleInput) => Promise<boolean>
  latestLinkedMonth: (tx: Transaction, scheduleId: string) => Promise<string | null>
  findLiveLink: (tx: Transaction, input: Readonly<{ scheduleId: string; month: string }>) => Promise<LiveSipMonthLink | null>
  releaseLinkForEntry: (tx: Transaction, entryId: string) => Promise<ReleasedSipMonthLink | null>
  insertLink: (tx: Transaction, input: InsertSipMonthLinkInput) => Promise<{ readonly id: string }>
}

const SCHEDULE_SELECTION = sql`
  select
    s.id,
    s.user_id as "userId",
    u.full_name as "clientName",
    s.fund_id as "fundId",
    coalesce(fv.name, f.slug) as "fundName",
    s.monthly_amount_paise::text as "monthlyAmountPaise",
    to_char(s.start_month, 'YYYY-MM') as "startMonth",
    s.month_count as "monthCount",
    s.state,
    s.version::text as version,
    coalesce(paid.months, array[]::text[]) as "paidMonths",
    s.created_at as "createdAt",
    s.updated_at as "updatedAt",
    s.closed_at as "closedAt"
  from admin_sip_schedules s
  join users u on u.id = s.user_id
  join funds f on f.id = s.fund_id
  left join fund_versions fv on fv.id = f.current_published_version_id
  left join lateral (
    select array_agg(to_char(m.sip_month, 'YYYY-MM') order by m.sip_month) as months
    from admin_sip_schedule_months m
    where m.schedule_id = s.id and m.released_at is null
  ) paid on true
`

export const createAdminSipScheduleRepository = (): AdminSipScheduleRepository => ({
  findForUser: async (tx, input) => {
    const result = await sql<AdminSipScheduleRow>`
      ${SCHEDULE_SELECTION}
      where s.id = ${input.scheduleId} and s.user_id = ${input.userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listByUser: async (tx, userId) => {
    const result = await sql<AdminSipScheduleRow>`
      ${SCHEDULE_SELECTION}
      where s.user_id = ${userId}
      order by (s.state = 'active') desc, s.created_at desc, s.id desc
    `.execute(tx)
    return result.rows
  },

  listByFund: async (tx, input) => {
    const result = await sql<AdminSipScheduleRow>`
      ${SCHEDULE_SELECTION}
      where s.fund_id = ${input.fundId}
        and (${input.state}::text is null or s.state = ${input.state})
        and (
          ${input.afterScheduleId}::uuid is null
          or (u.full_name, s.id) > (
            select ua.full_name, sa.id
            from admin_sip_schedules sa
            join users ua on ua.id = sa.user_id
            where sa.id = ${input.afterScheduleId}::uuid
          )
        )
      order by u.full_name, s.id
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  findOwner: async (tx, scheduleId) =>
    (await tx
      .selectFrom("admin_sip_schedules")
      .select(["user_id as userId", "fund_id as fundId"])
      .where("id", "=", scheduleId)
      .executeTakeFirst()) ?? null,

  lockById: async (tx, scheduleId) => {
    const result = await sql<LockedSipSchedule>`
      select
        id,
        user_id as "userId",
        fund_id as "fundId",
        to_char(start_month, 'YYYY-MM') as "startMonth",
        month_count as "monthCount",
        monthly_amount_paise::text as "monthlyAmountPaise",
        state,
        version::text as version
      from admin_sip_schedules
      where id = ${scheduleId}
      for update
    `.execute(tx)
    return result.rows[0] ?? null
  },

  hasOtherActive: async (tx, input) => {
    const result = await sql<{ readonly found: boolean }>`
      select exists (
        select 1 from admin_sip_schedules
        where user_id = ${input.userId}
          and fund_id = ${input.fundId}
          and state = 'active'
          and (${input.exceptScheduleId}::uuid is null or id <> ${input.exceptScheduleId}::uuid)
      ) as found
    `.execute(tx)
    return result.rows[0]?.found === true
  },

  findPublishedFund: async (tx, fundId) =>
    (await tx
      .selectFrom("funds")
      .select("id")
      .where("id", "=", fundId)
      .where("current_published_version_id", "is not", null)
      .executeTakeFirst()) ?? null,

  insert: async (tx, input) =>
    tx
      .insertInto("admin_sip_schedules")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        monthly_amount_paise: input.monthlyAmountPaise,
        start_month: `${input.startMonth}-01`,
        month_count: input.monthCount,
        created_by_user_id: input.actorUserId,
        updated_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  update: async (tx, input) => {
    const result = await sql`
      update admin_sip_schedules
      set monthly_amount_paise = ${input.monthlyAmountPaise},
          month_count = ${input.monthCount},
          state = ${input.state},
          closed_at = case when ${input.state} = 'closed' then coalesce(closed_at, ${input.now}) else null end,
          updated_by_user_id = ${input.actorUserId},
          updated_at = ${input.now},
          version = version + 1
      where id = ${input.scheduleId} and version = ${input.expectedVersion}
    `.execute(tx)
    return result.numAffectedRows === 1n
  },

  latestLinkedMonth: async (tx, scheduleId) => {
    const result = await sql<{ readonly month: string | null }>`
      select to_char(max(sip_month), 'YYYY-MM') as month
      from admin_sip_schedule_months
      where schedule_id = ${scheduleId} and released_at is null
    `.execute(tx)
    return result.rows[0]?.month ?? null
  },

  findLiveLink: async (tx, input) => {
    const result = await sql<LiveSipMonthLink>`
      select m.id, m.entry_id as "entryId"
      from admin_sip_schedule_months m
      where m.schedule_id = ${input.scheduleId}
        and m.sip_month = ${`${input.month}-01`}::date
        and m.released_at is null
    `.execute(tx)
    return result.rows[0] ?? null
  },

  releaseLinkForEntry: async (tx, entryId) => {
    const result = await sql<ReleasedSipMonthLink>`
      update admin_sip_schedule_months
      set released_at = now()
      where entry_id = ${entryId} and released_at is null
      returning id, schedule_id as "scheduleId", user_id as "userId", fund_id as "fundId",
        to_char(sip_month, 'YYYY-MM') as month,
        (select s.version::text from admin_sip_schedules s where s.id = admin_sip_schedule_months.schedule_id) as "scheduleVersion"
    `.execute(tx)
    return result.rows[0] ?? null
  },

  insertLink: async (tx, input) =>
    tx
      .insertInto("admin_sip_schedule_months")
      .values({
        schedule_id: input.scheduleId,
        user_id: input.userId,
        fund_id: input.fundId,
        sip_month: `${input.month}-01`,
        entry_id: input.entryId,
        created_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
})
