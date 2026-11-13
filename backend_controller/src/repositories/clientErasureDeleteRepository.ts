import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import { unlinkedLoginEmails } from "./clientErasureWriteRepository.js"

export interface ClientDeletionInput {
  readonly userId: string
  readonly applicationId: string | null
  readonly emails: readonly string[]
}

export interface ClientErasureDeleteRepository {
  deleteClient: (tx: Transaction, input: ClientDeletionInput) => Promise<number>
}

const affected = (result: { readonly numAffectedRows?: bigint }): number => Number(result.numAffectedRows ?? 0n)

const mailIds = (input: ClientDeletionInput) => sql`
  select d.id from email_deliveries d
  where d.user_id = ${input.userId} or d.application_id = ${input.applicationId}::uuid
`

const ownedEntityIds = async (tx: Transaction, input: ClientDeletionInput): Promise<string[]> =>
  (
    await sql<{ readonly id: string }>`
      select id from support_requests where user_id = ${input.userId}
      union all select id from client_reviews where user_id = ${input.userId}
      union all select id from admin_sip_schedules where user_id = ${input.userId}
      union all select id from user_contact_history where user_id = ${input.userId}
      union all select id from auth_sessions where user_id = ${input.userId}
      union all select id from admin_email_messages where recipient_user_id = ${input.userId}
      union all select id from email_deliveries
        where user_id = ${input.userId} or application_id = ${input.applicationId}::uuid
      union all select id from applications where id = ${input.applicationId}::uuid
    `.execute(tx)
  ).rows.map((row) => row.id)

const deleteMail = async (tx: Transaction, input: ClientDeletionInput): Promise<number> => {
  const outboxIds = (
    await sql<{ readonly outbox_event_id: string }>`
      select d.outbox_event_id from email_deliveries d
      where d.id in (${mailIds(input)}) and d.outbox_event_id is not null
    `.execute(tx)
  ).rows.map((row) => row.outbox_event_id)
  const counts = [
    await sql`delete from admin_email_messages where recipient_user_id = ${input.userId}`.execute(tx),
    await sql`
      update email_provider_events
      set email_delivery_id = null, payload_ciphertext = null, payload_nonce = null, payload_key_version = null,
          erased_at = coalesce(erased_at, now())
      where (email_delivery_id in (${mailIds(input)}) or delivery_correlation_id in (${mailIds(input)}))
        and exists (select 1 from email_suppressions s where s.source_event_id = email_provider_events.id)
    `.execute(tx),
    await sql`
      delete from email_provider_events
      where (email_delivery_id in (${mailIds(input)}) or delivery_correlation_id in (${mailIds(input)}))
        and not exists (select 1 from email_suppressions s where s.source_event_id = email_provider_events.id)
    `.execute(tx),
    await sql`delete from email_delivery_payloads where email_delivery_id in (${mailIds(input)})`.execute(tx),
    await sql`delete from email_deliveries where id in (${mailIds(input)})`.execute(tx),
    await sql`delete from email_send_attempts where outbox_event_id = any(${outboxIds}::uuid[])`.execute(tx),
    await sql`delete from outbox_events where id = any(${outboxIds}::uuid[])`.execute(tx),
  ]
  return counts.reduce((total, result) => total + affected(result), 0)
}

const deleteIdentity = async (tx: Transaction, input: ClientDeletionInput): Promise<number> => {
  const counts = [
    await sql`update auth_refresh_tokens set replaced_by_token_id = null where user_id = ${input.userId}`.execute(tx),
    await sql`delete from auth_refresh_tokens where user_id = ${input.userId}`.execute(tx),
    await sql`delete from auth_sessions where user_id = ${input.userId}`.execute(tx),
    await sql`
      delete from auth_login_events
      where user_id = ${input.userId} or (${unlinkedLoginEmails(input.userId, input.emails)})
    `.execute(tx),
    await sql`delete from password_credential_tokens where user_id = ${input.userId}`.execute(tx),
    await sql`delete from email_verification_codes where user_id = ${input.userId}`.execute(tx),
    await sql`delete from email_change_requests where user_id = ${input.userId}`.execute(tx),
    await sql`delete from user_credentials where user_id = ${input.userId}`.execute(tx),
    await sql`delete from notifications where user_id = ${input.userId}`.execute(tx),
    await sql`delete from support_requests where user_id = ${input.userId}`.execute(tx),
    await sql`delete from client_reviews where user_id = ${input.userId}`.execute(tx),
    await sql`delete from admin_sip_schedules where user_id = ${input.userId}`.execute(tx),
    await sql`delete from user_contact_history where user_id = ${input.userId}`.execute(tx),
    await sql`
      delete from idempotency_records
      where actor_user_id = ${input.userId} or actor_scope = ${`user:${input.userId}`}
    `.execute(tx),
  ]
  return counts.reduce((total, result) => total + affected(result), 0)
}

const deleteAudit = async (tx: Transaction, input: ClientDeletionInput, entityIds: readonly string[]): Promise<number> =>
  affected(
    await sql`
      delete from audit_events
      where entity_id = ${input.userId}
         or actor_user_id = ${input.userId}
         or (metadata ? 'userId' and metadata->>'userId' = ${input.userId})
         or entity_id = any(${[...entityIds]}::uuid[])
    `.execute(tx),
  )

const deleteAccount = async (tx: Transaction, input: ClientDeletionInput): Promise<number> => {
  const counts = [
    await sql`delete from users where id = ${input.userId}`.execute(tx),
    await sql`delete from application_consents where application_id = ${input.applicationId}::uuid`.execute(tx),
    await sql`delete from application_reviews where application_id = ${input.applicationId}::uuid`.execute(tx),
    await sql`delete from applications where id = ${input.applicationId}::uuid`.execute(tx),
  ]
  return counts.reduce((total, result) => total + affected(result), 0)
}

export const createClientErasureDeleteRepository = (): ClientErasureDeleteRepository => ({
  deleteClient: async (tx, input) => {
    const entityIds = await ownedEntityIds(tx, input)
    const mail = await deleteMail(tx, input)
    const identity = await deleteIdentity(tx, input)
    const audit = await deleteAudit(tx, input, entityIds)
    const account = await deleteAccount(tx, input)
    return mail + identity + audit + account
  },
})
