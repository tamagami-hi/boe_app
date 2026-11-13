import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import { cursorTime, keysetCondition, type KeysetBoundary, type WithCursor } from "./keysetBoundary.js"

export interface ClientReviewRow {
  readonly id: string
  readonly rating: number
  readonly comment: string | null
  readonly createdAt: Date
}

export interface ClientReviewInsert {
  readonly userId: string
  readonly rating: number
  readonly comment: string | null
  readonly now: Date
}

export interface ReviewSubmissionStatus {
  readonly hasReviewThisMonth: boolean
  readonly nextMonthStart: string
}

export interface ClientReviewRepository {
  insertOncePerMonth: (tx: Transaction, input: ClientReviewInsert) => Promise<ClientReviewRow | null>
  listByUser: (
    tx: Transaction,
    input: KeysetBoundary & Readonly<{ userId: string; limit: number }>,
  ) => Promise<readonly WithCursor<ClientReviewRow>[]>
  submissionStatus: (tx: Transaction, input: Readonly<{ userId: string; now: Date }>) => Promise<ReviewSubmissionStatus>
}

const REVIEW_COLUMNS = sql`
  r.id,
  r.rating,
  r.comment,
  r.created_at as "createdAt"
`

const istMonthOf = (now: Date) => sql`date_trunc('month', ${now}::timestamptz at time zone 'Asia/Kolkata')`

export const createClientReviewRepository = (): ClientReviewRepository => ({
  insertOncePerMonth: async (tx, input) => {
    const result = await sql<ClientReviewRow>`
      insert into client_reviews as r (user_id, rating, comment, created_at, updated_at)
      values (${input.userId}, ${input.rating}, ${input.comment}, ${input.now}::timestamptz, ${input.now}::timestamptz)
      on conflict do nothing
      returning ${REVIEW_COLUMNS}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listByUser: async (tx, input) => {
    const result = await sql<WithCursor<ClientReviewRow>>`
      select ${REVIEW_COLUMNS}, ${cursorTime("r.created_at")} as "cursorAt"
      from client_reviews r
      where r.user_id = ${input.userId}
        and ${keysetCondition({ time: "r.created_at", id: "r.id" }, "before", input)}
      order by r.created_at desc, r.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows
  },

  submissionStatus: async (tx, input) => {
    const result = await sql<ReviewSubmissionStatus>`
      select
        exists (
          select 1 from client_reviews r
          where r.user_id = ${input.userId} and r.review_month = (${istMonthOf(input.now)})::date
        ) as "hasReviewThisMonth",
        to_char(${istMonthOf(input.now)} + interval '1 month', 'YYYY-MM-DD') as "nextMonthStart"
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("review submission status returned no row")
    return row
  },
})
