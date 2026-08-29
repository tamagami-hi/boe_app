import { sql } from "kysely"

import type {
  MandateCancelCommand,
  MandateCollectionAttempt,
  MandateSetupAttempt,
  PaymentMandate,
  SipPlan,
  Transaction,
} from "../db/repositories.js"
import type {
  MandateCancelCommandState,
  MandateNotifyState,
  MandateSetupState,
  MandateState,
  SipState,
} from "../db/types.js"
import { createMandatesRepository, type MandatesRepository } from "./mandatesRepository.js"

export interface AdminMandateListRow {
  readonly id: string
  readonly sipPlanId: string
  readonly userId: string
  readonly userEmail: string
  readonly userName: string
  readonly fundId: string
  readonly fundName: string | null
  readonly amountPaise: string
  readonly debitDay: number
  readonly sipState: SipState
  readonly mandateState: MandateState
  readonly setupState: MandateSetupState | null
  readonly collectionState: MandateNotifyState | null
  readonly cancelState: MandateCancelCommandState | null
  readonly latestDuePeriod: string | null
  readonly lastStatusCheckedAt: Date | null
  readonly updatedAt: Date
}

export interface AdminMandateDetail {
  readonly mandate: PaymentMandate
  readonly sip: SipPlan
  readonly setupAttempts: readonly MandateSetupAttempt[]
  readonly collectionAttempts: readonly MandateCollectionAttempt[]
  readonly cancelCommands: readonly MandateCancelCommand[]
}

export interface ListMandatesInput {
  /** Row budget as sent, including the caller's over-fetch row. */
  readonly limit: number
  readonly after?: Readonly<{ updatedAt: Date; id: string }>
  readonly state?: MandateState
  readonly attention?: boolean
}

export interface FindMandateForCancelResult {
  readonly mandate: PaymentMandate
  readonly sip: SipPlan
}

export interface CreateCancelCommandInput {
  readonly mandateId: string
  readonly sipPlanId: string
  readonly userId: string
  readonly merchantSubscriptionId: string
  readonly previousMandateState: "setup_pending" | "active" | "paused"
}

const ATTENTION_MANDATE_STATES: readonly MandateState[] = [
  "setup_pending",
  "active",
  "pause_pending",
  "paused",
  "cancel_pending",
  "revoke_pending",
]

const PENDING_SETUP_STATES: readonly MandateSetupState[] = ["created", "dispatching", "provider_pending"]
const PENDING_COLLECTION_STATES: readonly MandateNotifyState[] = ["created", "dispatching"]
const PENDING_CANCEL_STATES: readonly MandateCancelCommandState[] = ["queued", "dispatching", "reconciliation_required"]

export interface AdminMandateRepository {
  listMandates: (tx: Transaction, input: ListMandatesInput) => Promise<readonly AdminMandateListRow[]>
  findMandateDetail: (tx: Transaction, mandateId: string) => Promise<AdminMandateDetail | null>
  findMandateForCancel: (tx: Transaction, mandateId: string) => Promise<FindMandateForCancelResult | null>
  createCancelCommand: (tx: Transaction, input: CreateCancelCommandInput) => Promise<MandateCancelCommand>
}

export const createAdminMandateRepository = (): AdminMandateRepository => {
  const mandatesRepository: MandatesRepository = createMandatesRepository()

  return {
    listMandates: async (tx, input) => {
      const afterUpdatedAt = input.after?.updatedAt
      const afterId = input.after?.id

      let query = sql<AdminMandateListRow>`
        with latest_setup as (
          select distinct on (mandate_id) mandate_id, state, due_period, updated_at
          from mandate_setup_attempts
          order by mandate_id, updated_at desc, id desc
        ),
        latest_collection as (
          select distinct on (mandate_id) mandate_id, notify_state as state, due_period, updated_at
          from mandate_collection_attempts
          order by mandate_id, updated_at desc, id desc
        ),
        latest_cancel as (
          select distinct on (mandate_id) mandate_id, state, updated_at
          from mandate_cancel_commands
          order by mandate_id, updated_at desc, id desc
        )
        select
          m.id as "id",
          m.sip_plan_id as "sipPlanId",
          m.user_id as "userId",
          u.email_normalized as "userEmail",
          u.full_name as "userName",
          m.fund_id as "fundId",
          fv.name as "fundName",
          sip.amount_paise::text as "amountPaise",
          sip.debit_day as "debitDay",
          sip.state as "sipState",
          m.state as "mandateState",
          ls.state as "setupState",
          lc.state as "collectionState",
          lcc.state as "cancelState",
          coalesce(lc.due_period::text, ls.due_period::text) as "latestDuePeriod",
          m.last_status_checked_at as "lastStatusCheckedAt",
          m.updated_at as "updatedAt"
        from payment_mandates m
        join sip_plans sip on sip.id = m.sip_plan_id
        join users u on u.id = m.user_id
        join funds f on f.id = m.fund_id
        left join fund_versions fv on fv.id = f.current_published_version_id
        left join latest_setup ls on ls.mandate_id = m.id
        left join latest_collection lc on lc.mandate_id = m.id
        left join latest_cancel lcc on lcc.mandate_id = m.id
        where true
      `

      if (input.state !== undefined) {
        query = sql<AdminMandateListRow>`${query} and m.state = ${input.state}::payment_mandate_state`
      }

      if (input.attention === true) {
        query = sql<AdminMandateListRow>`${query} and (
          m.state::text = any(${sql.val(ATTENTION_MANDATE_STATES as string[])}::text[])
          or ls.state::text = any(${sql.val(PENDING_SETUP_STATES as string[])}::text[])
          or lc.state::text = any(${sql.val(PENDING_COLLECTION_STATES as string[])}::text[])
          or lcc.state::text = any(${sql.val(PENDING_CANCEL_STATES as string[])}::text[])
        )`
      }

      if (afterUpdatedAt !== undefined && afterId !== undefined) {
        query = sql<AdminMandateListRow>`${query} and (m.updated_at, m.id) < (${afterUpdatedAt}, ${afterId})`
      }

      query = sql<AdminMandateListRow>`${query} order by m.updated_at desc, m.id desc limit ${input.limit}`

      const result = await query.execute(tx)
      return result.rows
    },

    findMandateDetail: async (tx, mandateId) => {
      const mandate = await tx.selectFrom("payment_mandates").selectAll().where("id", "=", mandateId).executeTakeFirst()
      if (mandate === undefined) return null
      const sip = await tx.selectFrom("sip_plans").selectAll().where("id", "=", mandate.sip_plan_id).executeTakeFirstOrThrow()
      const setupAttempts = await tx.selectFrom("mandate_setup_attempts").selectAll()
        .where("mandate_id", "=", mandateId)
        .orderBy("created_at", "desc").orderBy("id", "desc").execute()
      const collectionAttempts = await tx.selectFrom("mandate_collection_attempts").selectAll()
        .where("mandate_id", "=", mandateId)
        .orderBy("created_at", "desc").orderBy("id", "desc").execute()
      const cancelCommands = await tx.selectFrom("mandate_cancel_commands").selectAll()
        .where("mandate_id", "=", mandateId)
        .orderBy("created_at", "desc").orderBy("id", "desc").execute()
      return {
        mandate,
        sip,
        setupAttempts,
        collectionAttempts,
        cancelCommands,
      }
    },

    findMandateForCancel: async (tx, mandateId) => {
      const mandate = await tx.selectFrom("payment_mandates").selectAll()
        .where("id", "=", mandateId).forUpdate().executeTakeFirst()
      if (mandate === undefined) return null
      if (!(["setup_pending", "active", "paused"] as readonly MandateState[]).includes(mandate.state)) return null
      const sip = await tx.selectFrom("sip_plans").selectAll()
        .where("id", "=", mandate.sip_plan_id).forUpdate().executeTakeFirstOrThrow()
      if (mandate.state === "setup_pending" && mandate.abandonment_requested_at !== null) return null
      const existingCancel = await tx.selectFrom("mandate_cancel_commands").select("id")
        .where("mandate_id", "=", mandateId)
        .where("state", "in", PENDING_CANCEL_STATES)
        .executeTakeFirst()
      if (existingCancel !== undefined) return null
      return { mandate, sip }
    },

    createCancelCommand: async (tx, input) =>
      mandatesRepository.createCancelCommand(tx, {
        mandateId: input.mandateId,
        sipPlanId: input.sipPlanId,
        userId: input.userId,
        merchantSubscriptionId: input.merchantSubscriptionId,
        previousMandateState: input.previousMandateState,
      }),
  }
}
