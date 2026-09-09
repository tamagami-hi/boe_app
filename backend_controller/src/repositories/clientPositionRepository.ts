import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ClientValueEntryType } from "../db/types.js"

export interface RecordedOrderInput {
  readonly userId: string
  readonly fundId: string
  readonly fundVersionId: string
  readonly amountPaise: bigint
  readonly occurredAt: Date
}

export interface RecordedPaymentInput {
  readonly orderId: string
  readonly userId: string
  readonly amountPaise: bigint
  readonly occurredAt: Date
}

export interface RecordedAllocationInput {
  readonly orderId: string
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: bigint
  readonly actorUserId: string
  readonly occurredAt: Date
  readonly requestId: string
}

export interface RecordedContributionEntryInput {
  readonly userId: string
  readonly fundId: string
  readonly orderId: string
  readonly paymentId: string
  readonly allocationId: string
  readonly amountPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface ReversalEntryInput {
  readonly original: LedgerEntryRow
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface LedgerEntryRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly entryType: ClientValueEntryType
  readonly principalDeltaPaise: bigint
  readonly valueDeltaPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly reversesEntryId: string | null
  readonly reversedByEntryId: string | null
  readonly orderType: string | null
  readonly createdAt: Date
}

export interface ReversalPositionBasis {
  readonly principalPaise: bigint
  readonly currentValuePaise: bigint
  readonly contributionCount: bigint
  readonly minimumPrincipalPaise: bigint
  readonly minimumValuePaise: bigint
}

export interface ClientPositionRepository {
  findFundVersionForDate: (
    tx: Transaction,
    input: Readonly<{ fundId: string; effectiveDate: string }>,
  ) => Promise<Readonly<{ fundVersionId: string; historical: boolean }> | null>
  insertRecordedOrder: (tx: Transaction, input: RecordedOrderInput) => Promise<{ readonly id: string }>
  insertRecordedPayment: (
    tx: Transaction,
    input: RecordedPaymentInput,
  ) => Promise<{ readonly id: string }>
  insertRecordedAllocation: (
    tx: Transaction,
    input: RecordedAllocationInput,
  ) => Promise<{ readonly id: string }>
  insertContributionEntry: (
    tx: Transaction,
    input: RecordedContributionEntryInput,
  ) => Promise<{ readonly id: string }>
  listLedgerEntries: (
    tx: Transaction,
    input: Readonly<{ userId: string; fundId: string | null; limit: number }>,
  ) => Promise<readonly LedgerEntryRow[]>
  lockEntryForReversal: (
    tx: Transaction,
    input: Readonly<{ userId: string; entryId: string }>,
  ) => Promise<LedgerEntryRow | null>
  findEntryIdentity: (
    tx: Transaction,
    input: Readonly<{ userId: string; entryId: string }>,
  ) => Promise<Readonly<{ fundId: string }> | null>
  findReversalBasis: (
    tx: Transaction,
    input: Readonly<{ userId: string; fundId: string; effectiveDate: string }>,
  ) => Promise<ReversalPositionBasis>
  insertReversalEntry: (tx: Transaction, input: ReversalEntryInput) => Promise<{ readonly id: string }>
}

interface LedgerEntrySqlRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly entryType: ClientValueEntryType
  readonly principalDeltaPaise: string
  readonly valueDeltaPaise: string
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly reversesEntryId: string | null
  readonly reversedByEntryId: string | null
  readonly orderType: string | null
  readonly createdAt: Date
}

const mapEntry = (row: LedgerEntrySqlRow): LedgerEntryRow => ({
  id: row.id,
  userId: row.userId,
  fundId: row.fundId,
  entryType: row.entryType,
  principalDeltaPaise: BigInt(row.principalDeltaPaise),
  valueDeltaPaise: BigInt(row.valueDeltaPaise),
  effectiveDate:
    typeof row.effectiveDate === "string"
      ? row.effectiveDate
      : new Date(row.effectiveDate).toISOString().slice(0, 10),
  reasonCode: row.reasonCode,
  reversesEntryId: row.reversesEntryId,
  reversedByEntryId: row.reversedByEntryId,
  orderType: row.orderType,
  createdAt: row.createdAt,
})

const entrySelection = sql`
  select
    e.id as "id",
    e.user_id as "userId",
    e.fund_id as "fundId",
    e.entry_type as "entryType",
    e.principal_delta_paise::text as "principalDeltaPaise",
    e.value_delta_paise::text as "valueDeltaPaise",
    to_char(e.effective_date, 'YYYY-MM-DD') as "effectiveDate",
    e.reason_code as "reasonCode",
    e.reverses_entry_id as "reversesEntryId",
    (select r.id from client_value_entries r where r.reverses_entry_id = e.id) as "reversedByEntryId",
    o.type::text as "orderType",
    e.created_at as "createdAt"
  from client_value_entries e
  left join investment_orders o on o.id = e.order_id
`

export const createClientPositionRepository = (): ClientPositionRepository => ({
  findFundVersionForDate: async (tx, input) => {
    const historical = await sql<{ readonly id: string }>`
      select v.id
      from fund_versions v
      where v.fund_id = ${input.fundId}
        and v.created_at < (${input.effectiveDate}::date + interval '1 day')
      order by v.created_at desc, v.version desc
      limit 1
    `.execute(tx)
    const found = historical.rows[0]
    if (found !== undefined) return { fundVersionId: found.id, historical: true }

    const current = await tx
      .selectFrom("funds")
      .select("current_published_version_id")
      .where("id", "=", input.fundId)
      .executeTakeFirst()
    const fallback = current?.current_published_version_id ?? null
    return fallback === null ? null : { fundVersionId: fallback, historical: false }
  },

  insertRecordedOrder: async (tx, input) =>
    tx
      .insertInto("investment_orders")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        fund_version_id: input.fundVersionId,
        sip_plan_id: null,
        type: "recorded_offline",
        state: "accepted",
        amount_paise: input.amountPaise,
        requested_at: input.occurredAt,
        payment_confirmed_at: input.occurredAt,
        accepted_at: input.occurredAt,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  insertRecordedPayment: async (tx, input) =>
    tx
      .insertInto("payments")
      .values({
        order_id: input.orderId,
        user_id: input.userId,
        amount_paise: input.amountPaise,
        state: "succeeded",
        succeeded_at: input.occurredAt,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  insertRecordedAllocation: async (tx, input) =>
    tx
      .insertInto("investment_allocations")
      .values({
        order_id: input.orderId,
        user_id: input.userId,
        fund_id: input.fundId,
        amount_paise: input.amountPaise,
        allocated_by_user_id: input.actorUserId,
        allocated_at: input.occurredAt,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  insertContributionEntry: async (tx, input) =>
    tx
      .insertInto("client_value_entries")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        allocation_id: input.allocationId,
        entry_type: "contribution",
        principal_delta_paise: input.amountPaise,
        value_delta_paise: input.amountPaise,
        effective_date: input.effectiveDate,
        order_id: input.orderId,
        payment_id: input.paymentId,
        growth_batch_id: null,
        reason_code: input.reasonCode,
        note: input.note,
        reverses_entry_id: null,
        actor_type: "admin",
        created_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  listLedgerEntries: async (tx, input) => {
    const result = await sql<LedgerEntrySqlRow>`
      ${entrySelection}
      where e.user_id = ${input.userId}
        ${input.fundId === null ? sql`` : sql`and e.fund_id = ${input.fundId}`}
      order by e.effective_date desc, e.created_at desc, e.id desc
      limit ${input.limit}
    `.execute(tx)
    return result.rows.map(mapEntry)
  },

  lockEntryForReversal: async (tx, input) => {
    const locked = await sql<{ readonly id: string }>`
      select e.id
      from client_value_entries e
      where e.id = ${input.entryId} and e.user_id = ${input.userId}
      for update
    `.execute(tx)
    if (locked.rows[0] === undefined) return null
    const result = await sql<LedgerEntrySqlRow>`
      ${entrySelection}
      where e.id = ${input.entryId} and e.user_id = ${input.userId}
    `.execute(tx)
    const row = result.rows[0]
    return row === undefined ? null : mapEntry(row)
  },

  findEntryIdentity: async (tx, input) => {
    const row = await tx
      .selectFrom("client_value_entries")
      .select("fund_id as fundId")
      .where("id", "=", input.entryId)
      .where("user_id", "=", input.userId)
      .executeTakeFirst()
    return row ?? null
  },

  findReversalBasis: async (tx, input) => {
    const result = await sql<{
      readonly principalPaise: string
      readonly currentValuePaise: string
      readonly contributionCount: string
      readonly minimumPrincipalPaise: string
      readonly minimumValuePaise: string
    }>`
      with entries as (
        select * from client_value_entries
        where user_id = ${input.userId} and fund_id = ${input.fundId}
      ), daily as (
        select effective_date, sum(principal_delta_paise) as principal, sum(value_delta_paise) as value
        from entries group by effective_date
      ), balances as (
        select effective_date,
          sum(principal) over (order by effective_date) as principal,
          sum(value) over (order by effective_date) as value
        from daily
      )
      select
        coalesce(sum(e.principal_delta_paise), 0)::text as "principalPaise",
        coalesce(sum(e.value_delta_paise), 0)::text as "currentValuePaise",
        count(*) filter (where e.entry_type = 'contribution' and not exists (
          select 1 from entries r where r.reverses_entry_id = e.id
        ))::text as "contributionCount",
        (select min(principal)::text from balances
          where effective_date >= ${input.effectiveDate}::date) as "minimumPrincipalPaise",
        (select min(value)::text from balances
          where effective_date >= ${input.effectiveDate}::date) as "minimumValuePaise"
      from entries e
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("Position aggregate returned no row")
    return {
      principalPaise: BigInt(row.principalPaise),
      currentValuePaise: BigInt(row.currentValuePaise),
      contributionCount: BigInt(row.contributionCount),
      minimumPrincipalPaise: BigInt(row.minimumPrincipalPaise),
      minimumValuePaise: BigInt(row.minimumValuePaise),
    }
  },

  insertReversalEntry: async (tx, input) =>
    tx
      .insertInto("client_value_entries")
      .values({
        user_id: input.original.userId,
        fund_id: input.original.fundId,
        allocation_id: null,
        entry_type: "reversal",
        principal_delta_paise: -input.original.principalDeltaPaise,
        value_delta_paise: -input.original.valueDeltaPaise,
        effective_date: input.original.effectiveDate,
        order_id: null,
        payment_id: null,
        growth_batch_id: null,
        reason_code: input.reasonCode,
        note: input.note,
        reverses_entry_id: input.original.id,
        actor_type: "admin",
        created_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
})
