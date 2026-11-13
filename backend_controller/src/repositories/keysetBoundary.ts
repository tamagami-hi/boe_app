import { sql, type RawBuilder } from "kysely"

export interface KeysetBoundary {
  readonly afterCreatedAt?: string
  readonly afterId?: string
}

export interface KeysetColumns {
  readonly time: string
  readonly id: string
}

export type KeysetDirection = "after" | "before"

export type WithCursor<Row> = Row & { readonly cursorAt: string }

const CURSOR_TIME_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
const MILLISECOND_CURSOR_TIME = /\.\d{3}Z$/u

export const cursorTime = (column: string): RawBuilder<string> =>
  sql<string>`to_char(${sql.ref(column)} at time zone 'UTC', ${CURSOR_TIME_FORMAT})`

const comparedTime = (column: string, cursorAt: string) =>
  MILLISECOND_CURSOR_TIME.test(cursorAt) ? sql`date_trunc('milliseconds', ${sql.ref(column)})` : sql.ref(column)

export const keysetCondition = (
  columns: KeysetColumns,
  direction: KeysetDirection,
  boundary: KeysetBoundary,
): RawBuilder<boolean> => {
  const { afterCreatedAt, afterId } = boundary
  if (afterCreatedAt === undefined || afterId === undefined) return sql<boolean>`true`
  const position = sql`(${comparedTime(columns.time, afterCreatedAt)}, ${sql.ref(columns.id)})`
  const cursor = sql`(${afterCreatedAt}::timestamptz, ${afterId}::uuid)`
  return direction === "after" ? sql<boolean>`${position} > ${cursor}` : sql<boolean>`${position} < ${cursor}`
}
