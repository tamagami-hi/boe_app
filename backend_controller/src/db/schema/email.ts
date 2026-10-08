import type { Generated } from "kysely"
import type { BigIntStringDefault, Bytea, Json, Nullable, NullableBytea, NullableTimestamp, Timestamp, TimestampDefault } from "./columns.js"

export type OutboxState =
  | "pending"
  | "processing"
  | "sending"
  | "delivered"
  | "retryable_failed"
  | "dead_lettered"
  | "cancelled"

export type EmailDeliveryState =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "retryable_failed"
  | "permanent_failed"
  | "cancelled"

export type EmailProviderEventState = "received" | "processed" | "ignored" | "unmatched"

export interface OutboxEventsTable {
  id: Generated<string>
  topic: string
  event_type: string
  event_version: number
  aggregate_type: string
  aggregate_id: string
  occurred_at: Timestamp
  request_id: string
  causation_id: Nullable<string>
  correlation_id: Nullable<string>
  deduplication_key: string
  payload: Json
  state: Generated<OutboxState>
  attempt_count: Generated<number>
  available_at: TimestampDefault
  locked_at: NullableTimestamp
  locked_by: Nullable<string>
  lease_expires_at: NullableTimestamp
  delivered_at: NullableTimestamp
  cancelled_at: NullableTimestamp
  last_error_code: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
}

export interface EmailDeliveriesTable {
  id: Generated<string>
  outbox_event_id: Nullable<string>
  application_id: Nullable<string>
  user_id: Nullable<string>
  template_key: string
  template_version: string
  recipient_ciphertext: NullableBytea
  recipient_nonce: NullableBytea
  recipient_hmac: Bytea
  recipient_masked: string
  recipient_encryption_key_version: Nullable<string>
  suppression_hmac_key_version: string
  ses_configuration_set: string
  ses_message_id: Nullable<string>
  ses_request_id: Nullable<string>
  state: Generated<EmailDeliveryState>
  attempt_count: Generated<number>
  last_attempt_at: NullableTimestamp
  last_error_code: Nullable<string>
  failure_detail_ciphertext: NullableBytea
  failure_detail_nonce: NullableBytea
  failure_detail_key_version: Nullable<string>
  sent_at: NullableTimestamp
  delivered_at: NullableTimestamp
  bounced_at: NullableTimestamp
  complained_at: NullableTimestamp
  cancelled_at: NullableTimestamp
  erased_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface EmailProviderEventsTable {
  id: Generated<string>
  sns_message_id: string
  sns_topic_arn: string
  sns_type: string
  ses_event_type: Nullable<string>
  ses_message_id: Nullable<string>
  delivery_correlation_id: Nullable<string>
  email_delivery_id: Nullable<string>
  payload_ciphertext: NullableBytea
  payload_nonce: NullableBytea
  payload_sha256: Bytea
  payload_key_version: Nullable<string>
  state: Generated<EmailProviderEventState>
  received_at: TimestampDefault
  processed_at: NullableTimestamp
  expires_at: Timestamp
  erased_at: NullableTimestamp
}

export interface EmailSuppressionsTable {
  recipient_hmac: Bytea
  suppression_hmac_key_version: string
  reason: string
  source_event_id: string
  created_at: TimestampDefault
  lifted_at: NullableTimestamp
  lifted_by_user_id: Nullable<string>
  lift_reason: Nullable<string>
}
