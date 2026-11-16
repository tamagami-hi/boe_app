import type { Generated } from "kysely"

import type { NullableTimestamp, TimestampDefault } from "./columns.js"

export type NomineeRequestState = "pending" | "accepted" | "declined" | "withdrawn"

export interface ClientNomineeRequestsTable {
  id: Generated<string>
  user_id: string
  nominee_name: string
  nominee_relation: string
  state: Generated<NomineeRequestState>
  decline_reason: string | null
  decided_by_user_id: string | null
  decided_at: NullableTimestamp
  version: Generated<string>
  created_at: TimestampDefault
  updated_at: TimestampDefault
}
