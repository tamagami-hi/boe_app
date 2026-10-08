import type { Generated } from "kysely"
import type { GrowthInstructionType, GrowthScope } from "./catalog.js"
import type { BigIntString, BigIntStringDefault, DateColumn, JsonDefault, Nullable, NullableTimestamp, TimestampDefault } from "./columns.js"

export type ClientValueEntryType =
  | "contribution"
  | "growth_adjustment"
  | "reversal"
  | "withdrawal"
  | "maturity_reinvestment"

export type MaturityState = "pending" | "settled"

export type MaturitySettlement = "withdrawal" | "reinvestment"

export type WithdrawalState = "pending" | "paid" | "failed"

export type LedgerActorType = "admin" | "system"

export interface ClientGrowthBatchesTable {
  id: Generated<string>
  scope: GrowthScope
  instruction_type: GrowthInstructionType
  effective_date: DateColumn
  reason_code: string
  note: Nullable<string>
  basis_hash: string
  actor_user_id: string
  request_id: string
  idempotency_record_id: Nullable<string>
  target_count: number
  total_delta_paise: BigIntString
  created_at: TimestampDefault
}

export interface ClientValueEntriesTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  allocation_id: Nullable<string>
  entry_type: ClientValueEntryType
  principal_delta_paise: BigIntString
  value_delta_paise: BigIntString
  effective_date: DateColumn
  order_id: Nullable<string>
  payment_id: Nullable<string>
  growth_batch_id: Nullable<string>
  reason_code: string
  note: Nullable<string>
  reverses_entry_id: Nullable<string>
  actor_type: LedgerActorType
  created_by_user_id: Nullable<string>
  request_id: string
  created_at: TimestampDefault
}

export interface ClientPositionMaturitiesTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  state: Generated<MaturityState>
  matured_on: DateColumn
  principal_at_maturity_paise: BigIntString
  value_at_maturity_paise: BigIntString
  settlement: Nullable<MaturitySettlement>
  settled_at: NullableTimestamp
  settlement_entry_id: Nullable<string>
  reason_code: string
  note: Nullable<string>
  marked_by_user_id: string
  request_id: string
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface WithdrawalOperationsTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  maturity_id: string
  ledger_entry_id: string
  state: Generated<WithdrawalState>
  amount_paise: BigIntString
  growth_portion_paise: BigIntString
  principal_portion_paise: BigIntString
  currency: Generated<string>
  effective_date: DateColumn
  transfer_reference: Nullable<string>
  failure_code: Nullable<string>
  paid_at: NullableTimestamp
  failed_at: NullableTimestamp
  reason_code: string
  note: Nullable<string>
  created_by_user_id: string
  request_id: string
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface NotificationsTable {
  id: Generated<string>
  user_id: string
  kind: string
  title: string
  body: string
  read_at: NullableTimestamp
  payload: JsonDefault
  created_at: TimestampDefault
  updated_at: TimestampDefault
}

export type SupportRequestState = "open" | "in_progress" | "resolved" | "closed"

export interface SupportRequestsTable {
  id: Generated<string>
  user_id: string
  reference: string
  category: string
  subject: string
  body: string
  state: Generated<SupportRequestState>
  resolution_note: string | null
  resolved_at: NullableTimestamp
  closed_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: Generated<string>
}
