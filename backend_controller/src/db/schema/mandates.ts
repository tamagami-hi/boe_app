import type { Generated } from "kysely"
import type { BigIntString, BigIntStringDefault, DateColumn, Nullable, NullableBigIntString, NullableDateColumn, NullableTimestamp, Timestamp, TimestampDefault } from "./columns.js"

export type SipState =
  | "draft"
  | "pending_mandate"
  | "active"
  | "paused"
  | "cancel_pending"
  | "cancelled"
  | "completed"
  | "setup_failed"
  | "mandate_failed"
  | "expired"
  | "revoked"

export type SipCollectionMode = "manual_checkout" | "phonepe_autopay"

export type MandateState =
  | "setup_pending"
  | "active"
  | "pause_pending"
  | "paused"
  | "cancel_pending"
  | "cancelled"
  | "revoke_pending"
  | "revoked"
  | "expired"
  | "failed"

export type MandateSetupState = "created" | "dispatching" | "provider_pending" | "authorized" | "failed" | "expired"

export type MandateNotifyState = "created" | "dispatching" | "notified" | "failed"

export type MandateCancelCommandState = "queued" | "dispatching" | "accepted" | "rejected" | "reconciliation_required"

export interface SipPlansTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  amount_paise: BigIntString
  debit_day: number
  duration_months: Nullable<number>
  state: Generated<SipState>
  collection_mode: Generated<SipCollectionMode>
  start_date: NullableDateColumn
  next_due_date: NullableDateColumn
  paused_at: NullableTimestamp
  cancelled_at: NullableTimestamp
  completed_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface PaymentMandatesTable {
  id: Generated<string>
  sip_plan_id: string
  user_id: string
  fund_id: string
  provider: string
  merchant_subscription_id: string
  provider_subscription_id: Nullable<string>
  state: Generated<MandateState>
  amount_type: string
  max_amount_paise: BigIntString
  frequency: string
  authorized_at: NullableTimestamp
  expires_at: NullableTimestamp
  pause_requested_at: NullableTimestamp
  paused_at: NullableTimestamp
  cancellation_requested_at: NullableTimestamp
  completion_requested_at: NullableTimestamp
  revocation_requested_at: NullableTimestamp
  cancelled_at: NullableTimestamp
  revoked_at: NullableTimestamp
  failed_at: NullableTimestamp
  last_status_checked_at: NullableTimestamp
  failure_code: Nullable<string>
  abandonment_requested_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface MandateSetupAttemptsTable {
  id: Generated<string>
  mandate_id: string
  sip_plan_id: string
  user_id: string
  fund_id: Nullable<string>
  amount_paise: NullableBigIntString
  due_period: NullableDateColumn
  order_id: Nullable<string>
  payment_id: Nullable<string>
  payment_attempt_id: Nullable<string>
  checkout_channel: Nullable<"phonepe_mandate_setup">
  attempt_number: number
  provider: string
  merchant_order_id: string
  provider_order_id: Nullable<string>
  provider_dispatch_started_at: NullableTimestamp
  checkout_redirect_url: Nullable<string>
  setup_expires_at: Timestamp
  not_found_first_observed_at: NullableTimestamp
  state: Generated<MandateSetupState>
  failure_code: Nullable<string>
  last_status_checked_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface MandateCollectionAttemptsTable {
  id: Generated<string>
  mandate_id: string
  sip_plan_id: string
  user_id: string
  fund_id: string
  amount_paise: BigIntString
  due_period: DateColumn
  scheduled_debit_at: Timestamp
  notify_at: Timestamp
  order_id: string
  payment_id: string
  payment_attempt_id: string
  checkout_channel: Generated<"phonepe_autopay">
  notify_state: Generated<MandateNotifyState>
  notify_dispatch_started_at: NullableTimestamp
  notified_at: NullableTimestamp
  notify_failure_code: Nullable<string>
  retry_strategy: string
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface MandateCancelCommandsTable {
  id: Generated<string>
  mandate_id: string
  sip_plan_id: string
  user_id: string
  merchant_subscription_id: string
  previous_mandate_state: MandateState
  state: Generated<MandateCancelCommandState>
  attempt_number: Generated<number>
  dispatch_started_at: NullableTimestamp
  status_check_count: Generated<number>
  last_status_checked_at: NullableTimestamp
  reconciliation_required_at: NullableTimestamp
  accepted_at: NullableTimestamp
  rejected_at: NullableTimestamp
  failure_code: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}
