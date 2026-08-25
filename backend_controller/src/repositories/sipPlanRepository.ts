import { sql } from "kysely"

import type { SipPlan, Transaction } from "../db/repositories.js"

export interface CreateSipPlanInput {
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly debitDay: number
  readonly durationMonths: number | null
  readonly now: Date
}

export interface SipPlanRepository {
  create: (tx: Transaction, input: CreateSipPlanInput) => Promise<SipPlan>
  createAutoPay: (tx: Transaction, input: CreateSipPlanInput) => Promise<SipPlan>
  listByUser: (tx: Transaction, userId: string) => Promise<readonly SipPlan[]>
  listDue: (tx: Transaction, input: Readonly<{ asOf: string; limit: number }>) => Promise<readonly SipPlan[]>
  listAutoPayDue: (tx: Transaction, input: Readonly<{ asOf: string; limit: number }>) => Promise<readonly SipPlan[]>
  listAutoPayTermCompletionCandidates: (tx: Transaction, limit: number) => Promise<readonly SipPlan[]>
  lockById: (
    tx: Transaction,
    input: Readonly<{ sipPlanId: string; userId: string }>,
  ) => Promise<SipPlan | null>
  lockByIdUnscoped: (tx: Transaction, sipPlanId: string) => Promise<SipPlan | null>
  markPaused: (tx: Transaction, sipPlanId: string, now: Date) => Promise<SipPlan | null>
  markResumed: (tx: Transaction, sipPlanId: string, now: Date) => Promise<SipPlan | null>
  markCancelled: (tx: Transaction, sipPlanId: string, now: Date) => Promise<SipPlan | null>
  markCompleted: (tx: Transaction, sipPlanId: string, now: Date) => Promise<SipPlan | null>
  advanceNextDueDate: (
    tx: Transaction,
    input: Readonly<{ sipPlanId: string; nextDueDate: string; now: Date }>,
  ) => Promise<SipPlan | null>
}

export const createSipPlanRepository = (): SipPlanRepository => ({
  create: async (tx, input) =>
    tx
      .insertInto("sip_plans")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        amount_paise: input.amountPaise,
        debit_day: input.debitDay,
        duration_months: input.durationMonths,
        collection_mode: "manual_checkout",
        state: "active",
        start_date: input.now.toISOString().slice(0, 10),
        next_due_date: input.now.toISOString().slice(0, 10),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  createAutoPay: async (tx, input) =>
    tx.insertInto("sip_plans").values({
      user_id: input.userId,
      fund_id: input.fundId,
      amount_paise: input.amountPaise,
      debit_day: input.debitDay,
      duration_months: input.durationMonths,
      collection_mode: "phonepe_autopay",
      state: "pending_mandate",
      start_date: input.now.toISOString().slice(0, 10),
      next_due_date: null,
    }).returningAll().executeTakeFirstOrThrow(),

  listByUser: async (tx, userId) =>
    tx
      .selectFrom("sip_plans")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .execute(),

  listDue: async (tx, input) =>
    tx
      .selectFrom("sip_plans")
      .selectAll()
      .where("state", "=", "active")
      .where("collection_mode", "=", "manual_checkout")
      .where("next_due_date", "is not", null)
      .where(sql<boolean>`next_due_date <= ${input.asOf}`)
      .orderBy("next_due_date")
      .orderBy("id")
      .limit(input.limit)
      .forUpdate()
      .skipLocked()
      .execute(),

  listAutoPayDue: async (tx, input) => tx.selectFrom("sip_plans").selectAll()
    .where("state", "=", "active").where("collection_mode", "=", "phonepe_autopay")
    .where("next_due_date", "is not", null).where(sql<boolean>`next_due_date <= ${input.asOf}`)
    .orderBy("next_due_date").orderBy("id").limit(input.limit).forUpdate().skipLocked().execute(),

  listAutoPayTermCompletionCandidates: async (tx, limit) => tx.selectFrom("sip_plans").selectAll()
    .where("state", "=", "active").where("collection_mode", "=", "phonepe_autopay")
    .where("duration_months", "is not", null)
    .where(sql<boolean>`(
      select count(*) from investment_orders investment_order
      where investment_order.sip_plan_id = sip_plans.id
        and investment_order.type = 'sip_installment'
        and investment_order.state = 'accepted'
    ) >= sip_plans.duration_months`)
    .orderBy("updated_at").orderBy("id").limit(limit).forUpdate().skipLocked().execute(),

  lockById: async (tx, input) => {
    const row = await tx
      .selectFrom("sip_plans")
      .selectAll()
      .where("id", "=", input.sipPlanId)
      .where("user_id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  lockByIdUnscoped: async (tx, sipPlanId) => {
    const row = await tx
      .selectFrom("sip_plans")
      .selectAll()
      .where("id", "=", sipPlanId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  markPaused: async (tx, sipPlanId, now) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ state: "paused", paused_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", sipPlanId)
      .where("collection_mode", "=", "manual_checkout")
      .where("state", "=", "active")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markResumed: async (tx, sipPlanId, now) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ state: "active", paused_at: null, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", sipPlanId)
      .where("collection_mode", "=", "manual_checkout")
      .where("state", "=", "paused")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markCancelled: async (tx, sipPlanId, now) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ state: "cancelled", cancelled_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", sipPlanId)
      .where("collection_mode", "=", "manual_checkout")
      .where("state", "in", ["active", "paused"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  markCompleted: async (tx, sipPlanId, now) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({
        state: "completed",
        completed_at: now,
        next_due_date: null,
        updated_at: now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", sipPlanId)
      .where("collection_mode", "=", "manual_checkout")
      .where("state", "=", "active")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  advanceNextDueDate: async (tx, input) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ next_due_date: input.nextDueDate, updated_at: input.now, version: sql<string>`version + 1` })
      .where("id", "=", input.sipPlanId)
      .where("state", "=", "active")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },
})
