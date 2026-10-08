import type { Generated } from "kysely"
import type { BigIntString, BigIntStringDefault, Bytea, Nullable, NullableBigIntString, NullableBytea, NullableDateColumn, NullableTimestamp, TimestampDefault } from "./columns.js"
import type { LedgerActorType } from "./ledger.js"

export type OrderType = "lump_sum" | "sip_installment" | "recorded_offline"

export type OrderState =
  | "submitted"
  | "payment_pending"
  | "accepted"
  | "refund_pending"
  | "refunded"
  | "refund_failed"
  | "payment_failed"
  | "cancelled"

export type PaymentState =
  | "created"
  | "provider_pending"
  | "succeeded"
  | "failed"
  | "expired"
  | "reconciliation_required"
  | "refund_pending"
  | "refunded"
  | "refund_failed"

export type ProviderEventState = "received" | "processing" | "processed" | "dead_lettered"

export type RefundState = "pending" | "provider_pending" | "refunded" | "failed"

export type FundReceiptAcknowledgementState = "pending" | "acknowledged"

export interface InvestmentOrdersTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  fund_version_id: string
  sip_plan_id: Nullable<string>
  type: OrderType
  state: Generated<OrderState>
  amount_paise: BigIntString
  currency: Generated<string>
  due_period: NullableDateColumn
  requested_at: TimestampDefault
  payment_confirmed_at: NullableTimestamp
  accepted_at: NullableTimestamp
  cancelled_at: NullableTimestamp
  failure_code: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface FundReceiptAcknowledgementsTable {
  id: Generated<string>
  order_id: string
  state: Generated<FundReceiptAcknowledgementState>
  acknowledged_by_user_id: Nullable<string>
  private_note: Nullable<string>
  acknowledged_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface InvestmentAllocationsTable {
  id: Generated<string>
  order_id: string
  user_id: string
  fund_id: string
  amount_paise: BigIntString
  allocated_by_user_id: Nullable<string>
  actor_type: Generated<LedgerActorType>
  allocated_at: TimestampDefault
  request_id: string
  created_at: TimestampDefault
}

export interface PaymentsTable {
  id: Generated<string>
  order_id: string
  user_id: string
  amount_paise: BigIntString
  currency: Generated<string>
  state: Generated<PaymentState>
  succeeded_at: NullableTimestamp
  failed_at: NullableTimestamp
  refunded_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface PaymentAttemptsTable {
  id: Generated<string>
  payment_id: string
  user_id: string
  attempt_number: number
  provider: string
  checkout_channel: Generated<"hosted_redirect" | "phonepe_autopay" | "phonepe_mandate_setup">
  merchant_order_id: string
  provider_order_id: Nullable<string>
  provider_dispatch_started_at: NullableTimestamp
  state: Generated<PaymentState>
  failure_code: Nullable<string>
  checkout_expires_at: NullableTimestamp
  last_status_checked_at: NullableTimestamp
  next_status_check_at: NullableTimestamp
  reconciliation_lease_expires_at: NullableTimestamp
  reconciliation_failure_count: Generated<number>
  reconciliation_required_at: NullableTimestamp
  provider_state: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface ProviderPaymentDetailsTable {
  id: Generated<string>
  payment_attempt_id: string
  user_id: string
  provider_transaction_id: string
  provider_reference: Nullable<string>
  instrument_type: Nullable<string>
  state: Nullable<string>
  amount_paise: NullableBigIntString
  created_at: TimestampDefault
}

export interface RefundOperationsTable {
  id: Generated<string>
  payment_id: string
  order_id: string
  merchant_refund_id: string
  provider_refund_id: Nullable<string>
  amount_paise: BigIntString
  state: Generated<RefundState>
  failure_code: Nullable<string>
  attempt_count: Generated<number>
  last_status_checked_at: NullableTimestamp
  created_by_user_id: string
  request_id: string
  created_at: TimestampDefault
  updated_at: TimestampDefault
}

export interface ProviderEventsTable {
  id: Generated<string>
  provider: string
  event_type: string
  dedup_key: string
  state: Generated<ProviderEventState>
  signature_valid: boolean
  payload_ciphertext: NullableBytea
  payload_nonce: NullableBytea
  payload_key_version: Nullable<string>
  payload_sha256: Bytea
  erased_at: NullableTimestamp
  merchant_order_id: Nullable<string>
  payment_id: Nullable<string>
  user_id: Nullable<string>
  attempt_count: Generated<number>
  available_at: TimestampDefault
  locked_at: NullableTimestamp
  locked_by: Nullable<string>
  processed_at: NullableTimestamp
  last_error_code: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}
