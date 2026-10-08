import type { Generated } from "kysely"
import type { BigIntString, BigIntStringDefault, Bytea, Json, JsonDefault, Nullable, NullableTimestamp, Timestamp, TimestampDefault } from "./columns.js"

export type ActorType = "public" | "user" | "admin" | "system" | "provider"

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

export interface WorkerHeartbeatsTable {
  id: Generated<string>
  worker_name: string
  pass_started_at: Timestamp
  pass_completed_at: Timestamp
  success: boolean
  summary: JsonDefault
  error_code: Nullable<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
  version: BigIntStringDefault
}
