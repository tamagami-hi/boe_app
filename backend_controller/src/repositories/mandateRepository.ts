/**
 * Mandate write repository (spec 03 §4.4, §5.2). A mandate is the SIP debit
 * authorization; `(id, user_id)` is the ownership anchor referenced by
 * `sip_plans`. Guarded transitions use `UPDATE ... WHERE id AND user_id AND
 * state IN (...) RETURNING`.
 */
import { sql } from "kysely"

import type { Mandate, Transaction } from "../db/repositories.js"

export interface CreateMandateInput {
  readonly userId: string
  readonly provider: string
  readonly maxAmountPaise: string
  readonly frequency: string
  readonly debitDay: number
}

export interface MandateWriteRepository {
  /** Create a mandate in `pending_user_authorization` (authorization requested). */
  createPendingAuthorization: (tx: Transaction, input: CreateMandateInput) => Promise<Mandate>
  lockById: (tx: Transaction, input: Readonly<{ mandateId: string; userId: string }>) => Promise<Mandate | null>
  findById: (tx: Transaction, mandateId: string) => Promise<Mandate | null>
  /** pending_user_authorization -> active; sets provider id + validity window. */
  activate: (
    tx: Transaction,
    input: Readonly<{ mandateId: string; userId: string; providerMandateId: string; validFrom: Date; now: Date }>,
  ) => Promise<Mandate | null>
  /** any live state -> revoked. */
  revoke: (
    tx: Transaction,
    input: Readonly<{ mandateId: string; userId: string; now: Date }>,
  ) => Promise<Mandate | null>
}

export const createMandateRepository = (): MandateWriteRepository => ({
  createPendingAuthorization: async (tx, input) =>
    tx
      .insertInto("mandates")
      .values({
        user_id: input.userId,
        provider: input.provider,
        max_amount_paise: input.maxAmountPaise,
        frequency: input.frequency,
        debit_day: input.debitDay,
        state: "pending_user_authorization",
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  lockById: async (tx, input) => {
    const row = await tx
      .selectFrom("mandates")
      .selectAll()
      .where("id", "=", input.mandateId)
      .where("user_id", "=", input.userId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  findById: async (tx, mandateId) => {
    const row = await tx.selectFrom("mandates").selectAll().where("id", "=", mandateId).executeTakeFirst()
    return row ?? null
  },

  activate: async (tx, input) => {
    const row = await tx
      .updateTable("mandates")
      .set({
        state: "active",
        provider_mandate_id: input.providerMandateId,
        valid_from: input.validFrom,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.mandateId)
      .where("user_id", "=", input.userId)
      .where("state", "=", "pending_user_authorization")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  revoke: async (tx, input) => {
    const row = await tx
      .updateTable("mandates")
      .set({ state: "revoked", version: sql<string>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", input.mandateId)
      .where("user_id", "=", input.userId)
      .where("state", "in", ["created", "pending_user_authorization", "active", "paused"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },
})
