import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { OwnedEntities } from "./clientErasureInspectRepository.js"
import { clientMailIds, providerEventsOfMail, unlinkedLoginEmails } from "./clientErasureWriteRepository.js"
import { auditAboutClient } from "./erasureScrubTargets.js"

export interface ClientDeletionInput {
  readonly userId: string
  readonly linkedApplicationId: string | null
  readonly applicationIds: readonly string[]
  readonly emails: readonly string[]
  readonly owned: OwnedEntities
}

export interface ClientErasureDeleteRepository {
  deleteClient: (tx: Transaction, input: ClientDeletionInput) => Promise<number>
}

const affected = (result: { readonly numAffectedRows?: bigint }): number => Number(result.numAffectedRows ?? 0n)

const total = (results: readonly { readonly numAffectedRows?: bigint }[]): number =>
  results.reduce((sum, result) => sum + affected(result), 0)

const suppressed = sql`exists (select 1 from email_suppressions s where s.source_event_id = email_provider_events.id)`

const deleteMail = async (tx: Transaction, input: ClientDeletionInput): Promise<number> => {
  const outboxIds = (
    await sql<{ readonly outbox_event_id: string }>`
      select d.outbox_event_id from email_deliveries d
      where d.id in (${clientMailIds(input)}) and d.outbox_event_id is not null
    `.execute(tx)
  ).rows.map((row) => row.outbox_event_id)
  return total([
    await sql`delete from admin_email_messages where recipient_user_id = ${input.userId}`.execute(tx),
    await sql`
      update email_provider_events
      set email_delivery_id = null, payload_ciphertext = null, payload_nonce = null, payload_key_version = null,
          erased_at = coalesce(erased_at, now())
      where ${providerEventsOfMail(input)} and ${suppressed}
    `.execute(tx),
    await sql`delete from email_provider_events where ${providerEventsOfMail(input)} and not ${suppressed}`.execute(tx),
    await sql`delete from email_delivery_payloads where email_delivery_id in (${clientMailIds(input)})`.execute(tx),
    await sql`delete from email_deliveries where id in (${clientMailIds(input)})`.execute(tx),
    await sql`delete from email_send_attempts where outbox_event_id = any(${outboxIds}::uuid[])`.execute(tx),
    await sql`delete from outbox_events where id = any(${outboxIds}::uuid[])`.execute(tx),
  ])
}

const deleteIdentity = async (tx: Transaction, input: ClientDeletionInput): Promise<number> =>
  total([
    await sql`update auth_refresh_tokens set replaced_by_token_id = null where user_id = ${input.userId}`.execute(tx),
    await sql`delete from auth_refresh_tokens where user_id = ${input.userId}`.execute(tx),
    await sql`delete from auth_sessions where user_id = ${input.userId}`.execute(tx),
    await sql`
      delete from auth_login_events
      where user_id = ${input.userId} or (${unlinkedLoginEmails(input.userId, input.emails)})
    `.execute(tx),
    await sql`delete from password_credential_tokens where user_id = ${input.userId}`.execute(tx),
    await sql`delete from client_statement_links where user_id = ${input.userId}`.execute(tx),
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
      where actor_scope = ${`user:${input.userId}`} or actor_user_id = ${input.userId}
    `.execute(tx),
  ])

const deleteAccount = async (tx: Transaction, input: ClientDeletionInput): Promise<number> =>
  total([
    await sql`delete from users where id = ${input.userId}`.execute(tx),
    await sql`delete from application_consents where application_id = any(${[...input.applicationIds]}::uuid[])`.execute(tx),
    await sql`delete from application_reviews where application_id = ${input.linkedApplicationId}::uuid`.execute(tx),
    await sql`delete from applications where id = ${input.linkedApplicationId}::uuid`.execute(tx),
  ])

export const createClientErasureDeleteRepository = (): ClientErasureDeleteRepository => ({
  deleteClient: async (tx, input) => {
    const mail = await deleteMail(tx, input)
    const identity = await deleteIdentity(tx, input)
    const audit = affected(
      await sql`
        delete from audit_events
        where ${auditAboutClient({ userId: input.userId, applicationIds: input.applicationIds, owned: input.owned })}
      `.execute(tx),
    )
    const account = await deleteAccount(tx, input)
    return mail + identity + audit + account
  },
})
