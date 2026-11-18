import { sql, type Kysely } from "kysely"

import type { Database, OrderType } from "../db/types.js"
import type {
  BreakdownInput,
  GrowthPartFact,
  InvestmentRef,
  LedgerEntryFact,
  ScheduleFact,
  SplitFact,
} from "../domain/client/investmentBreakdown.js"

type Reader = Kysely<Database>

export interface BreakdownContext {
  readonly input: BreakdownInput
  readonly orderTypes: ReadonlyMap<string, OrderType>
}

export interface CategorisationClient {
  readonly userId: string
  readonly name: string
}

export interface InsertSplitInput {
  readonly userId: string
  readonly fundId: string
  readonly cutoffEntryId: string
  readonly totalPaise: bigint
  readonly coveredEntryIds: readonly string[]
  readonly parts: readonly Readonly<{ ref: InvestmentRef; amountPaise: bigint }>[]
  readonly actorUserId: string
  readonly requestId: string
}

export interface InvestmentBreakdownRepository {
  loadBreakdownInput: (db: Reader, userId: string) => Promise<BreakdownInput>
  loadBreakdownContexts: (db: Reader, userIds: readonly string[]) => Promise<ReadonlyMap<string, BreakdownContext>>
  fundNames: (db: Reader, fundIds: readonly string[]) => Promise<ReadonlyMap<string, string>>
  listClientsWithInvestments: (db: Reader) => Promise<readonly CategorisationClient[]>
  insertSplit: (db: Reader, input: InsertSplitInput) => Promise<{ readonly id: string; readonly createdAt: Date }>
}

interface EntryRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly entryType: LedgerEntryFact["entryType"]
  readonly principal: string
  readonly value: string
  readonly effectiveDate: string
  readonly allocationId: string | null
  readonly reversesEntryId: string | null
  readonly reasonCode: string
  readonly orderType: OrderType | null
  readonly sequence: number
}

interface TargetRow {
  readonly targetKind: "sip" | "one_time"
  readonly scheduleId: string | null
  readonly allocationId: string | null
  readonly amount: string
}

const targetOf = (row: TargetRow): InvestmentRef =>
  row.targetKind === "sip"
    ? { kind: "sip", scheduleId: row.scheduleId ?? "" }
    : { kind: "one_time", allocationId: row.allocationId ?? "" }

const targetColumns = (ref: InvestmentRef) =>
  ref.kind === "sip"
    ? { target_kind: "sip" as const, target_sip_schedule_id: ref.scheduleId, target_allocation_id: null }
    : { target_kind: "one_time" as const, target_sip_schedule_id: null, target_allocation_id: ref.allocationId }

const byUser = <Row extends { readonly userId: string }>(rows: readonly Row[]): ReadonlyMap<string, readonly Row[]> => {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) grouped.set(row.userId, [...(grouped.get(row.userId) ?? []), row])
  return grouped
}

const loadEntries = async (db: Reader, userIds: readonly string[]) =>
  (
    await sql<EntryRow>`
      select e.id, e.user_id as "userId", e.fund_id as "fundId", e.entry_type as "entryType",
        e.principal_delta_paise::text as principal, e.value_delta_paise::text as value,
        to_char(e.effective_date, 'YYYY-MM-DD') as "effectiveDate", e.allocation_id as "allocationId",
        e.reverses_entry_id as "reversesEntryId", e.reason_code as "reasonCode", o.type as "orderType",
        (row_number() over (partition by e.user_id order by e.created_at, e.id))::int as sequence
      from client_value_entries e
      left join investment_orders o on o.id = e.order_id and o.user_id = e.user_id
      where e.user_id = any(${userIds}::uuid[])
    `.execute(db)
  ).rows

const loadCategories = async (db: Reader, userIds: readonly string[]) =>
  (
    await sql<{ entryId: string; userId: string }>`
      select entry_id as "entryId", user_id as "userId" from client_value_entry_categories
      where user_id = any(${userIds}::uuid[]) and category = 'one_time'
    `.execute(db)
  ).rows

const loadLinks = async (db: Reader, userIds: readonly string[]) =>
  (
    await sql<{ entryId: string; scheduleId: string; userId: string }>`
      select entry_id as "entryId", schedule_id as "scheduleId", user_id as "userId" from admin_sip_schedule_months
      where user_id = any(${userIds}::uuid[])
    `.execute(db)
  ).rows

const loadSchedules = async (db: Reader, userIds: readonly string[]) =>
  (
    await sql<ScheduleFact & { userId: string }>`
      select s.id, s.user_id as "userId", s.fund_id as "fundId", s.state, s.month_count as "monthCount",
        (select count(*) from admin_sip_schedule_months m where m.schedule_id = s.id and m.released_at is null)::int as "monthsPaid"
      from admin_sip_schedules s
      where s.user_id = any(${userIds}::uuid[])
      order by s.created_at, s.id
    `.execute(db)
  ).rows

const loadParts = async (db: Reader, userIds: readonly string[]) =>
  (
    await sql<TargetRow & { entryId: string; userId: string }>`
      select entry_id as "entryId", user_id as "userId", target_kind as "targetKind",
        target_sip_schedule_id as "scheduleId", target_allocation_id as "allocationId", amount_paise::text as amount
      from client_growth_parts where user_id = any(${userIds}::uuid[])
    `.execute(db)
  ).rows

const loadExits = async (db: Reader, userIds: readonly string[]) =>
  (
    await sql<{ scheduleId: string; ledgerEntryId: string; userId: string }>`
      select schedule_id as "scheduleId", ledger_entry_id as "ledgerEntryId", user_id as "userId" from sip_early_exits
      where user_id = any(${userIds}::uuid[])
    `.execute(db)
  ).rows

interface SplitRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly cutoffEntryId: string
  readonly total: string
  readonly createdAt: Date
}

const loadSplits = async (db: Reader, userIds: readonly string[]): Promise<readonly (SplitFact & { userId: string })[]> => {
  const splits = (
    await sql<SplitRow>`
      select distinct on (user_id, fund_id) id, user_id as "userId", fund_id as "fundId",
        cutoff_entry_id as "cutoffEntryId", total_paise::text as total, created_at as "createdAt"
      from client_earlier_growth_splits where user_id = any(${userIds}::uuid[])
      order by user_id, fund_id, created_at desc, id desc
    `.execute(db)
  ).rows
  const splitIds = splits.map((split) => split.id)
  const parts = (
    await sql<TargetRow & { splitId: string }>`
      select split_id as "splitId", target_kind as "targetKind", target_sip_schedule_id as "scheduleId",
        target_allocation_id as "allocationId", amount_paise::text as amount
      from client_earlier_growth_split_parts where split_id = any(${splitIds}::uuid[])
      order by split_id, target_kind, target_sip_schedule_id, target_allocation_id
    `.execute(db)
  ).rows
  const covered = (
    await sql<{ splitId: string; entryId: string }>`
      select split_id as "splitId", entry_id as "entryId" from client_earlier_growth_split_entries
      where split_id = any(${splitIds}::uuid[])
    `.execute(db)
  ).rows
  return splits.map((split) => ({
    id: split.id,
    userId: split.userId,
    fundId: split.fundId,
    cutoffEntryId: split.cutoffEntryId,
    totalPaise: BigInt(split.total),
    confirmedAt: new Date(split.createdAt),
    parts: parts.filter((part) => part.splitId === split.id).map((part) => ({ target: targetOf(part), amountPaise: BigInt(part.amount) })),
    entryIds: new Set(covered.filter((row) => row.splitId === split.id).map((row) => row.entryId)),
  }))
}

const entryFact = (row: EntryRow): LedgerEntryFact => ({
  id: row.id,
  fundId: row.fundId,
  entryType: row.entryType,
  principalDeltaPaise: BigInt(row.principal),
  valueDeltaPaise: BigInt(row.value),
  effectiveDate: row.effectiveDate,
  sequence: row.sequence,
  allocationId: row.allocationId,
  reversesEntryId: row.reversesEntryId,
  reasonCode: row.reasonCode,
})

const loadBreakdownContexts = async (db: Reader, userIds: readonly string[]): Promise<ReadonlyMap<string, BreakdownContext>> => {
  const entries = byUser(await loadEntries(db, userIds))
  const categories = byUser(await loadCategories(db, userIds))
  const links = byUser(await loadLinks(db, userIds))
  const schedules = byUser(await loadSchedules(db, userIds))
  const parts = byUser(await loadParts(db, userIds))
  const exits = byUser(await loadExits(db, userIds))
  const splits = byUser(await loadSplits(db, userIds))
  return new Map(
    userIds.map((userId) => {
      const rows = entries.get(userId) ?? []
      const growthParts: readonly GrowthPartFact[] = (parts.get(userId) ?? []).map((part) => ({
        entryId: part.entryId,
        target: targetOf(part),
        amountPaise: BigInt(part.amount),
      }))
      const input: BreakdownInput = {
        entries: rows.map(entryFact),
        oneTimeCategories: new Set((categories.get(userId) ?? []).map((row) => row.entryId)),
        sipLinks: new Map((links.get(userId) ?? []).map((row) => [row.entryId, row.scheduleId] as const)),
        schedules: (schedules.get(userId) ?? []).map((schedule) => ({
          id: schedule.id,
          fundId: schedule.fundId,
          state: schedule.state,
          monthCount: schedule.monthCount,
          monthsPaid: schedule.monthsPaid,
        })),
        growthParts,
        splits: new Map((splits.get(userId) ?? []).map((split) => [split.fundId, split] as const)),
        onlinePaymentEntryIds: new Set(
          rows.filter((row) => row.entryType === "contribution" && row.orderType === "lump_sum").map((row) => row.id),
        ),
        earlyExits: (exits.get(userId) ?? []).map(({ scheduleId, ledgerEntryId }) => ({ scheduleId, ledgerEntryId })),
      }
      const orderTypes = new Map(rows.flatMap((row) => (row.orderType === null ? [] : [[row.id, row.orderType] as const])))
      return [userId, { input, orderTypes }] as const
    }),
  )
}

const EMPTY_INPUT: BreakdownInput = {
  entries: [],
  oneTimeCategories: new Set(),
  sipLinks: new Map(),
  schedules: [],
  growthParts: [],
  splits: new Map(),
  onlinePaymentEntryIds: new Set(),
  earlyExits: [],
}

export const loadBreakdownInput = async (db: Reader, userId: string): Promise<BreakdownInput> =>
  (await loadBreakdownContexts(db, [userId])).get(userId)?.input ?? EMPTY_INPUT

export const createInvestmentBreakdownRepository = (): InvestmentBreakdownRepository => ({
  loadBreakdownInput,
  loadBreakdownContexts,

  fundNames: async (db, fundIds) => {
    const rows = (
      await sql<{ id: string; name: string }>`
        select f.id, coalesce(fv.name, f.slug) as name from funds f
        left join fund_versions fv on fv.id = f.current_published_version_id
        where f.id = any(${fundIds}::uuid[])
      `.execute(db)
    ).rows
    return new Map(rows.map((row) => [row.id, row.name] as const))
  },

  listClientsWithInvestments: async (db) =>
    (
      await sql<CategorisationClient>`
        select u.id as "userId", u.full_name as name from users u
        where exists (select 1 from client_value_entries e where e.user_id = u.id and e.entry_type = 'contribution')
          and not exists (select 1 from user_roles r where r.user_id = u.id and r.revoked_at is null)
        order by u.full_name, u.id
      `.execute(db)
    ).rows,

  insertSplit: async (db, input) => {
    const split = await db
      .insertInto("client_earlier_growth_splits")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        cutoff_entry_id: input.cutoffEntryId,
        total_paise: input.totalPaise.toString(),
        confirmed_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning(["id", "created_at"])
      .executeTakeFirstOrThrow()
    const owner = { split_id: split.id, user_id: input.userId, fund_id: input.fundId }
    await db
      .insertInto("client_earlier_growth_split_entries")
      .values(input.coveredEntryIds.map((entryId) => ({ ...owner, entry_id: entryId })))
      .execute()
    if (input.parts.length > 0) {
      await db
        .insertInto("client_earlier_growth_split_parts")
        .values(input.parts.map((part) => ({ ...owner, ...targetColumns(part.ref), amount_paise: part.amountPaise.toString() })))
        .execute()
    }
    return { id: split.id, createdAt: new Date(split.created_at) }
  },
})
