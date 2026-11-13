import { sql, type RawBuilder } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ContactScrubber } from "../domain/admin/erasureContacts.js"
import type { OwnedEntities } from "./clientErasureInspectRepository.js"

export interface ScrubOwner {
  readonly userId: string
  readonly applicationIds: readonly string[]
  readonly owned: OwnedEntities
}

interface ScrubTarget {
  readonly table: string
  readonly textColumns: readonly string[]
  readonly jsonColumns: readonly string[]
  readonly owned: (owner: ScrubOwner) => RawBuilder<unknown>
}

type ScrubRow = Readonly<Record<string, unknown>> & { readonly id: string }

const uuids = (values: readonly string[]) => sql`${[...values]}::uuid[]`

const escapeLike = (value: string): string => value.replace(/[\\%_]/gu, (character) => `\\${character}`)

export const auditAboutClient = (owner: ScrubOwner) => sql`
  (entity_type = any(${[...owner.owned.types]}::text[]) and entity_id = any(${uuids(owner.owned.ids)}))
  or actor_user_id = ${owner.userId}
  or (metadata ? 'userId' and metadata->>'userId' = ${owner.userId})
`

const clientMail = (owner: ScrubOwner) => sql`
  select d.outbox_event_id from email_deliveries d
  where d.outbox_event_id is not null
    and (d.user_id = ${owner.userId} or d.application_id = any(${uuids(owner.applicationIds)}))
`

export const CLIENT_SCRUB_TARGETS: readonly ScrubTarget[] = [
  { table: "audit_events", textColumns: ["reason_detail"], jsonColumns: ["metadata"], owned: auditAboutClient },
  {
    table: "notifications",
    textColumns: ["title", "body"],
    jsonColumns: ["payload"],
    owned: (owner) => sql`user_id = ${owner.userId}`,
  },
  {
    table: "support_requests",
    textColumns: ["subject", "body", "resolution_note"],
    jsonColumns: [],
    owned: (owner) => sql`user_id = ${owner.userId}`,
  },
  {
    table: "application_reviews",
    textColumns: ["reason_detail"],
    jsonColumns: [],
    owned: (owner) => sql`application_id = any(${uuids(owner.applicationIds)})`,
  },
  {
    table: "outbox_events",
    textColumns: [],
    jsonColumns: ["payload"],
    owned: (owner) => sql`
      id in (${clientMail(owner)})
      or (aggregate_type = 'user' and aggregate_id = ${owner.userId})
      or (aggregate_type = 'application' and aggregate_id = any(${uuids(owner.applicationIds)}))
    `,
  },
  {
    table: "client_value_entries",
    textColumns: ["note"],
    jsonColumns: [],
    owned: (owner) => sql`user_id = ${owner.userId}`,
  },
  {
    table: "client_position_maturities",
    textColumns: ["note"],
    jsonColumns: [],
    owned: (owner) => sql`user_id = ${owner.userId}`,
  },
  {
    table: "withdrawal_operations",
    textColumns: ["note"],
    jsonColumns: [],
    owned: (owner) => sql`user_id = ${owner.userId}`,
  },
  {
    table: "fund_receipt_acknowledgements",
    textColumns: ["private_note"],
    jsonColumns: [],
    owned: (owner) => sql`order_id in (select o.id from investment_orders o where o.user_id = ${owner.userId})`,
  },
]

export const RECEIPT_SCRUB_TARGET: ScrubTarget = {
  table: "idempotency_records",
  textColumns: [],
  jsonColumns: ["response_body"],
  owned: (owner) => sql`
    actor_scope = ${`user:${owner.userId}`}
    or actor_user_id = ${owner.userId}
    or response_body::text like ${`%${escapeLike(owner.userId)}%`} escape '\\'
  `,
}

const scrubbedColumns = (
  target: ScrubTarget,
  row: ScrubRow,
  scrubber: ContactScrubber,
): readonly (readonly [column: string, value: RawBuilder<unknown>])[] => [
  ...target.textColumns.flatMap((column) => {
    const before = row[column]
    if (typeof before !== "string") return []
    const after = scrubber.ownText(before)
    return after === before ? [] : [[column, sql`${after}`] as const]
  }),
  ...target.jsonColumns.flatMap((column) => {
    const before = row[column]
    const after = scrubber.json(before)
    return JSON.stringify(after) === JSON.stringify(before)
      ? []
      : [[column, sql`${JSON.stringify(after)}::jsonb`] as const]
  }),
]

export const scrubTarget = async (
  tx: Transaction,
  target: ScrubTarget,
  owner: ScrubOwner,
  scrubber: ContactScrubber,
): Promise<number> => {
  const columns = [...target.textColumns, ...target.jsonColumns]
  const rows = (
    await sql<ScrubRow>`
      select id, ${sql.join(columns.map((column) => sql.ref(column)))}
      from ${sql.table(target.table)}
      where ${target.owned(owner)}
      order by id
      for update
    `.execute(tx)
  ).rows
  let changed = 0
  for (const row of rows) {
    const updates = scrubbedColumns(target, row, scrubber)
    if (updates.length === 0) continue
    await sql`
      update ${sql.table(target.table)}
      set ${sql.join(updates.map(([column, value]) => sql`${sql.ref(column)} = ${value}`))}
      where id = ${row.id}
    `.execute(tx)
    changed += 1
  }
  return changed
}
