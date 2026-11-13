import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface RecordingSheetRow {
  readonly scheduleId: string
  readonly userId: string
  readonly clientName: string
  readonly clientEmail: string
  readonly fundId: string
  readonly fundName: string
  readonly monthlyAmountPaise: string
  readonly startMonth: string
  readonly monthCount: number
  readonly entryId: string | null
  readonly recordedAmountPaise: string | null
  readonly recordedEffectiveDate: string | null
  readonly recordedAt: Date | null
}

export interface RecordingSheetQuery {
  readonly monthStart: string
  readonly fundId: string | null
  readonly afterScheduleId: string | null
  readonly limit: number
}

export interface MonthlyRecordingSheetRepository {
  listDueSchedules: (tx: Transaction, query: RecordingSheetQuery) => Promise<readonly RecordingSheetRow[]>
}

export const createMonthlyRecordingSheetRepository = (): MonthlyRecordingSheetRepository => ({
  listDueSchedules: async (tx, query) => {
    const result = await sql<RecordingSheetRow>`
      select
        s.id as "scheduleId",
        s.user_id as "userId",
        case when u.pii_tombstoned_at is null then u.full_name else 'Tombstoned' end as "clientName",
        case when u.pii_tombstoned_at is null then u.email_normalized
             else 'tombstone+' || replace(u.id::text, '-', '') || '@invalid.example' end as "clientEmail",
        s.fund_id as "fundId",
        coalesce(fv.name, f.slug) as "fundName",
        s.monthly_amount_paise::text as "monthlyAmountPaise",
        to_char(s.start_month, 'YYYY-MM') as "startMonth",
        s.month_count as "monthCount",
        v.id as "entryId",
        v.principal_delta_paise::text as "recordedAmountPaise",
        to_char(v.effective_date, 'YYYY-MM-DD') as "recordedEffectiveDate",
        v.created_at as "recordedAt"
      from admin_sip_schedules s
      join users u on u.id = s.user_id
      join funds f on f.id = s.fund_id
      left join fund_versions fv on fv.id = f.current_published_version_id
      left join admin_sip_schedule_months m
        on m.schedule_id = s.id and m.sip_month = ${query.monthStart}::date and m.released_at is null
      left join client_value_entries v on v.id = m.entry_id and v.user_id = m.user_id
      where s.state = 'active'
        and s.start_month <= ${query.monthStart}::date
        and s.start_month + make_interval(months => s.month_count) > ${query.monthStart}::date
        and (${query.fundId}::uuid is null or s.fund_id = ${query.fundId}::uuid)
        and (
          ${query.afterScheduleId}::uuid is null
          or (u.full_name, s.id) > (
            select ua.full_name, sa.id
            from admin_sip_schedules sa
            join users ua on ua.id = sa.user_id
            where sa.id = ${query.afterScheduleId}::uuid
          )
        )
      order by u.full_name, s.id
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },
})
