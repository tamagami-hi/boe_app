import type { Generated } from "kysely"
import type { BigIntString, BigIntStringDefault, Bytea, Nullable, NullableBigIntString, NullableBytea, NullableTimestamp, Timestamp, TimestampDefault } from "./columns.js"

export type ApplicationState = "submitted" | "approved" | "rejected" | "withdrawn"

export type UserAccountState = "invited" | "active" | "suspended" | "closed"

export type ApplicationDecision = "approved" | "rejected"

export type SessionChannel = "native" | "web" | "client_web" | "admin_native"

/** The two cookie transports. Each requires a synchronizer CSRF pair. */
export type CookieSessionChannel = Extract<SessionChannel, "web" | "client_web">

/** The two bearer transports. Each forbids CSRF material and carries a device. */
export type BearerSessionChannel = Exclude<SessionChannel, CookieSessionChannel>

export type AuthSessionState = "active" | "revoked" | "expired"

export type AuthLoginOutcome =
  | "success"
  | "invalid_credentials"
  | "unknown_identity"
  | "account_not_active"
  | "password_changed"
  | "not_authorized"

export type ConsentKind = "terms" | "privacy"

export type EmailVerificationState = "not_started" | "pending" | "verified"

export type PasswordTokenPurpose = "set" | "reset"

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
  email_revision: BigIntStringDefault
  phone_e164: string
  full_name: string
  email_verification_state: Generated<EmailVerificationState>
  email_verification_started_at: NullableTimestamp
  email_verified_at: NullableTimestamp
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

export interface EmailVerificationCodesTable {
  id: Generated<string>
  user_id: string
  code_hash: Bytea
  code_key_version: string
  attempt_count: Generated<number>
  expires_at: Timestamp
  consumed_at: NullableTimestamp
  created_at: TimestampDefault
}

export interface PasswordCredentialTokensTable {
  id: Generated<string>
  user_id: string
  purpose: PasswordTokenPurpose
  token_hash: Bytea
  token_key_version: string
  attempt_count: Generated<number>
  expires_at: Timestamp
  consumed_at: NullableTimestamp
  created_at: TimestampDefault
  bound_email_revision: NullableBigIntString
  bound_credential_version: NullableBigIntString
}

export interface EmailChangeRequestsTable {
  id: Generated<string>
  user_id: string
  target_ciphertext: Bytea
  target_nonce: Bytea
  target_key_version: string
  code_hash: Bytea
  code_key_version: string
  bound_email_revision: BigIntString
  bound_credential_version: BigIntString
  attempt_count: Generated<number>
  expires_at: Timestamp
  created_at: TimestampDefault
  consumed_at: NullableTimestamp
}
