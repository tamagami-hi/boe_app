/**
 * Client account read/write repository: the surfaces the app needs beside the
 * money model — the notification inbox, the payment history, support requests,
 * and the published content documents (FAQs, disclosures, investor charter,
 * grievance policy, research context).
 *
 * Every investor-scoped query filters by `user_id` in SQL, so a row can never
 * surface under another account, and paise cross the boundary as strings so a
 * bigint is never narrowed to a JavaScript number. Content reads only ever return
 * `published` items, so admin drafts stay invisible to the app.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { OrderState, PaymentState, SupportRequestState } from "../db/types.js"

// --- notifications ---

export interface NotificationRow {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly body: string
  readonly readAt: Date | null
  readonly payload: unknown
  readonly createdAt: Date
}

// --- payments ---

export interface ClientPaymentRow {
  readonly id: string
  readonly orderId: string
  readonly fundId: string | null
  readonly state: PaymentState
  readonly orderState: OrderState
  readonly acceptedAt: Date | null
  readonly amountPaise: string
  readonly currency: string
  readonly provider: string | null
  readonly failureCode: string | null
  readonly succeededAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

// --- support ---

export interface SupportRequestRow {
  readonly id: string
  readonly reference: string
  readonly category: string
  readonly subject: string
  readonly body: string
  readonly state: SupportRequestState
  readonly resolutionNote: string | null
  readonly resolvedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface CreateSupportRequestInput {
  readonly userId: string
  readonly reference: string
  readonly category: string
  readonly subject: string
  readonly body: string
}

// --- content ---

export interface ContentDocumentRow {
  readonly contentKey: string
  readonly title: string
  readonly body: string
  readonly payload: unknown
  readonly version: number
  readonly publishedAt: Date | null
}

export interface ClientAccountRepository {
  listNotifications: (
    tx: Transaction,
    input: Readonly<{ userId: string; limit: number; afterCreatedAt?: Date; afterId?: string }>,
  ) => Promise<readonly NotificationRow[]>
  /**
   * Unread notifications for the whole account, not for the page just read —
   * the inbox badge must not shrink because the caller only fetched one page.
   */
  countUnreadNotifications: (tx: Transaction, userId: string) => Promise<number>
  /** Marks one notification read; returns null when it is not the caller's. */
  markNotificationRead: (
    tx: Transaction,
    input: Readonly<{ userId: string; notificationId: string; now: Date }>,
  ) => Promise<NotificationRow | null>
  listPayments: (
    tx: Transaction,
    input: Readonly<{
      userId: string
      states: readonly PaymentState[]
      successProjection: "confirmed" | "processing" | null
      limit: number
      afterCreatedAt?: Date
      afterId?: string
    }>,
  ) => Promise<readonly ClientPaymentRow[]>
  listSupportRequests: (
    tx: Transaction,
    input: Readonly<{ userId: string; limit: number; afterCreatedAt?: Date; afterId?: string }>,
  ) => Promise<readonly SupportRequestRow[]>
  createSupportRequest: (tx: Transaction, input: CreateSupportRequestInput) => Promise<SupportRequestRow>
  /** Published FAQ items in display order. */
  listFaqs: (tx: Transaction, input: Readonly<{ limit: number }>) => Promise<readonly ContentDocumentRow[]>
  /** A single published document by content key, or null when unpublished. */
  findDocument: (tx: Transaction, contentKey: string) => Promise<ContentDocumentRow | null>
}

const NOTIFICATION_COLUMNS = sql`
  n.id,
  n.kind,
  n.title,
  n.body,
  n.read_at as "readAt",
  n.payload,
  n.created_at as "createdAt"
`

const SUPPORT_COLUMNS = sql`
  s.id,
  s.reference,
  s.category,
  s.subject,
  s.body,
  s.state,
  s.resolution_note as "resolutionNote",
  s.resolved_at as "resolvedAt",
  s.created_at as "createdAt",
  s.updated_at as "updatedAt"
`

/** Same projection without a table alias, for `INSERT ... RETURNING`. */
const SUPPORT_RETURNING = sql`
  id,
  reference,
  category,
  subject,
  body,
  state,
  resolution_note as "resolutionNote",
  resolved_at as "resolvedAt",
  created_at as "createdAt",
  updated_at as "updatedAt"
`

const CONTENT_COLUMNS = sql`
  c.content_key as "contentKey",
  c.title,
  c.body,
  c.payload,
  c.version,
  c.published_at as "publishedAt"
`

export const createClientAccountRepository = (): ClientAccountRepository => ({
  listNotifications: async (tx, input) => {
    const result = await sql<NotificationRow>`
      select ${NOTIFICATION_COLUMNS}
      from notifications n
      where n.user_id = ${input.userId}
        and (${input.afterCreatedAt ?? null}::timestamptz is null
             or (n.created_at, n.id) < (${input.afterCreatedAt ?? null}, ${input.afterId ?? null}))
      order by n.created_at desc, n.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  countUnreadNotifications: async (tx, userId) => {
    const result = await sql<{ readonly unread: number }>`
      select count(*)::int as unread
      from notifications n
      where n.user_id = ${userId} and n.read_at is null
    `.execute(tx)
    return result.rows[0]?.unread ?? 0
  },

  markNotificationRead: async (tx, input) => {
    // `read_at` is set once and never moved, so re-reading is a no-op rather than
    // a state change; the row is still returned so the caller sees the outcome.
    const result = await sql<NotificationRow>`
      update notifications as n
      set read_at = coalesce(n.read_at, ${input.now}), updated_at = ${input.now}
      where n.id = ${input.notificationId} and n.user_id = ${input.userId}
      returning ${NOTIFICATION_COLUMNS}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listPayments: async (tx, input) => {
    // The fund comes through the order, and the provider plus any failure code
    // live on the latest attempt — so one row carries everything the payments
    // screen shows without a second round trip.
    const result = await sql<ClientPaymentRow>`
      select
        p.id,
        p.order_id as "orderId",
        o.fund_id as "fundId",
        p.state,
        o.state as "orderState",
        o.accepted_at as "acceptedAt",
        p.amount_paise::text as "amountPaise",
        p.currency,
        latest.provider,
        latest.failure_code as "failureCode",
        p.succeeded_at as "succeededAt",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt"
      from payments p
      join investment_orders o on o.id = p.order_id
      left join lateral (
        select a.provider, a.failure_code
        from payment_attempts a
        where a.payment_id = p.id
        order by a.attempt_number desc
        limit 1
      ) latest on true
      where p.user_id = ${input.userId}
        and (${input.states.length === 0} or p.state = any(${input.states}::payment_state[]))
        and (${input.afterCreatedAt ?? null}::timestamptz is null
             or (p.created_at, p.id) < (${input.afterCreatedAt ?? null}, ${input.afterId ?? null}))
        and (
          ${input.successProjection}::text is null or
          p.state <> 'succeeded' or
          (${input.successProjection} = 'confirmed' and o.state = 'accepted') or
          (${input.successProjection} = 'processing' and o.state <> 'accepted')
        )
      order by p.created_at desc, p.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  listSupportRequests: async (tx, input) => {
    const result = await sql<SupportRequestRow>`
      select ${SUPPORT_COLUMNS}
      from support_requests s
      where s.user_id = ${input.userId}
        and (${input.afterCreatedAt ?? null}::timestamptz is null
             or (s.created_at, s.id) < (${input.afterCreatedAt ?? null}, ${input.afterId ?? null}))
      order by s.created_at desc, s.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  createSupportRequest: async (tx, input) => {
    const result = await sql<SupportRequestRow>`
      insert into support_requests (user_id, reference, category, subject, body)
      values (${input.userId}, ${input.reference}, ${input.category}, ${input.subject}, ${input.body})
      returning ${SUPPORT_RETURNING}
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("support request insert returned no row")
    return row
  },

  listFaqs: async (tx, input) => {
    const result = await sql<ContentDocumentRow>`
      select ${CONTENT_COLUMNS}
      from content_items c
      where c.kind = 'faq' and c.state = 'published'
      order by c.content_key, c.version desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  findDocument: async (tx, contentKey) => {
    const result = await sql<ContentDocumentRow>`
      select ${CONTENT_COLUMNS}
      from content_items c
      where c.content_key = ${contentKey} and c.state = 'published'
      order by c.version desc
      limit 1
    `.execute(tx)
    return result.rows[0] ?? null
  },
})
