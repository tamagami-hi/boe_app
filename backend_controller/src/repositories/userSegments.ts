import { sql, type RawBuilder } from "kysely"

export type UserDirectorySegment = "clients" | "pending_invites"

export const isClientUser = (): RawBuilder<unknown> =>
  sql`not exists (select 1 from user_roles ur where ur.user_id = u.id)`

export const isPendingInvite = (): RawBuilder<unknown> => sql`
  u.account_state in ('invited', 'active')
  and u.pii_tombstoned_at is null
  and not exists (select 1 from user_credentials c where c.user_id = u.id and c.password_hash is not null)
  and ${isClientUser()}
`

export const userSegmentClause = (segment: UserDirectorySegment | undefined): RawBuilder<unknown> => {
  if (segment === undefined) return sql``
  return segment === "clients" ? sql`and ${isClientUser()}` : sql`and ${isPendingInvite()}`
}
