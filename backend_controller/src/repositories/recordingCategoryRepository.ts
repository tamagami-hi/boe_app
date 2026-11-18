import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface RecordingRow {
  readonly entryId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly recordedAt: Date
  readonly reversed: boolean
  readonly linked: boolean
  readonly linkScheduleId: string | null
  readonly linkMonth: string | null
  readonly oneTime: boolean
}

export interface InsertOneTimeCategoryInput {
  readonly entryId: string
  readonly userId: string
  readonly fundId: string
  readonly actorUserId: string
  readonly requestId: string
}

export interface RecordingCategoryRepository {
  listRecordings: (tx: Transaction, input: Readonly<{ userId: string; fundId: string | null }>) => Promise<readonly RecordingRow[]>
  findRecording: (tx: Transaction, input: Readonly<{ userId: string; entryId: string }>) => Promise<RecordingRow | null>
  insertOneTime: (tx: Transaction, input: InsertOneTimeCategoryInput) => Promise<{ readonly id: string }>
}

const RECORDING_SELECTION = sql`
  select
    v.id as "entryId",
    v.fund_id as "fundId",
    v.principal_delta_paise::text as "amountPaise",
    to_char(v.effective_date, 'YYYY-MM-DD') as "effectiveDate",
    v.reason_code as "reasonCode",
    v.created_at as "recordedAt",
    (r.id is not null) as reversed,
    (l.id is not null) as linked,
    case when l.released_at is null then l.schedule_id end as "linkScheduleId",
    case when l.released_at is null then to_char(l.sip_month, 'YYYY-MM') end as "linkMonth",
    (c.id is not null) as "oneTime"
  from client_value_entries v
  join investment_orders o on o.id = v.order_id and o.user_id = v.user_id
  left join client_value_entries r on r.reverses_entry_id = v.id
  left join admin_sip_schedule_months l on l.entry_id = v.id
  left join client_value_entry_categories c on c.entry_id = v.id
`

const RECORDING_FILTER = sql`v.entry_type = 'contribution' and o.type in ('recorded_offline', 'sip_installment')`

export const createRecordingCategoryRepository = (): RecordingCategoryRepository => ({
  listRecordings: async (tx, input) => {
    const result = await sql<RecordingRow>`
      ${RECORDING_SELECTION}
      where v.user_id = ${input.userId}
        and ${RECORDING_FILTER}
        and (${input.fundId}::uuid is null or v.fund_id = ${input.fundId}::uuid)
      order by v.effective_date, v.created_at, v.id
    `.execute(tx)
    return result.rows
  },

  findRecording: async (tx, input) => {
    const result = await sql<RecordingRow>`
      ${RECORDING_SELECTION}
      where v.user_id = ${input.userId}
        and v.id = ${input.entryId}
        and ${RECORDING_FILTER}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  insertOneTime: async (tx, input) =>
    tx
      .insertInto("client_value_entry_categories")
      .values({
        entry_id: input.entryId,
        user_id: input.userId,
        fund_id: input.fundId,
        category: "one_time",
        set_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
})
