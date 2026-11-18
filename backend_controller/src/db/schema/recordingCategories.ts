import type { Generated } from "kysely"

import type { TimestampDefault } from "./columns.js"

export type StoredRecordingCategory = "one_time"

export interface ClientValueEntryCategoriesTable {
  id: Generated<string>
  entry_id: string
  user_id: string
  fund_id: string
  category: StoredRecordingCategory
  set_by_user_id: string
  request_id: string
  created_at: TimestampDefault
}
