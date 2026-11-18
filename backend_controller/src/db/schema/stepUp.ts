import type { Generated } from "kysely"

import type { Bytea, NullableTimestamp, Timestamp } from "./columns.js"

export interface AdminStepUpConfirmationsTable {
  id: Generated<string>
  user_id: string
  session_id: string
  action: string
  token_hash: Bytea
  token_key_version: string
  created_at: Timestamp
  expires_at: Timestamp
  consumed_at: NullableTimestamp
}
