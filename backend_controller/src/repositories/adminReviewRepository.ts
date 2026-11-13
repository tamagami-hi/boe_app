import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ClientReviewState } from "../db/types.js"
import { cursorTime, keysetCondition, type KeysetBoundary, type WithCursor } from "./keysetBoundary.js"

export interface AdminReviewRow {
  readonly id: string
  readonly userId: string
  readonly clientName: string
  readonly rating: number
  readonly comment: string | null
  readonly state: ClientReviewState
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}

export interface AdminReviewDetailRow extends AdminReviewRow {
  readonly moderationNote: string | null
  readonly moderatedAt: Date | null
  readonly moderatorName: string | null
}

export type AdminReviewPageInput = KeysetBoundary & Readonly<{ limit: number }>

export interface AdminReviewFilter {
  readonly state?: ClientReviewState
  readonly rating?: number
}

export interface ReviewModerationWrite {
  readonly reviewId: string
  readonly expectedVersion: number
  readonly state: ClientReviewState
  readonly moderationNote: string | null
  readonly actorUserId: string
  readonly now: Date
}

export interface AdminReviewRepository {
  listInbox: (tx: Transaction, input: AdminReviewPageInput & AdminReviewFilter) => Promise<readonly WithCursor<AdminReviewRow>[]>
  listForUser: (
    tx: Transaction,
    input: AdminReviewPageInput & Readonly<{ userId: string }>,
  ) => Promise<readonly WithCursor<AdminReviewRow>[]>
  userExists: (tx: Transaction, userId: string) => Promise<boolean>
  findReview: (tx: Transaction, reviewId: string) => Promise<AdminReviewDetailRow | null>
  lockReview: (tx: Transaction, reviewId: string) => Promise<AdminReviewDetailRow | null>
  applyModeration: (tx: Transaction, input: ReviewModerationWrite) => Promise<boolean>
}

const REVIEW_COLUMNS = sql`
  r.id,
  r.user_id as "userId",
  case when u.pii_tombstoned_at is null then u.full_name else 'Tombstoned' end as "clientName",
  r.rating,
  case when u.pii_tombstoned_at is null then r.comment end as comment,
  r.state,
  r.created_at as "createdAt",
  r.updated_at as "updatedAt",
  r.version::text as "version",
  ${cursorTime("r.created_at")} as "cursorAt"
`

const REVIEW_SOURCE = sql`from client_reviews r join users u on u.id = r.user_id`

const NEWEST_FIRST = { time: "r.created_at", id: "r.id" } as const

const findDetail = async (tx: Transaction, reviewId: string, lock: boolean): Promise<AdminReviewDetailRow | null> => {
  const result = await sql<AdminReviewDetailRow>`
    select
      ${REVIEW_COLUMNS},
      case when u.pii_tombstoned_at is null then r.moderation_note end as "moderationNote",
      r.moderated_at as "moderatedAt",
      case when m.id is null then null
           when m.pii_tombstoned_at is null then m.full_name
           else 'Tombstoned' end as "moderatorName"
    ${REVIEW_SOURCE}
    left join users m on m.id = r.moderated_by_user_id
    where r.id = ${reviewId}
    ${lock ? sql`for update of r` : sql``}
  `.execute(tx)
  return result.rows[0] ?? null
}

export const createAdminReviewRepository = (): AdminReviewRepository => ({
  listInbox: async (tx, input) => {
    const stateClause = input.state === undefined ? sql`` : sql`and r.state = ${input.state}`
    const ratingClause = input.rating === undefined ? sql`` : sql`and r.rating = ${input.rating}`
    const result = await sql<WithCursor<AdminReviewRow>>`
      select ${REVIEW_COLUMNS}
      ${REVIEW_SOURCE}
      where ${keysetCondition(NEWEST_FIRST, "before", input)} ${stateClause} ${ratingClause}
      order by r.created_at desc, r.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  listForUser: async (tx, input) => {
    const result = await sql<WithCursor<AdminReviewRow>>`
      select ${REVIEW_COLUMNS}
      ${REVIEW_SOURCE}
      where r.user_id = ${input.userId} and ${keysetCondition(NEWEST_FIRST, "before", input)}
      order by r.created_at desc, r.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  userExists: async (tx, userId) => {
    const result = await sql<{ id: string }>`select id from users where id = ${userId}`.execute(tx)
    return result.rows.length > 0
  },

  findReview: (tx, reviewId) => findDetail(tx, reviewId, false),

  lockReview: (tx, reviewId) => findDetail(tx, reviewId, true),

  applyModeration: async (tx, input) => {
    const result = await sql<{ id: string }>`
      update client_reviews r
      set state = ${input.state},
          moderation_note = ${input.moderationNote},
          moderated_by_user_id = ${input.actorUserId},
          moderated_at = ${input.now}::timestamptz,
          updated_at = ${input.now}::timestamptz,
          version = r.version + 1
      where r.id = ${input.reviewId} and r.version = ${String(input.expectedVersion)}::bigint
      returning r.id
    `.execute(tx)
    return result.rows.length === 1
  },
})
