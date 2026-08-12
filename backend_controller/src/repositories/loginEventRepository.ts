/**
 * Append-only sign-in attempt log (migration 026).
 *
 * Separate from `auditRepository` on purpose. Audit rows describe state
 * transitions and are written inside the command's transaction; a *failed*
 * sign-in transitions nothing and must not open a transaction or take a lock —
 * otherwise a burst of wrong-password attempts against one account serializes
 * against itself. So `record` is called with the pool handle on the failure path
 * and with the session transaction on the success path, and `Transaction` (which
 * is `Kysely<Database>`) covers both.
 *
 * Nothing here stores a password, a hash, or a token.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { AuthLoginOutcome, SessionChannel } from "../db/types.js"
import { normalizeIpAddress, sanitizeUserAgent } from "../http/requestProvenance.js"

export interface RecordLoginEventInput {
  /** Null when the submitted address has no account. */
  readonly userId?: string | null
  readonly emailNormalized: string
  readonly channel: SessionChannel
  readonly outcome: AuthLoginOutcome
  /** Set only on `success`; a CHECK constraint enforces that. */
  readonly sessionId?: string | null
  readonly deviceIdHash?: Buffer | null
  readonly ipAddress?: string | null
  readonly userAgent?: string | null
  readonly requestId: string
}

export interface LoginEventRow {
  readonly id: string
  readonly occurredAt: Date
  readonly createdAt: Date
  readonly userId: string | null
  readonly email: string
  readonly channel: SessionChannel
  readonly outcome: AuthLoginOutcome
  readonly sessionId: string | null
  readonly ipAddress: string | null
  readonly userAgent: string | null
  readonly requestId: string
}

export interface LoginEventPageQuery {
  readonly userId: string
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  readonly limit: number
}

export interface LoginEventRepository {
  record: (db: Transaction, input: RecordLoginEventInput) => Promise<void>
  listForUser: (db: Transaction, query: LoginEventPageQuery) => Promise<readonly LoginEventRow[]>
}

export const createLoginEventRepository = (): LoginEventRepository => ({
  record: async (db, input) => {
    await db
      .insertInto("auth_login_events")
      .values({
        user_id: input.userId ?? null,
        email_normalized: input.emailNormalized.toLowerCase(),
        channel: input.channel,
        outcome: input.outcome,
        session_id: input.sessionId ?? null,
        device_id_hash: input.deviceIdHash ?? null,
        ip_address: normalizeIpAddress(input.ipAddress),
        user_agent: sanitizeUserAgent(input.userAgent),
        request_id: input.requestId,
      })
      .execute()
  },

  listForUser: async (db, query) => {
    // `auth_login_events` has no `created_at`; `occurred_at` is its append
    // timestamp, and the keyset cursor plumbing is shared with the other admin
    // lists, hence the `createdAt` alias.
    //
    // `users` is LEFT joined because the log outlives its subject: the table has
    // no foreign keys (see migration 026), so an INNER JOIN would make any row
    // whose user is gone permanently unreadable while the row itself persists.
    const keysetClause =
      query.afterCreatedAt !== undefined && query.afterId !== undefined
        ? sql`and (e.occurred_at < ${query.afterCreatedAt}
            or (e.occurred_at = ${query.afterCreatedAt} and e.id < ${query.afterId}))`
        : sql``
    const result = await sql<LoginEventRow>`
      select
        e.id as "id",
        e.occurred_at as "occurredAt",
        e.occurred_at as "createdAt",
        e.user_id as "userId",
        -- Masked for a tombstoned user, matching the admin user projection.
        case
          when u.id is null then e.email_normalized
          when u.pii_tombstoned_at is null then e.email_normalized
          else 'tombstone+' || replace(u.id::text, '-', '') || '@invalid.example'
        end as "email",
        e.channel as "channel",
        e.outcome as "outcome",
        e.session_id as "sessionId",
        host(e.ip_address) as "ipAddress",
        e.user_agent as "userAgent",
        e.request_id as "requestId"
      from auth_login_events e
      left join users u on u.id = e.user_id
      where e.user_id = ${query.userId} ${keysetClause}
      order by e.occurred_at desc, e.id desc
      limit ${query.limit}
    `.execute(db)
    return result.rows
  },
})
