import type { Generated } from "kysely"

import type { BigIntString, DateColumn, Nullable, TimestampDefault } from "./columns.js"

export interface SipEarlyExitsTable {
  id: Generated<string>
  schedule_id: string
  user_id: string
  fund_id: string
  ledger_entry_id: string
  payout_id: string
  amount_paise: BigIntString
  principal_before_paise: BigIntString
  value_before_paise: BigIntString
  cancelled_maturity_schedule_id: Nullable<string>
  effective_date: DateColumn
  created_by_user_id: string
  request_id: string
  created_at: TimestampDefault
}
