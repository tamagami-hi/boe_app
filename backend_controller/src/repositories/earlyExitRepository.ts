import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { WithdrawalState } from "../db/types.js"

export interface SipEarlyExitRow {
  readonly id: string
  readonly scheduleId: string
  readonly userId: string
  readonly fundId: string
  readonly fundName: string
  readonly ledgerEntryId: string
  readonly amountPaise: string
  readonly principalBeforePaise: string
  readonly valueBeforePaise: string
  readonly cancelledMaturityScheduleId: string | null
  readonly cancelledMaturityDate: string | null
  readonly effectiveDate: string
  readonly createdAt: Date
  readonly payoutId: string
  readonly payoutState: WithdrawalState
  readonly payoutVersion: string
  readonly payoutGrowthPortionPaise: string
  readonly payoutPrincipalPortionPaise: string
  readonly payoutTransferReference: string | null
  readonly payoutFailureCode: string | null
  readonly payoutCreatedAt: Date
}

export interface InsertSipEarlyExitInput {
  readonly scheduleId: string
  readonly userId: string
  readonly fundId: string
  readonly ledgerEntryId: string
  readonly payoutId: string
  readonly amountPaise: bigint
  readonly principalBeforePaise: bigint
  readonly valueBeforePaise: bigint
  readonly cancelledMaturityScheduleId: string | null
  readonly effectiveDate: string
  readonly actorUserId: string
  readonly requestId: string
}

export interface SipEarlyExitRepository {
  insert: (tx: Transaction, input: InsertSipEarlyExitInput) => Promise<{ readonly id: string }>
  findForUser: (tx: Transaction, input: Readonly<{ userId: string; earlyExitId: string }>) => Promise<SipEarlyExitRow | null>
  listByUser: (tx: Transaction, userId: string) => Promise<readonly SipEarlyExitRow[]>
}

const EARLY_EXIT_SELECTION = sql`
  select
    x.id,
    x.schedule_id as "scheduleId",
    x.user_id as "userId",
    x.fund_id as "fundId",
    coalesce(fv.name, f.slug) as "fundName",
    x.ledger_entry_id as "ledgerEntryId",
    x.amount_paise::text as "amountPaise",
    x.principal_before_paise::text as "principalBeforePaise",
    x.value_before_paise::text as "valueBeforePaise",
    x.cancelled_maturity_schedule_id as "cancelledMaturityScheduleId",
    to_char(m.maturity_date, 'YYYY-MM-DD') as "cancelledMaturityDate",
    to_char(x.effective_date, 'YYYY-MM-DD') as "effectiveDate",
    x.created_at as "createdAt",
    w.id as "payoutId",
    w.state::text as "payoutState",
    w.version::text as "payoutVersion",
    w.growth_portion_paise::text as "payoutGrowthPortionPaise",
    w.principal_portion_paise::text as "payoutPrincipalPortionPaise",
    w.transfer_reference as "payoutTransferReference",
    w.failure_code as "payoutFailureCode",
    w.created_at as "payoutCreatedAt"
  from sip_early_exits x
  join withdrawal_operations w on w.id = x.payout_id
  join funds f on f.id = x.fund_id
  left join fund_versions fv on fv.id = f.current_published_version_id
  left join client_maturity_schedules m on m.id = x.cancelled_maturity_schedule_id
`

export const createSipEarlyExitRepository = (): SipEarlyExitRepository => ({
  insert: async (tx, input) =>
    tx
      .insertInto("sip_early_exits")
      .values({
        schedule_id: input.scheduleId,
        user_id: input.userId,
        fund_id: input.fundId,
        ledger_entry_id: input.ledgerEntryId,
        payout_id: input.payoutId,
        amount_paise: input.amountPaise,
        principal_before_paise: input.principalBeforePaise,
        value_before_paise: input.valueBeforePaise,
        cancelled_maturity_schedule_id: input.cancelledMaturityScheduleId,
        effective_date: input.effectiveDate,
        created_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  findForUser: async (tx, input) => {
    const result = await sql<SipEarlyExitRow>`
      ${EARLY_EXIT_SELECTION}
      where x.id = ${input.earlyExitId} and x.user_id = ${input.userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listByUser: async (tx, userId) => {
    const result = await sql<SipEarlyExitRow>`
      ${EARLY_EXIT_SELECTION}
      where x.user_id = ${userId}
      order by x.created_at desc, x.id desc
    `.execute(tx)
    return result.rows
  },
})
