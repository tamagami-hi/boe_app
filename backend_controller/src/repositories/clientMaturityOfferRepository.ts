import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { ClientMaturityOfferState, ClientMaturityOption } from "../db/types.js"

export interface MaturityOfferFigures {
  readonly sipMonthlyAmountPaise: string
  readonly sipStartMonth: string
  readonly sipMonthCount: number
  readonly extensionMonths: number | null
  readonly nextMaturityDate: string | null
}

export interface LockedMaturityOffer extends MaturityOfferFigures {
  readonly id: string
  readonly maturityScheduleId: string
  readonly userId: string
  readonly fundId: string
  readonly state: ClientMaturityOfferState
  readonly chosenOption: ClientMaturityOption | null
  readonly version: string
}

export interface MaturityOfferRow extends LockedMaturityOffer {
  readonly fundName: string
  readonly maturityDate: string
  readonly chosenAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly closedAt: Date | null
}

export type ClosedOfferState = Exclude<ClientMaturityOfferState, "open">

export interface InsertMaturityOfferInput extends MaturityOfferFigures {
  readonly scheduleId: string
  readonly userId: string
  readonly fundId: string
  readonly actorUserId: string
  readonly requestId: string
}

interface VersionedOfferChange {
  readonly offerId: string
  readonly expectedVersion: string
  readonly now: Date
}

export interface ClientMaturityOfferRepository {
  insert: (tx: Transaction, input: InsertMaturityOfferInput) => Promise<Readonly<{ id: string }>>
  lockById: (tx: Transaction, offerId: string) => Promise<LockedMaturityOffer | null>
  lockOpenForSchedule: (tx: Transaction, scheduleId: string) => Promise<LockedMaturityOffer | null>
  choose: (tx: Transaction, input: VersionedOfferChange & Readonly<{ option: ClientMaturityOption }>) => Promise<boolean>
  close: (
    tx: Transaction,
    input: VersionedOfferChange & Readonly<{ state: ClosedOfferState; actorUserId: string }>,
  ) => Promise<boolean>
  findForUser: (tx: Transaction, input: Readonly<{ userId: string; offerId: string }>) => Promise<MaturityOfferRow | null>
  listOpenForUser: (tx: Transaction, userId: string) => Promise<readonly MaturityOfferRow[]>
}

const LOCK_COLUMNS = sql`
  o.id,
  o.maturity_schedule_id as "maturityScheduleId",
  o.user_id as "userId",
  o.fund_id as "fundId",
  o.state,
  o.chosen_option as "chosenOption",
  o.sip_monthly_amount_paise::text as "sipMonthlyAmountPaise",
  to_char(o.sip_start_month, 'YYYY-MM') as "sipStartMonth",
  o.sip_month_count as "sipMonthCount",
  o.extension_months as "extensionMonths",
  to_char(o.next_maturity_date, 'YYYY-MM-DD') as "nextMaturityDate",
  o.version::text as version
`

const ROW_COLUMNS = sql`
  ${LOCK_COLUMNS},
  coalesce(fv.name, f.slug) as "fundName",
  to_char(s.maturity_date, 'YYYY-MM-DD') as "maturityDate",
  o.chosen_at as "chosenAt",
  o.created_at as "createdAt",
  o.updated_at as "updatedAt",
  o.closed_at as "closedAt"
`

const ROW_SOURCE = sql`
  from client_maturity_offers o
  join client_maturity_schedules s on s.id = o.maturity_schedule_id
  join funds f on f.id = o.fund_id
  left join fund_versions fv on fv.id = f.current_published_version_id
`

const applied = (result: { readonly numAffectedRows?: bigint }): boolean => result.numAffectedRows === 1n

export const createClientMaturityOfferRepository = (): ClientMaturityOfferRepository => ({
  insert: async (tx, input) =>
    tx
      .insertInto("client_maturity_offers")
      .values({
        maturity_schedule_id: input.scheduleId,
        user_id: input.userId,
        fund_id: input.fundId,
        sip_monthly_amount_paise: input.sipMonthlyAmountPaise,
        sip_start_month: `${input.sipStartMonth}-01`,
        sip_month_count: input.sipMonthCount,
        extension_months: input.extensionMonths,
        next_maturity_date: input.nextMaturityDate,
        created_by_user_id: input.actorUserId,
        request_id: input.requestId,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),

  lockById: async (tx, offerId) => {
    const result = await sql<LockedMaturityOffer>`
      select ${LOCK_COLUMNS} from client_maturity_offers o where o.id = ${offerId} for update
    `.execute(tx)
    return result.rows[0] ?? null
  },

  lockOpenForSchedule: async (tx, scheduleId) => {
    const result = await sql<LockedMaturityOffer>`
      select ${LOCK_COLUMNS} from client_maturity_offers o
      where o.maturity_schedule_id = ${scheduleId} and o.state = 'open'
      for update
    `.execute(tx)
    return result.rows[0] ?? null
  },

  choose: async (tx, input) =>
    applied(
      await sql`
        update client_maturity_offers
        set chosen_option = ${input.option},
            chosen_at = ${input.now},
            updated_at = ${input.now},
            version = version + 1
        where id = ${input.offerId} and version = ${input.expectedVersion} and state = 'open'
      `.execute(tx),
    ),

  close: async (tx, input) =>
    applied(
      await sql`
        update client_maturity_offers
        set state = ${input.state},
            closed_by_user_id = ${input.actorUserId},
            closed_at = ${input.now},
            updated_at = ${input.now},
            version = version + 1
        where id = ${input.offerId} and version = ${input.expectedVersion} and state = 'open'
      `.execute(tx),
    ),

  findForUser: async (tx, input) => {
    const result = await sql<MaturityOfferRow>`
      select ${ROW_COLUMNS} ${ROW_SOURCE}
      where o.id = ${input.offerId} and o.user_id = ${input.userId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  listOpenForUser: async (tx, userId) => {
    const result = await sql<MaturityOfferRow>`
      select ${ROW_COLUMNS} ${ROW_SOURCE}
      where o.user_id = ${userId} and o.state = 'open'
      order by s.maturity_date, o.id
    `.execute(tx)
    return result.rows
  },
})
