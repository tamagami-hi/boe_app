import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import { cursorTime, keysetCondition, type KeysetBoundary, type WithCursor } from "./keysetBoundary.js"

export interface ClientReceiptRow {
  readonly entryId: string
  readonly orderId: string
  readonly fundId: string
  readonly fundName: string
  readonly reasonCode: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly recordedAt: Date
  readonly reversedAt: Date | null
  readonly sipMonth: string | null
  readonly oneTime: boolean
}

export interface ClientReceiptRepository {
  listByUser: (
    tx: Transaction,
    input: KeysetBoundary & Readonly<{ userId: string; fundId?: string; limit: number }>,
  ) => Promise<readonly WithCursor<ClientReceiptRow>[]>
  findByUser: (
    tx: Transaction,
    input: Readonly<{ userId: string; entryId: string }>,
  ) => Promise<ClientReceiptRow | null>
}

const RECEIPT_SELECTION = sql`
  select
    v.id as "entryId",
    v.order_id as "orderId",
    v.fund_id as "fundId",
    fv.name as "fundName",
    v.reason_code as "reasonCode",
    v.principal_delta_paise::text as "amountPaise",
    to_char(v.effective_date, 'YYYY-MM-DD') as "effectiveDate",
    v.created_at as "recordedAt",
    r.created_at as "reversedAt",
    ${cursorTime("v.created_at")} as "cursorAt",
    to_char(l.sip_month, 'YYYY-MM') as "sipMonth",
    (c.id is not null) as "oneTime"
  from client_value_entries v
  join investment_orders o on o.id = v.order_id and o.user_id = v.user_id
  join fund_versions fv on fv.id = o.fund_version_id
  left join client_value_entries r on r.reverses_entry_id = v.id
  left join admin_sip_schedule_months l on l.entry_id = v.id
  left join client_value_entry_categories c on c.entry_id = v.id
`

const RECORDING_FILTER = sql`v.entry_type = 'contribution' and o.type = 'recorded_offline'`

export const createClientReceiptRepository = (): ClientReceiptRepository => ({
  listByUser: async (tx, input) => {
    const result = await sql<WithCursor<ClientReceiptRow>>`
      ${RECEIPT_SELECTION}
      where v.user_id = ${input.userId}
        and ${RECORDING_FILTER}
        and (${input.fundId ?? null}::uuid is null or v.fund_id = ${input.fundId ?? null}::uuid)
        and ${keysetCondition({ time: "v.created_at", id: "v.id" }, "before", input)}
      order by v.created_at desc, v.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  findByUser: async (tx, input) => {
    const result = await sql<ClientReceiptRow>`
      ${RECEIPT_SELECTION}
      where v.user_id = ${input.userId}
        and v.id = ${input.entryId}
        and ${RECORDING_FILTER}
    `.execute(tx)
    return result.rows[0] ?? null
  },
})
