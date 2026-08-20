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
  listByUser: (tx: Transaction, userId: string) => Promise<readonly SipPlan[]>
  lockById: (
    tx: Transaction,
    input: Readonly<{ sipPlanId: string; userId: string }>,
  ) => Promise<SipPlan | null>
  markPaused: (tx: Transaction, sipPlanId: string, now: Date) => Promise<SipPlan | null>
  markResumed: (tx: Transaction, sipPlanId: string, now: Date) => Promise<SipPlan | null>
  markCancelled: (tx: Transaction, sipPlanId: string, now: Date) => Promise<SipPlan | null>
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
        state: "active",
        start_date: input.now.toISOString().slice(0, 10),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  listByUser: async (tx, userId) =>
    tx
      .selectFrom("sip_plans")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .execute(),

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

  markPaused: async (tx, sipPlanId, now) => {
    const row = await tx
      .updateTable("sip_plans")
      .set({ state: "paused", paused_at: now, updated_at: now, version: sql<string>`version + 1` })
      .where("id", "=", sipPlanId)
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
      .where("state", "in", ["active", "paused"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },
})
