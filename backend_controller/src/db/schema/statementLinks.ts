import type { Bytea, NullableTimestamp, Timestamp, TimestampDefault } from "./columns.js"

export interface ClientStatementLinksTable {
  user_id: string
  token_hash: Bytea
  token_key_version: string
  from_period: string
  to_period: string
  expires_at: Timestamp
  consumed_at: NullableTimestamp
  created_at: TimestampDefault
}
