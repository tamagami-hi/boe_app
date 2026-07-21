/**
 * SIP plan write repository (spec 03 §4.3, §5.2). A SIP is a user's recurring
 * purchase schedule for a fund; `(id, user_id)` anchors ownership. Guarded
 * transitions use `UPDATE ... WHERE id AND user_id AND state IN (...) RETURNING`.
 * The scheduler reads due active plans and advances / completes them.
 */
import { sql } from "kysely"

import type { SipPlan, Transaction } from "../db/repositories.js"

export interface CreateSipInput {
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly debitDay: number
  readonly durationMonths: number | null
}

export interface DueSipRow {
  readonly id: string
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly debitDay: number
  readonly durationMonths: number | null
  readonly nextDueDate: string
}

export interface SipWriteRepository {
  create: (tx: Transaction, input: CreateSipInput) => Promise<SipPlan>
  lockById: (tx: Transaction, input: Readonly<{ sipId: string; userId: string }>) => Promise<SipPlan | null>
  /** draft -> pending_mandate; links the mandate. */
  linkMandate: (
    tx: Transaction,
    input: Readonly<{ sipId: string; userId: string; mandateId: string; now: Date }>,
  ) => Promise<SipPlan | null>
  /** pending_mandate -> active; sets start + first due date. */
  activate: (
    tx: Transaction,
    input: Readonly<{ sipId: string; userId: string; startDate: string; nextDueDate: string; now: Date }>,
  ) => Promise<SipPlan | null>
  pause: (tx: Transaction, input: Readonly<{ sipId: string; userId: string; now: Date }>) => Promise<SipPlan | null>
  resume: (tx: Transaction, input: Readonly<{ sipId: string; userId: string; now: Date }>) => Promise<SipPlan | null>
  cancel: (tx: Transaction, input: Readonly<{ sipId: string; userId: string; now: Date }>) => Promise<SipPlan | null>
  complete: (tx: Transaction, input: Readonly<{ sipId: string; userId: string; now: Date }>) => Promise<SipPlan | null>
  /** Move an active plan's next due date forward (state unchanged). */
  advanceNextDueDate: (
    tx: Transaction,
    input: Readonly<{ sipId: string; userId: string; nextDueDate: string; now: Date }>,
  ) => Promise<SipPlan | null>
  /** Active plans due on/before `asOfDate`, oldest due first. */
  findActiveDue: (tx: Transaction, input: Readonly<{ asOfDate: string; limit: number }>) => Promise<readonly DueSipRow[]>
  /** Count the plans still referencing a mandate in a live (non-terminal) state. */
  countLiveByMandate: (
    tx: Transaction,
    input: Readonly<{ mandateId: string; excludeSipId: string }>,
  ) => Promise<number>
  /** pending_mandate plans linked to a mandate (for activation). */
  findPendingByMandate: (tx: Transaction, mandateId: string) => Promise<readonly SipPlan[]>
}

export const createSipRepository = (): SipWriteRepository => ({
  create: async (tx, input) =>
    tx
      .insertInto("sip_plans")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        amount_paise: input.amountPaise,
        debit_day: input.debitDay,
        duration_months: input.durationMonths,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  lockById: async (tx, input) => {
    const row = await tx
      .selectFrom("sip_plans")
      .selectAll()
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  linkMandate: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({
        state: "pending_mandate",
        mandate_id: input.mandateId,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "draft")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  activate: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({
        state: "active",
        start_date: input.startDate,
        next_due_date: input.nextDueDate,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "pending_mandate")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  pause: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ state: "paused", paused_at: input.now, version: sql<string>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "active")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  resume: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ state: "active", version: sql<string>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "paused")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  cancel: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({
        state: "cancelled",
        cancelled_at: input.now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .where("state", "in", ["draft", "pending_mandate", "active", "paused"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  complete: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({
        state: "completed",
        completed_at: input.now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "active")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  advanceNextDueDate: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ next_due_date: input.nextDueDate, version: sql<string>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", input.sipId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "active")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  findActiveDue: async (tx, input) => {
    const result = await sql<DueSipRow>`
      select
        id as "id", user_id as "userId", fund_id as "fundId",
        amount_paise::text as "amountPaise", debit_day as "debitDay",
        duration_months as "durationMonths", next_due_date::text as "nextDueDate"
      from sip_plans
      where state = 'active' and next_due_date is not null and next_due_date <= ${input.asOfDate}::date
      order by next_due_date asc, id asc
      limit ${input.limit}
      for update skip locked
    `.execute(tx)
    return result.rows
  },

  countLiveByMandate: async (tx, input) => {
    const result = await sql<{ count: string }>`
      select count(*)::text as count from sip_plans
      where mandate_id = ${input.mandateId}
        and id <> ${input.excludeSipId}
        and state in ('pending_mandate', 'active', 'paused')
    `.execute(tx)
    return Number(result.rows[0]?.count ?? "0")
  },

  findPendingByMandate: async (tx, mandateId) =>
    tx
      .selectFrom("sip_plans")
      .selectAll()
      .where("mandate_id", "=", mandateId)
      .where("state", "=", "pending_mandate")
      .forUpdate()
      .execute(),
})
