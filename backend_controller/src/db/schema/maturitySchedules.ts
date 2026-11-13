import type { Generated } from "kysely"
import type { BigIntStringDefault, DateColumn, NullableTimestamp, TimestampDefault } from "./columns.js"

export type ClientMaturityScheduleState = "scheduled" | "resolved" | "cancelled"

export type ClientMaturityResolution = "return_all" | "one_time_and_sip" | "sip_reinvestment"

export interface ClientMaturitySchedulesTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  maturity_date: DateColumn
  state: Generated<ClientMaturityScheduleState>
  resolution: ClientMaturityResolution | null
  maturity_id: string | null
  follow_up_sip_schedule_id: string | null
  created_by_user_id: string
  updated_by_user_id: string
  request_id: string
  version: BigIntStringDefault
  created_at: TimestampDefault
  updated_at: TimestampDefault
  resolved_at: NullableTimestamp
  cancelled_at: NullableTimestamp
}
