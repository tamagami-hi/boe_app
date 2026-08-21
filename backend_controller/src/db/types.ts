import type { ColumnType, Generated, JSONColumnType } from "kysely"

type Timestamp = ColumnType<Date, Date | string, Date | string>
type TimestampDefault = ColumnType<Date, Date | string | undefined, Date | string>
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>

type Bytea = ColumnType<Buffer, Buffer | Uint8Array, Buffer | Uint8Array>
type NullableBytea = ColumnType<
  Buffer | null,
  Buffer | Uint8Array | null | undefined,
  Buffer | Uint8Array | null
>

type BigIntString = ColumnType<string, string | number | bigint, string | number | bigint>
type BigIntStringDefault = ColumnType<
  string,
  string | number | bigint | undefined,
  string | number | bigint
>
type NullableBigIntString = ColumnType<
  string | null,
  string | number | bigint | null | undefined,
  string | number | bigint | null
>

type Numeric = ColumnType<string, string | number, string | number>

type DateColumn = ColumnType<Date, Date | string, Date | string>
type NullableDateColumn = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>

type Json = JSONColumnType<Record<string, unknown>>
type JsonDefault = ColumnType<Record<string, unknown>, string | undefined, string>

export type ApplicationState = "submitted" | "approved" | "rejected" | "withdrawn"
export type UserAccountState = "invited" | "active" | "suspended" | "closed"
export type ApplicationDecision = "approved" | "rejected"
export type SessionChannel = "native" | "web"
export type AuthSessionState = "active" | "revoked" | "expired"
export type AuthLoginOutcome =
  | "success"
  | "invalid_credentials"
  | "unknown_identity"
  | "account_not_active"
  | "password_changed"
  | "not_authorized"
export type ActorType = "public" | "user" | "admin" | "system" | "provider"
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
export type ConsentKind = "terms" | "privacy"

export type KycCaseState =
  | "pending_submission"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "needs_information"
export type RiskAssessmentState = "not_started" | "submitted" | "assessed"
export type RiskCategory = "conservative" | "balanced" | "growth" | "aggressive"
export type FundState = "draft" | "review_pending" | "published" | "paused" | "archived"
export type FundRiskLevel = "low" | "moderate" | "high" | "very_high"
export type FundReturnTier = "low" | "moderate" | "high"
export type SipState = "draft" | "pending_mandate" | "active" | "paused" | "cancelled" | "completed"
export type OrderType = "lump_sum" | "sip_installment"
export type OrderState =
  | "submitted"
  | "payment_pending"
  | "review_pending"
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
  | "refund_pending"
  | "refunded"
  | "refund_failed"
export type ProviderEventState = "received" | "processing" | "processed" | "dead_lettered"
export type RefundState = "pending" | "provider_pending" | "refunded" | "failed"
export type ReviewState = "pending" | "accepted" | "rejected"
export type ClientValueEntryType = "contribution" | "growth_adjustment" | "reversal"
export type LedgerActorType = "admin" | "system"
export type GrowthScope = "individual" | "collective"
export type GrowthInstructionType = "amount" | "percentage" | "explicit_deltas"

export interface ApplicationsTable {
  id: Generated<string>
  email_normalized: string
  phone_e164: string
  full_name: string
  password_hash: string | null
  state: Generated<ApplicationState>
  submitted_at: NullableTimestamp
  review_started_at: NullableTimestamp
  decided_at: NullableTimestamp
  withdrawn_at: NullableTimestamp
  pii_tombstoned_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface ConsentDocumentsTable {
  id: Generated<string>
  kind: ConsentKind
  version: string
  public_path: string
  content_markdown: string
  content_sha256: Bytea
  published_at: Timestamp
  retired_at: NullableTimestamp
  created_at: TimestampDefault
}

export interface ApplicationConsentsTable {
  id: Generated<string>
  application_id: string
  consent_document_id: string
  accepted_at: Timestamp
  ip_hmac: Bytea
  ip_hmac_key_version: string
  user_agent: Nullable<string>
  created_at: TimestampDefault
}

export interface UsersTable {
  id: Generated<string>
  application_id: Nullable<string>
  email_normalized: string
  phone_e164: string
  full_name: string
  account_state: Generated<UserAccountState>
  activated_at: NullableTimestamp
  suspended_at: NullableTimestamp
  closed_at: NullableTimestamp
  pii_tombstoned_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface UserCredentialsTable {
  user_id: string
  password_hash: Nullable<string>
  password_changed_at: TimestampDefault
  failed_attempt_count: Generated<number>
  failed_attempt_window_started_at: NullableTimestamp
  locked_until: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface ApplicationReviewsTable {
  id: Generated<string>
  application_id: string
  reviewer_user_id: string
  decision: ApplicationDecision
  reason_code: string
  reason_detail: Nullable<string>
  request_id: string
  idempotency_key: string
  created_at: TimestampDefault
}

export interface AuthSessionsTable {
  id: Generated<string>
  user_id: string
  token_family_id: Generated<string>
  channel: SessionChannel
  device_id_hash: NullableBytea
  state: Generated<AuthSessionState>
  generation: BigIntStringDefault
  refresh_key_version: string
  previous_refresh_token_hash: NullableBytea
  previous_refresh_key_version: Nullable<string>
  previous_refresh_valid_until: NullableTimestamp
  last_rotation_id: Nullable<string>
  csrf_token_hash: NullableBytea
  csrf_key_version: Nullable<string>
  previous_csrf_token_hash: NullableBytea
  previous_csrf_key_version: Nullable<string>
  previous_csrf_valid_until: NullableTimestamp
  csrf_expires_at: NullableTimestamp
  csrf_rotated_at: NullableTimestamp
  ip_address: Nullable<string>
  user_agent: Nullable<string>
  last_seen_at: TimestampDefault
  expires_at: Timestamp
  revoked_at: NullableTimestamp
  revocation_reason: Nullable<string>
  expired_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface AuthLoginEventsTable {
  id: Generated<string>
  occurred_at: TimestampDefault
  user_id: Nullable<string>
  email_normalized: string
  channel: SessionChannel
  outcome: AuthLoginOutcome
  session_id: Nullable<string>
  device_id_hash: NullableBytea
  ip_address: Nullable<string>
  user_agent: Nullable<string>
  request_id: string
}

export interface AuthRefreshTokensTable {
  id: Generated<string>
  session_id: string
  user_id: string
  generation: BigIntString
  token_hash: Bytea
  token_key_version: string
  expires_at: Timestamp
  used_at: NullableTimestamp
  revoked_at: NullableTimestamp
  replaced_by_token_id: Nullable<string>
  created_at: TimestampDefault
}

export interface RolesTable {
  id: Generated<string>
  code: string
  name: string
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface PermissionsTable {
  id: Generated<string>
  code: string
  description: string
  created_at: TimestampDefault
}

export interface RolePermissionsTable {
  role_id: string
  permission_id: string
  granted_by_user_id: string
  granted_at: TimestampDefault
  revoked_by_user_id: Nullable<string>
  revoked_at: NullableTimestamp
}

export interface UserRolesTable {
  user_id: string
  role_id: string
  granted_by_user_id: string
  granted_at: TimestampDefault
  revoked_by_user_id: Nullable<string>
  revoked_at: NullableTimestamp
}

export interface AuditEventsTable {
  id: Generated<string>
  occurred_at: TimestampDefault
  actor_type: ActorType
  actor_user_id: Nullable<string>
  command: string
  entity_type: string
  entity_id: string
  from_state: Nullable<string>
  to_state: Nullable<string>
  reason_code: Nullable<string>
  reason_detail: Nullable<string>
  request_id: string
  idempotency_key: Nullable<string>
  entity_version: BigIntString
  ip_address: Nullable<string>
  user_agent: Nullable<string>
  metadata: JsonDefault
}

export interface IdempotencyRecordsTable {
  id: Generated<string>
  actor_scope: string
  actor_scope_key_version: Nullable<string>
  http_method: string
  route_template: string
  key: string
  actor_user_id: Nullable<string>
  request_hash: Bytea
  response_status: number
  response_body: Json
  created_at: TimestampDefault
  completed_at: TimestampDefault
  expires_at: Timestamp
}

export interface RateLimitWindowsTable {
  bucket: string
  key_hash: Bytea
  window_start: Timestamp
  count: number
  expires_at: Timestamp
}

export interface LegalHoldsTable {
  id: Generated<string>
  entity_type: string
  entity_id: string
  reason: string
  placed_by: string
  placed_at: TimestampDefault
  expires_at: NullableTimestamp
  released_by: Nullable<string>
  released_at: NullableTimestamp
}

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

export interface InvestorProfilesTable {
  user_id: string
  date_of_birth_ciphertext: NullableBytea
  date_of_birth_nonce: NullableBytea
  address_ciphertext: NullableBytea
  address_nonce: NullableBytea
  encryption_key_version: Nullable<string>
  erased_at: NullableTimestamp
  tax_residency_country: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface KycVerificationCodesTable {
  id: Generated<string>
  kyc_case_id: string
  user_id: string
  code_hash: Bytea
  code_key_version: string
  attempt_count: Generated<number>
  expires_at: Timestamp
  consumed_at: NullableTimestamp
  created_at: TimestampDefault
}

export interface KycCasesTable {
  id: Generated<string>
  user_id: string
  state: Generated<KycCaseState>
  provider: Nullable<string>
  provider_case_id: Nullable<string>
  submitted_at: NullableTimestamp
  review_started_at: NullableTimestamp
  decided_at: NullableTimestamp
  expires_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

export interface KycDocumentsTable {
  id: Generated<string>
  kyc_case_id: string
  user_id: string
  document_type: string
  object_key: string
  content_sha256: Bytea
  encryption_key_version: string
  created_at: TimestampDefault
}

export interface KycReviewsTable {
  id: Generated<string>
  kyc_case_id: string
  user_id: string
  reviewer_user_id: string
  from_state: Nullable<KycCaseState>
  to_state: KycCaseState
  reason_code: Nullable<string>
  reason_detail: Nullable<string>
  request_id: string
  created_at: TimestampDefault
}

export interface RiskAssessmentsTable {
  id: Generated<string>
  user_id: string
  state: Generated<RiskAssessmentState>
  questionnaire_version: string
  answers: JsonDefault
  score: Nullable<number>
  category: Nullable<RiskCategory>
  submitted_at: NullableTimestamp
  assessed_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

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
  redemption_dual_approval_threshold_paise: BigIntStringDefault
  effective_from: Timestamp
  retired_at: NullableTimestamp
  published_by_user_id: string
  created_at: TimestampDefault
}

export interface MarketingLeadsTable {
  id: Generated<string>
  full_name_ciphertext: NullableBytea
  full_name_nonce: NullableBytea
  email_ciphertext: NullableBytea
  email_nonce: NullableBytea
  phone_ciphertext: NullableBytea
  phone_nonce: NullableBytea
  email_hmac: NullableBytea
  phone_hmac: NullableBytea
  pii_key_version: Nullable<string>
  pii_erased_at: NullableTimestamp
  source: string
  state: Generated<string>
  application_id: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
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

export interface SipPlansTable {
  id: Generated<string>
  user_id: string
  fund_id: string
  amount_paise: BigIntString
  debit_day: number
  duration_months: Nullable<number>
  state: Generated<SipState>
  start_date: NullableDateColumn
  next_due_date: NullableDateColumn
  paused_at: NullableTimestamp
  cancelled_at: NullableTimestamp
  completed_at: NullableTimestamp
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}

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

export interface InvestmentReviewsTable {
  id: Generated<string>
  order_id: string
  state: Generated<ReviewState>
  bank_verified: Generated<boolean>
  reviewed_by_user_id: Nullable<string>
  reason_code: Nullable<string>
  private_note: Nullable<string>
  reviewed_at: NullableTimestamp
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
  allocated_by_user_id: string
  allocated_at: TimestampDefault
  request_id: string
  created_at: TimestampDefault
}

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
  merchant_order_id: string
  provider_order_id: Nullable<string>
  state: Generated<PaymentState>
  failure_code: Nullable<string>
  checkout_expires_at: NullableTimestamp
  last_status_checked_at: NullableTimestamp
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

export interface Database {
  applications: ApplicationsTable
  consent_documents: ConsentDocumentsTable
  application_consents: ApplicationConsentsTable
  users: UsersTable
  user_credentials: UserCredentialsTable
  application_reviews: ApplicationReviewsTable
  auth_sessions: AuthSessionsTable
  auth_refresh_tokens: AuthRefreshTokensTable
  auth_login_events: AuthLoginEventsTable
  roles: RolesTable
  permissions: PermissionsTable
  role_permissions: RolePermissionsTable
  user_roles: UserRolesTable
  audit_events: AuditEventsTable
  idempotency_records: IdempotencyRecordsTable
  rate_limit_windows: RateLimitWindowsTable
  legal_holds: LegalHoldsTable
  outbox_events: OutboxEventsTable
  email_deliveries: EmailDeliveriesTable
  email_provider_events: EmailProviderEventsTable
  email_suppressions: EmailSuppressionsTable
  investor_profiles: InvestorProfilesTable
  kyc_cases: KycCasesTable
  kyc_documents: KycDocumentsTable
  kyc_reviews: KycReviewsTable
  risk_assessments: RiskAssessmentsTable
  funds: FundsTable
  fund_versions: FundVersionsTable
  fund_disclosure_versions: FundDisclosureVersionsTable
  fund_aum_snapshots: FundAumSnapshotsTable
  aum_growth_batches: AumGrowthBatchesTable
  fund_stock_disclosures: FundStockDisclosuresTable
  finance_policy_versions: FinancePolicyVersionsTable
  marketing_leads: MarketingLeadsTable
  app_config_versions: AppConfigVersionsTable
  content_items: ContentItemsTable
  sip_plans: SipPlansTable
  investment_orders: InvestmentOrdersTable
  investment_reviews: InvestmentReviewsTable
  investment_allocations: InvestmentAllocationsTable
  client_growth_batches: ClientGrowthBatchesTable
  payments: PaymentsTable
  payment_attempts: PaymentAttemptsTable
  provider_payment_details: ProviderPaymentDetailsTable
  refund_operations: RefundOperationsTable
  provider_events: ProviderEventsTable
  client_value_entries: ClientValueEntriesTable
  notifications: NotificationsTable
  kyc_verification_codes: KycVerificationCodesTable
  support_requests: SupportRequestsTable
}
