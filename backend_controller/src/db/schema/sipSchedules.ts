import type { Generated } from "kysely"
import type { BigIntString, BigIntStringDefault, DateColumn, NullableTimestamp, TimestampDefault } from "./columns.js"

export type AdminSipScheduleState = "active" | "closed"

export interface AdminSipSchedulesTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  monthly_amount_paise: BigIntString
  start_month: DateColumn
  month_count: number
  state: Generated<AdminSipScheduleState>
  created_by_user_id: string
  updated_by_user_id: string
  request_id: string
  version: BigIntStringDefault
  created_at: TimestampDefault
  updated_at: TimestampDefault
  closed_at: NullableTimestamp
}

export interface AdminSipScheduleMonthsTable {
  id: Generated<string>
  schedule_id: string
  user_id: string
  fund_id: string
  sip_month: DateColumn
  entry_id: string
  created_by_user_id: string
  request_id: string
  created_at: TimestampDefault
  released_at: NullableTimestamp
}
