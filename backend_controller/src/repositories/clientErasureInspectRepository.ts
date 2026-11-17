import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { UserAccountState } from "../db/types.js"

export const ERASURE_COMMAND = "client.erased"

export type ErasureBlockerCode =
  | "staff_account"
  | "legal_hold"
  | "holds_money"
  | "open_orders"
  | "open_payments"
  | "open_refunds"
  | "open_withdrawals"
  | "failed_withdrawals"
  | "unsettled_maturities"
  | "active_sip_schedules"
  | "scheduled_maturities"
  | "open_maturity_offers"
  | "active_sip_plans"
  | "mail_in_flight"

export type ErasureBlockerCounts = Readonly<Record<ErasureBlockerCode, number>>

export interface ErasureSubject {
  readonly id: string
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly fullName: string
  readonly nomineeName: string | null
  readonly accountState: UserAccountState
  readonly applicationId: string | null
  readonly piiTombstonedAt: Date | null
  readonly emailVerified: boolean
  readonly version: number
}

export interface PriorErasure {
  readonly erasedAt: Date
  readonly metadata: unknown
}

export interface ContactSources {
  readonly emails: readonly string[]
  readonly phones: readonly string[]
  readonly names: readonly string[]
  readonly sealedRecipients: readonly Readonly<{ ciphertext: Buffer; nonce: Buffer; keyVersion: string }>[]
}

export interface OwnedEntities {
  readonly types: readonly string[]
  readonly ids: readonly string[]
}

export interface ErasureReach {
  readonly applicationIds: readonly string[]
  readonly owned: OwnedEntities
}

export interface HeldContacts {
  readonly emails: readonly string[]
  readonly phones: readonly string[]
}

export interface ClientErasureInspectRepository {
  findSubject: (tx: Transaction, userId: string, lock: boolean) => Promise<ErasureSubject | null>
  findPriorErasure: (tx: Transaction, userId: string) => Promise<PriorErasure | null>
  collectContactSources: (tx: Transaction, subject: ErasureSubject) => Promise<ContactSources>
  findHeldContacts: (tx: Transaction, userId: string, contacts: HeldContacts) => Promise<HeldContacts>
  findMatchedApplications: (tx: Transaction, subject: ErasureSubject, emails: readonly string[]) => Promise<readonly string[]>
  listOwnedEntities: (
    tx: Transaction,
    subject: Pick<ErasureSubject, "id">,
    applicationIds: readonly string[],
  ) => Promise<OwnedEntities>
  countBlockers: (tx: Transaction, subject: ErasureSubject, reach: ErasureReach) => Promise<ErasureBlockerCounts>
  listActiveHoldEntityIds: (tx: Transaction, entityType: string) => Promise<readonly string[]>
  hasMoneyRecords: (tx: Transaction, userId: string) => Promise<boolean>
  listLedgerFunds: (tx: Transaction, userId: string) => Promise<readonly string[]>
}

interface SubjectRow {
  readonly id: string
  readonly email_normalized: string
  readonly phone_e164: string
  readonly full_name: string
  readonly nominee_name: string | null
  readonly account_state: UserAccountState
  readonly application_id: string | null
  readonly pii_tombstoned_at: Date | null
  readonly email_verified: boolean
  readonly version: string
}

type CountRow = Readonly<Record<ErasureBlockerCode, number>>

const uuids = (values: readonly string[]) => sql`${[...values]}::uuid[]`

const subjectQuery = (userId: string, lock: boolean) => sql<SubjectRow>`
  select u.id, u.email_normalized, u.phone_e164, u.full_name, u.nominee_name, u.account_state,
         u.application_id, u.pii_tombstoned_at, u.version::text as version,
         (u.email_verification_state = 'verified'
          or u.email_verified_at is not null
          or exists (
            select 1 from audit_events a
            where a.entity_type = 'user' and a.entity_id = u.id and a.command = 'email_verification.completed'
          )) as email_verified
  from users u
  where u.id = ${userId}
  ${lock ? sql`for update of u` : sql``}
`

const activeHold = sql`h.released_at is null and (h.expires_at is null or h.expires_at > now())`

const heldQuery = (subject: ErasureSubject, reach: ErasureReach) => sql`
  select count(*) from legal_holds h
  where ${activeHold}
    and (
      h.entity_id = any(${uuids(reach.owned.ids)})
      or exists (
        select 1 from email_provider_events p
        join email_deliveries d on d.id = p.email_delivery_id
        where p.id = h.entity_id and (d.user_id = ${subject.id} or d.application_id = any(${uuids(reach.applicationIds)}))
      )
      or exists (
        select 1 from audit_events a
        where a.id = h.entity_id
          and ((a.entity_type = any(${[...reach.owned.types]}::text[]) and a.entity_id = any(${uuids(reach.owned.ids)}))
               or a.actor_user_id = ${subject.id}
               or (a.metadata ? 'userId' and a.metadata->>'userId' = ${subject.id}))
      )
    )
`

const blockerQuery = (subject: ErasureSubject, reach: ErasureReach) => sql<CountRow>`
  with funds as (
    select e.fund_id, sum(e.principal_delta_paise) as principal, sum(e.value_delta_paise) as value
    from client_value_entries e
    where e.user_id = ${subject.id}
      and e.entry_type <> 'reversal'
      and not exists (select 1 from client_value_entries r where r.reverses_entry_id = e.id)
    group by e.fund_id
  ),
  mail as (
    select d.state as delivery_state, o.state as outbox_state
    from email_deliveries d
    left join outbox_events o on o.id = d.outbox_event_id
    where d.user_id = ${subject.id} or d.application_id = any(${uuids(reach.applicationIds)})
  )
  select
    (select count(*) from user_roles where user_id = ${subject.id})::int as staff_account,
    (${heldQuery(subject, reach)})::int as legal_hold,
    (select count(*) from funds where principal <> 0 or value <> 0)::int as holds_money,
    (select count(*) from investment_orders
      where user_id = ${subject.id}
        and state in ('submitted', 'payment_pending', 'review_pending', 'refund_pending', 'refund_failed'))::int as open_orders,
    ((select count(*) from payments
       where user_id = ${subject.id}
         and state in ('created', 'provider_pending', 'refund_pending', 'refund_failed', 'reconciliation_required'))
     + (select count(*) from payment_attempts
         where user_id = ${subject.id} and state in ('created', 'provider_pending', 'reconciliation_required'))
     + (select count(*) from provider_events
         where user_id = ${subject.id} and state in ('received', 'processing')))::int as open_payments,
    (select count(*) from refund_operations r
      join investment_orders o on o.id = r.order_id
      where o.user_id = ${subject.id} and r.state in ('pending', 'provider_pending'))::int as open_refunds,
    (select count(*) from withdrawal_operations
      where user_id = ${subject.id} and state = 'pending')::int as open_withdrawals,
    (select count(*) from withdrawal_operations
      where user_id = ${subject.id} and state = 'failed')::int as failed_withdrawals,
    (select count(*) from client_position_maturities
      where user_id = ${subject.id} and state = 'pending')::int as unsettled_maturities,
    (select count(*) from admin_sip_schedules
      where user_id = ${subject.id} and state = 'active')::int as active_sip_schedules,
    (select count(*) from client_maturity_schedules
      where user_id = ${subject.id} and state = 'scheduled')::int as scheduled_maturities,
    (select count(*) from client_maturity_offers
      where user_id = ${subject.id} and state = 'open')::int as open_maturity_offers,
    (select count(*) from sip_plans
      where user_id = ${subject.id}
        and state in ('draft', 'pending_mandate', 'active', 'paused', 'cancel_pending'))::int as active_sip_plans,
    (select count(*) from mail
      where delivery_state = 'sending' or outbox_state in ('processing', 'sending'))::int as mail_in_flight
`

const moneyRecordsQuery = (userId: string) => sql<{ readonly present: boolean }>`
  select (
    exists (select 1 from client_value_entries where user_id = ${userId})
    or exists (select 1 from investment_orders where user_id = ${userId})
    or exists (select 1 from investment_allocations where user_id = ${userId})
    or exists (select 1 from payments where user_id = ${userId})
    or exists (select 1 from payment_attempts where user_id = ${userId})
    or exists (select 1 from provider_payment_details where user_id = ${userId})
    or exists (select 1 from provider_events where user_id = ${userId})
    or exists (select 1 from withdrawal_operations where user_id = ${userId})
    or exists (select 1 from client_position_maturities where user_id = ${userId})
    or exists (select 1 from client_maturity_schedules where user_id = ${userId})
    or exists (select 1 from client_maturity_offers where user_id = ${userId})
    or exists (select 1 from admin_sip_schedule_months where user_id = ${userId})
    or exists (select 1 from sip_early_exits where user_id = ${userId})
    or exists (select 1 from sip_plans where user_id = ${userId})
  ) as present
`

const contactTextQuery = (subject: ErasureSubject) => sql<{ readonly kind: string; readonly value: string }>`
  select 'email' as kind, previous_email_normalized as value from user_contact_history where user_id = ${subject.id}
  union select 'email', new_email_normalized from user_contact_history where user_id = ${subject.id}
  union select 'phone', previous_phone_e164 from user_contact_history where user_id = ${subject.id}
  union select 'phone', new_phone_e164 from user_contact_history where user_id = ${subject.id}
  union select 'email', email_normalized from auth_login_events where user_id = ${subject.id}
  union select 'email', email_normalized from applications where id = ${subject.applicationId}::uuid
  union select 'phone', phone_e164 from applications where id = ${subject.applicationId}::uuid
  union select 'name', full_name from applications where id = ${subject.applicationId}::uuid
  union select 'name', nominee_name from client_nominee_requests where user_id = ${subject.id}
`

const sealedRecipientQuery = (subject: ErasureSubject) => sql<{
  readonly ciphertext: Buffer
  readonly nonce: Buffer
  readonly key_version: string
}>`
  select recipient_ciphertext as ciphertext, recipient_nonce as nonce, recipient_encryption_key_version as key_version
  from email_deliveries
  where (user_id = ${subject.id} or application_id = ${subject.applicationId}::uuid)
    and recipient_ciphertext is not null
  union all
  select target_ciphertext, target_nonce, target_key_version
  from email_change_requests
  where user_id = ${subject.id}
`

const ownedEntityQuery = (subject: Pick<ErasureSubject, "id">, applicationIds: readonly string[]) => sql<{
  readonly entity_type: string
  readonly id: string
}>`
  select 'user' as entity_type, ${subject.id}::uuid as id
  union all select 'application', unnest(${uuids(applicationIds)})
  union all select 'support_request', id from support_requests where user_id = ${subject.id}
  union all select 'client_review', id from client_reviews where user_id = ${subject.id}
  union all select 'client_nominee_request', id from client_nominee_requests where user_id = ${subject.id}
  union all select 'admin_sip_schedule', id from admin_sip_schedules where user_id = ${subject.id}
  union all select 'sip_early_exit', id from sip_early_exits where user_id = ${subject.id}
  union all select 'client_maturity_schedule', id from client_maturity_schedules where user_id = ${subject.id}
  union all select 'client_maturity_offer', id from client_maturity_offers where user_id = ${subject.id}
  union all select 'auth_session', id from auth_sessions where user_id = ${subject.id}
  union all select 'user_contact_history', id from user_contact_history where user_id = ${subject.id}
  union all select 'admin_email_message', id from admin_email_messages where recipient_user_id = ${subject.id}
  union all select 'email_delivery', id from email_deliveries
    where user_id = ${subject.id} or application_id = any(${uuids(applicationIds)})
  union all select 'client_value_entry', id from client_value_entries where user_id = ${subject.id}
  union all select 'investment_order', id from investment_orders where user_id = ${subject.id}
  union all select 'payment', id from payments where user_id = ${subject.id}
  union all select 'payment_attempt', id from payment_attempts where user_id = ${subject.id}
  union all select 'withdrawal_operation', id from withdrawal_operations where user_id = ${subject.id}
  union all select 'client_position_maturity', id from client_position_maturities where user_id = ${subject.id}
  union all select 'sip_plan', id from sip_plans where user_id = ${subject.id}
  union all select 'refund_operation', r.id from refund_operations r
    join investment_orders o on o.id = r.order_id where o.user_id = ${subject.id}
  union all select 'fund_receipt_acknowledgement', f.id from fund_receipt_acknowledgements f
    join investment_orders o on o.id = f.order_id where o.user_id = ${subject.id}
`

const toSubject = (row: SubjectRow): ErasureSubject => ({
  id: row.id,
  emailNormalized: row.email_normalized,
  phoneE164: row.phone_e164,
  fullName: row.full_name,
  nomineeName: row.nominee_name,
  accountState: row.account_state,
  applicationId: row.application_id,
  piiTombstonedAt: row.pii_tombstoned_at === null ? null : new Date(row.pii_tombstoned_at),
  emailVerified: row.email_verified,
  version: Number(row.version),
})

export const createClientErasureInspectRepository = (): ClientErasureInspectRepository => ({
  findSubject: async (tx, userId, lock) => {
    const row = (await subjectQuery(userId, lock).execute(tx)).rows[0]
    return row === undefined ? null : toSubject(row)
  },

  findPriorErasure: async (tx, userId) => {
    const row = (
      await sql<{ readonly occurred_at: Date; readonly metadata: unknown }>`
        select occurred_at, metadata from audit_events
        where entity_type = 'user' and entity_id = ${userId} and command = ${ERASURE_COMMAND}
        order by occurred_at asc, id asc
        limit 1
      `.execute(tx)
    ).rows[0]
    return row === undefined ? null : { erasedAt: new Date(row.occurred_at), metadata: row.metadata }
  },

  collectContactSources: async (tx, subject) => {
    const texts = (await contactTextQuery(subject).execute(tx)).rows
    const sealed = (await sealedRecipientQuery(subject).execute(tx)).rows
    const of = (kind: string): string[] => texts.filter((row) => row.kind === kind).map((row) => row.value)
    return {
      emails: [subject.emailNormalized, ...of("email")],
      phones: [subject.phoneE164, ...of("phone")],
      names: [subject.fullName, ...(subject.nomineeName === null ? [] : [subject.nomineeName]), ...of("name")],
      sealedRecipients: sealed.map((row) => ({ ciphertext: row.ciphertext, nonce: row.nonce, keyVersion: row.key_version })),
    }
  },

  findHeldContacts: async (tx, userId, contacts) => {
    const rows = (
      await sql<{ readonly email_normalized: string; readonly phone_e164: string }>`
        select email_normalized, phone_e164 from users
        where id <> ${userId}
          and (email_normalized = any(${[...contacts.emails]}::text[]) or phone_e164 = any(${[...contacts.phones]}::text[]))
      `.execute(tx)
    ).rows
    return {
      emails: contacts.emails.filter((email) => rows.some((row) => row.email_normalized === email)),
      phones: contacts.phones.filter((phone) => rows.some((row) => row.phone_e164 === phone)),
    }
  },

  findMatchedApplications: async (tx, subject, emails) =>
    (
      await sql<{ readonly id: string }>`
        select a.id from applications a
        where a.state <> 'submitted'
          and a.email_normalized = any(${[...emails]}::text[])
          and a.id is distinct from ${subject.applicationId}::uuid
          and not exists (select 1 from users holder where holder.application_id = a.id and holder.id <> ${subject.id})
        order by a.id
      `.execute(tx)
    ).rows.map((row) => row.id),

  listOwnedEntities: async (tx, subject, applicationIds) => {
    const rows = (await ownedEntityQuery(subject, applicationIds).execute(tx)).rows
    return { types: [...new Set(rows.map((row) => row.entity_type))], ids: rows.map((row) => row.id) }
  },

  countBlockers: async (tx, subject, reach) => {
    const row = (await blockerQuery(subject, reach).execute(tx)).rows[0]
    if (row === undefined) throw new Error("erasure blocker query returned no row")
    return row
  },

  listActiveHoldEntityIds: async (tx, entityType) =>
    (
      await sql<{ readonly entity_id: string }>`
        select h.entity_id from legal_holds h where h.entity_type = ${entityType} and ${activeHold}
      `.execute(tx)
    ).rows.map((row) => row.entity_id),

  hasMoneyRecords: async (tx, userId) => (await moneyRecordsQuery(userId).execute(tx)).rows[0]?.present ?? true,

  listLedgerFunds: async (tx, userId) =>
    (
      await sql<{ readonly fund_id: string }>`
        select distinct fund_id from client_value_entries where user_id = ${userId} order by fund_id
      `.execute(tx)
    ).rows.map((row) => row.fund_id),
})
