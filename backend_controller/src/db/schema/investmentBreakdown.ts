import type { Generated } from "kysely"

import type { BigIntString, Nullable, TimestampDefault } from "./columns.js"

export type InvestmentTargetKind = "sip" | "one_time"

export interface ClientGrowthPartsTable {
  id: Generated<string>
  entry_id: string
  user_id: string
  fund_id: string
  target_kind: InvestmentTargetKind
  target_sip_schedule_id: Nullable<string>
  target_allocation_id: Nullable<string>
  amount_paise: BigIntString
  created_at: TimestampDefault
}

export interface ClientEarlierGrowthSplitsTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  cutoff_entry_id: string
  total_paise: BigIntString
  confirmed_by_user_id: string
  request_id: string
  created_at: TimestampDefault
}

export interface ClientEarlierGrowthSplitPartsTable {
  id: Generated<string>
  split_id: string
  user_id: string
  fund_id: string
  target_kind: InvestmentTargetKind
  target_sip_schedule_id: Nullable<string>
  target_allocation_id: Nullable<string>
  amount_paise: BigIntString
}

export interface ClientEarlierGrowthSplitEntriesTable {
  split_id: string
  entry_id: string
  user_id: string
  fund_id: string
}
