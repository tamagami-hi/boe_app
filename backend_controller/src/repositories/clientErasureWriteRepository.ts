import { sql } from "kysely"

import type { Transaction, User } from "../db/repositories.js"
import {
  ERASED_HISTORY_NEW_PHONE,
  ERASED_HISTORY_PREVIOUS_PHONE,
  ERASED_NAME,
  ERASED_PHONE,
  type ContactScrubber,
} from "../domain/admin/erasureContacts.js"

export interface MailReach {
  readonly userId: string
  readonly applicationIds: readonly string[]
}

export interface TombstoneUserInput {
  readonly userId: string
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly now: Date
}

export interface MailErasureInput extends MailReach {
  readonly recipientHmac: Buffer
  readonly recipientMasked: string
  readonly now: Date
}

export interface SealedTarget {
  readonly ciphertext: Buffer
  readonly nonce: Buffer
  readonly keyVersion: string
}

export interface ContactRewriteInput {
  readonly userId: string
  readonly erasedEmail: string
  readonly scrubber: ContactScrubber
}

export interface ClientErasureWriteRepository {
  markErasing: (tx: Transaction, userId: string) => Promise<void>
  lockMail: (tx: Transaction, reach: MailReach) => Promise<number>
  tombstoneUser: (tx: Transaction, input: TombstoneUserInput) => Promise<User | null>
  clearPassword: (tx: Transaction, userId: string, now: Date) => Promise<void>
  deleteStatementLinks: (tx: Transaction, userId: string) => Promise<void>
  overwriteEmailChangeTargets: (tx: Transaction, userId: string, target: SealedTarget) => Promise<void>
  eraseMail: (tx: Transaction, input: MailErasureInput) => Promise<number>
  rewriteContactHistory: (tx: Transaction, input: ContactRewriteInput) => Promise<number>
  overwriteLoginEmails: (tx: Transaction, input: ContactRewriteInput) => Promise<number>
  tombstoneApplications: (
    tx: Transaction,
    input: Readonly<{ applicationIds: readonly string[]; erasedEmail: string; now: Date }>,
  ) => Promise<number>
  eraseProviderEventPayloads: (tx: Transaction, userId: string, now: Date) => Promise<number>
  clearConsentUserAgents: (tx: Transaction, applicationIds: readonly string[]) => Promise<number>
}

const affected = (result: { readonly numAffectedRows?: bigint }): number => Number(result.numAffectedRows ?? 0n)

export const clientMailIds = (reach: MailReach) => sql`
  select d.id from email_deliveries d
  where d.user_id = ${reach.userId} or d.application_id = any(${[...reach.applicationIds]}::uuid[])
`

export const providerEventsOfMail = (reach: MailReach) => sql`
  (email_delivery_id in (${clientMailIds(reach)})
   or (state = 'unmatched' and delivery_correlation_id in (${clientMailIds(reach)})))
`

export const unlinkedLoginEmails = (userId: string, emails: readonly string[]) => sql`
  user_id is null
  and email_normalized = any(${[...emails]}::text[])
  and not exists (
    select 1 from users other
    where other.email_normalized = auth_login_events.email_normalized and other.id <> ${userId}
  )
`

const cancelQueuedMail = async (tx: Transaction, input: MailErasureInput): Promise<number> => {
  const deliveries = await sql`
    update email_deliveries
    set state = 'cancelled', cancelled_at = ${input.now}, updated_at = ${input.now}, version = version + 1
    where id in (${clientMailIds(input)}) and state in ('queued', 'retryable_failed')
  `.execute(tx)
  await sql`
    update outbox_events
    set state = 'cancelled', cancelled_at = ${input.now}, updated_at = ${input.now}
    where state in ('pending', 'retryable_failed')
      and id in (select d.outbox_event_id from email_deliveries d where d.id in (${clientMailIds(input)}))
  `.execute(tx)
  return affected(deliveries)
}

export const createClientErasureWriteRepository = (): ClientErasureWriteRepository => ({
  markErasing: async (tx, userId) => {
    await sql`select set_config('boe.erasing_user_id', ${userId}, true)`.execute(tx)
  },

  lockMail: async (tx, reach) => {
    const deliveries = (
      await sql<{ readonly state: string; readonly outbox_event_id: string | null }>`
        select state, outbox_event_id from email_deliveries
        where id in (${clientMailIds(reach)})
        order by id
        for update
      `.execute(tx)
    ).rows
    const outbox = (
      await sql<{ readonly state: string }>`
        select state from outbox_events
        where id = any(${deliveries.flatMap((row) => (row.outbox_event_id === null ? [] : [row.outbox_event_id]))}::uuid[])
        order by id
        for update
      `.execute(tx)
    ).rows
    return (
      deliveries.filter((row) => row.state === "sending").length +
      outbox.filter((row) => row.state === "processing" || row.state === "sending").length
    )
  },

  tombstoneUser: async (tx, input) =>
    (
      await sql<User>`
        update users set
          email_normalized = ${input.emailNormalized},
          phone_e164 = ${input.phoneE164},
          full_name = ${ERASED_NAME},
          pii_tombstoned_at = ${input.now},
          account_state = case when account_state = 'invited' then account_state else 'closed' end,
          closed_at = case when account_state = 'invited' then closed_at else coalesce(closed_at, ${input.now}) end,
          email_revision = email_revision + 1,
          updated_at = ${input.now},
          version = version + 1
        where id = ${input.userId}
        returning *
      `.execute(tx)
    ).rows[0] ?? null,

  clearPassword: async (tx, userId, now) => {
    await sql`
      update user_credentials
      set password_hash = null, failed_attempt_count = 0, failed_attempt_window_started_at = null, locked_until = null,
          updated_at = ${now}, version = version + 1
      where user_id = ${userId}
    `.execute(tx)
  },

  deleteStatementLinks: async (tx, userId) => {
    await sql`delete from client_statement_links where user_id = ${userId}`.execute(tx)
  },

  overwriteEmailChangeTargets: async (tx, userId, target) => {
    await sql`
      update email_change_requests
      set target_ciphertext = ${target.ciphertext}, target_nonce = ${target.nonce}, target_key_version = ${target.keyVersion}
      where user_id = ${userId}
    `.execute(tx)
  },

  eraseMail: async (tx, input) => {
    const cancelled = await cancelQueuedMail(tx, input)
    await sql`
      update email_deliveries set
        recipient_ciphertext = null,
        recipient_nonce = null,
        recipient_encryption_key_version = null,
        recipient_hmac = ${input.recipientHmac},
        recipient_masked = ${input.recipientMasked},
        failure_detail_ciphertext = null,
        failure_detail_nonce = null,
        failure_detail_key_version = null,
        erased_at = coalesce(erased_at, ${input.now}),
        updated_at = ${input.now},
        version = version + 1
      where id in (${clientMailIds(input)})
    `.execute(tx)
    await sql`
      update email_delivery_payloads
      set ciphertext = null, nonce = null, scrubbed_at = coalesce(scrubbed_at, ${input.now})
      where email_delivery_id in (${clientMailIds(input)})
    `.execute(tx)
    await sql`
      update email_provider_events
      set payload_ciphertext = null, payload_nonce = null, payload_key_version = null,
          erased_at = coalesce(erased_at, ${input.now})
      where ${providerEventsOfMail(input)}
    `.execute(tx)
    return cancelled
  },

  rewriteContactHistory: async (tx, input) => {
    const rows = (
      await sql<{ readonly id: string; readonly reason_detail: string | null }>`
        select id, reason_detail from user_contact_history where user_id = ${input.userId} order by id for update
      `.execute(tx)
    ).rows
    for (const row of rows) {
      const detail =
        row.reason_detail !== null && input.scrubber.mentions(row.reason_detail) ? null : row.reason_detail
      await sql`
        update user_contact_history set
          previous_email_normalized = ${input.erasedEmail},
          new_email_normalized = ${input.erasedEmail},
          previous_phone_e164 = ${ERASED_HISTORY_PREVIOUS_PHONE},
          new_phone_e164 = ${ERASED_HISTORY_NEW_PHONE},
          reason_detail = ${detail}
        where id = ${row.id}
      `.execute(tx)
    }
    return rows.length
  },

  overwriteLoginEmails: async (tx, input) =>
    affected(
      await sql`
        update auth_login_events set email_normalized = ${input.erasedEmail}
        where user_id = ${input.userId}
           or (${unlinkedLoginEmails(input.userId, input.scrubber.emails)})
      `.execute(tx),
    ),

  tombstoneApplications: async (tx, input) =>
    affected(
      await sql`
        update applications set
          email_normalized = ${input.erasedEmail},
          phone_e164 = ${ERASED_PHONE},
          full_name = ${ERASED_NAME},
          password_hash = null,
          pii_tombstoned_at = coalesce(pii_tombstoned_at, ${input.now}),
          updated_at = ${input.now},
          version = version + 1
        where id = any(${[...input.applicationIds]}::uuid[]) and state <> 'submitted'
      `.execute(tx),
    ),

  clearConsentUserAgents: async (tx, applicationIds) =>
    affected(
      await sql`
        update application_consents set user_agent = null
        where application_id = any(${[...applicationIds]}::uuid[]) and user_agent is not null
      `.execute(tx),
    ),

  eraseProviderEventPayloads: async (tx, userId, now) =>
    affected(
      await sql`
        update provider_events
        set payload_ciphertext = null, payload_nonce = null, payload_key_version = null,
            erased_at = coalesce(erased_at, ${now}), updated_at = ${now}, version = version + 1
        where user_id = ${userId} and payload_ciphertext is not null
      `.execute(tx),
    ),
})
