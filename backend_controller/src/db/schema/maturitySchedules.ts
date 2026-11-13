import type { Generated } from "kysely"
import type { BigIntStringDefault, DateColumn, NullableDateColumn, NullableTimestamp, TimestampDefault } from "./columns.js"

export type ClientMaturityScheduleState = "scheduled" | "resolved" | "cancelled"

export type ClientMaturityResolution = "return_all" | "one_time_and_sip" | "sip_reinvestment" | "sip_extension"

export type ClientMaturityOfferState = "open" | "confirmed" | "withdrawn" | "superseded" | "closed"

export type ClientMaturityOption = "return_all" | "one_time_and_sip" | "sip_extension"

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

export interface ClientMaturityOffersTable {
  id: Generated<string>
  maturity_schedule_id: string
  user_id: string
  fund_id: string
  state: Generated<ClientMaturityOfferState>
  sip_monthly_amount_paise: string
  sip_start_month: DateColumn
  sip_month_count: number
  extension_months: number | null
  next_maturity_date: NullableDateColumn
  chosen_option: ClientMaturityOption | null
  chosen_at: NullableTimestamp
  created_by_user_id: string
  closed_by_user_id: string | null
  request_id: string
  version: BigIntStringDefault
  created_at: TimestampDefault
  updated_at: TimestampDefault
  closed_at: NullableTimestamp
}
