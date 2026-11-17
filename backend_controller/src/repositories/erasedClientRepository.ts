import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import { ERASURE_COMMAND } from "./clientErasureInspectRepository.js"

export interface ErasedClientRepository {
  listErasedClients: (tx: Transaction) => Promise<readonly string[]>
  listErasedApplications: (tx: Transaction, userId: string, erasedEmail: string) => Promise<readonly string[]>
  clearHistoryReasons: (tx: Transaction, userId: string, mentions: (text: string) => boolean) => Promise<readonly string[]>
}

export const createErasedClientRepository = (): ErasedClientRepository => ({
  listErasedClients: async (tx) =>
    (
      await sql<{ readonly entity_id: string }>`
        select distinct entity_id from audit_events
        where entity_type = 'user' and command = ${ERASURE_COMMAND}
        order by entity_id
      `.execute(tx)
    ).rows.map((row) => row.entity_id),

  listErasedApplications: async (tx, userId, erasedEmail) =>
    (
      await sql<{ readonly id: string }>`
        select application_id as id from users where id = ${userId} and application_id is not null
        union
        select id from applications where email_normalized = ${erasedEmail}
        order by id
      `.execute(tx)
    ).rows.map((row) => row.id),

  clearHistoryReasons: async (tx, userId, mentions) => {
    const rows = (
      await sql<{ readonly id: string; readonly reason_detail: string }>`
        select id, reason_detail from user_contact_history
        where user_id = ${userId} and reason_detail is not null
        order by id
        for update
      `.execute(tx)
    ).rows
    const cleared = rows.filter((row) => mentions(row.reason_detail)).map((row) => row.id)
    if (cleared.length > 0) {
      await sql`update user_contact_history set reason_detail = null where id = any(${cleared}::uuid[])`.execute(tx)
    }
    return cleared
  },
})
