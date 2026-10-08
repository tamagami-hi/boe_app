import type { Generated } from "kysely"
import type { BigIntString, BigIntStringDefault, Bytea, DateColumn, Json, JsonDefault, Nullable, NullableTimestamp, Numeric, Timestamp, TimestampDefault } from "./columns.js"

export type FundState = "draft" | "published" | "paused" | "archived"

export type FundRiskLevel = "low" | "moderate" | "high" | "very_high"

export type FundReturnTier = "low" | "moderate" | "high"

export type GrowthScope = "individual" | "collective"

export type GrowthInstructionType = "amount" | "percentage" | "explicit_deltas"

export interface FundsTable {
  id: Generated<string>
  slug: string
  state: Generated<FundState>
  current_published_version_id: Nullable<string>
  published_at: NullableTimestamp
  paused_at: NullableTimestamp
  archived_at: NullableTimestamp
  created_by_user_id: string
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface FundVersionsTable {
  id: Generated<string>
  fund_id: string
  version: number
  name: string
  category: string
  objective: string
  risk_level: FundRiskLevel
  return_tier: Nullable<FundReturnTier>
  currency: Generated<string>
  minimum_sip_paise: BigIntString
  minimum_purchase_paise: BigIntString
  minimum_duration_months: Nullable<number>
  recommended_holding_months: Nullable<number>
  disclosure_version_id: string
  terms_sha256: Bytea
  created_by_user_id: string
  created_at: TimestampDefault
}

export interface FundDisclosureVersionsTable {
  id: Generated<string>
  fund_id: string
  version: number
  title: string
  body: string
  content_sha256: Bytea
  effective_from: Timestamp
  published_by_user_id: string
  created_at: TimestampDefault
  updated_at: TimestampDefault
}

export interface FundAumSnapshotsTable {
  id: Generated<string>
  fund_id: string
  as_of_date: DateColumn
  revision: Generated<number>
  aum_paise: BigIntString
  aum_growth_batch_id: Nullable<string>
  reason_code: string
  note: Nullable<string>
  published_by_user_id: string
  request_id: string
  created_at: TimestampDefault
}

export interface AumGrowthBatchesTable {
  id: Generated<string>
  scope: GrowthScope
  instruction_type: GrowthInstructionType
  effective_date: DateColumn
  reason_code: string
  note: Nullable<string>
  basis_hash: string
  actor_user_id: string
  request_id: string
  target_count: number
  total_delta_paise: BigIntString
  created_at: TimestampDefault
}

export interface FundStockDisclosuresTable {
  id: Generated<string>
  fund_id: string
  stock_name: string
  quarter_label: string
  weight_percent: Nullable<Numeric>
  state: Generated<string>
  sort_order: Generated<number>
  added_by_user_id: string
  exited_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
}

export interface FinancePolicyVersionsTable {
  id: Generated<string>
  version: number
  effective_from: Timestamp
  retired_at: NullableTimestamp
  published_by_user_id: string
  created_at: TimestampDefault
}

export interface AppConfigVersionsTable {
  id: Generated<string>
  version: number
  payload: Json
  content_sha256: Bytea
  published_by_user_id: string
  published_at: Timestamp
  retired_at: NullableTimestamp
  created_at: TimestampDefault
}

export interface ContentItemsTable {
  id: Generated<string>
  content_key: string
  kind: string
  version: number
  title: string
  body: string
  payload: JsonDefault
  state: Generated<string>
  published_by_user_id: Nullable<string>
  published_at: NullableTimestamp
  archived_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
}
