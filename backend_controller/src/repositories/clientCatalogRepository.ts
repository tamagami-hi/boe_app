/**
 * Client fund-catalog read repository — Option B (model document sections C/D).
 *
 * A pool is described to investors by:
 *   - its terms (name, category, objective, risk level, return tier, minimums);
 *   - its **Fund Size (AUM)**: the latest published monthly closing figure, plus
 *     the date it was last updated; and
 *   - its **Fund Portfolio**: the administrator-curated stock list, each entry
 *     tagged with the quarter it was added.
 *
 * There is no per-unit price, so nothing here reads `fund_nav_prices`. Only funds
 * in state `published` are visible. Money is `bigint` paise crossing as strings.
 */
import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { FundReturnTier, FundRiskLevel } from "../db/types.js"

export interface ClientFundRow {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly category: string
  readonly objective: string
  readonly riskLevel: FundRiskLevel
  readonly returnTier: FundReturnTier | null
  readonly currency: string
  readonly minimumSipPaise: string
  readonly minimumPurchasePaise: string
  readonly minimumDurationMonths: number | null
  readonly recommendedHoldingMonths: number | null
  readonly currentVersionId: string
  readonly currentVersion: number
  /** Latest published AUM snapshot ("Fund Size"), null before the first snapshot. */
  readonly aumPaise: string | null
  /** The date the AUM snapshot is effective as of, and when it was published. */
  readonly aumAsOfDate: string | null
  readonly aumUpdatedAt: Date | null
  readonly stockCount: number
  readonly publishedAt: Date | null
  readonly createdAt: Date
}

export interface ClientFundStockRow {
  readonly stockName: string
  readonly quarterLabel: string
  readonly weightPercent: string | null
  readonly sortOrder: number
}

export interface ClientFundDisclosureRow {
  readonly version: number
  readonly title: string
  readonly body: string
  readonly effectiveFrom: Date
}

export interface ClientCatalogRepository {
  listPublished: (
    tx: Transaction,
    query: { readonly afterCreatedAt?: Date; readonly afterId?: string; readonly limit: number },
  ) => Promise<readonly ClientFundRow[]>
  findPublished: (tx: Transaction, fundId: string) => Promise<ClientFundRow | null>
  /** Active stock list only: exited positions are admin history, not disclosure. */
  listStocks: (tx: Transaction, fundId: string) => Promise<readonly ClientFundStockRow[]>
  findDisclosure: (tx: Transaction, fundId: string) => Promise<ClientFundDisclosureRow | null>
}

const FUND_SELECT = sql`
  select
    f.id as "id",
    f.slug as "slug",
    fv.name as "name",
    fv.category as "category",
    fv.objective as "objective",
    fv.risk_level as "riskLevel",
    fv.return_tier as "returnTier",
    fv.currency as "currency",
    fv.minimum_sip_paise::text as "minimumSipPaise",
    fv.minimum_purchase_paise::text as "minimumPurchasePaise",
    fv.minimum_duration_months as "minimumDurationMonths",
    fv.recommended_holding_months as "recommendedHoldingMonths",
    fv.id as "currentVersionId",
    fv.version as "currentVersion",
    aum.aum_paise::text as "aumPaise",
    aum.as_of_date::text as "aumAsOfDate",
    aum.created_at as "aumUpdatedAt",
    coalesce(stocks.count, 0)::int as "stockCount",
    f.published_at as "publishedAt",
    f.created_at as "createdAt"
  from funds f
  join fund_versions fv on fv.id = f.current_published_version_id
  left join lateral (
    select aum_paise, as_of_date, created_at from fund_aum_snapshots
    where fund_id = f.id
    order by as_of_date desc, revision desc, created_at desc, id desc limit 1
  ) aum on true
  left join lateral (
    select count(*) as count from fund_stock_disclosures
    where fund_id = f.id and state = 'active'
  ) stocks on true
  where f.state = 'published'
`

export const createClientCatalogRepository = (): ClientCatalogRepository => ({
  listPublished: async (tx, query) => {
    const keyset =
      query.afterCreatedAt !== undefined && query.afterId !== undefined
        ? sql`and (f.created_at < ${query.afterCreatedAt}
            or (f.created_at = ${query.afterCreatedAt} and f.id < ${query.afterId}))`
        : sql``
    const result = await sql<ClientFundRow>`
      ${FUND_SELECT} ${keyset}
      order by f.created_at desc, f.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  findPublished: async (tx, fundId) => {
    const result = await sql<ClientFundRow>`${FUND_SELECT} and f.id = ${fundId}`.execute(tx)
    return result.rows[0] ?? null
  },

  listStocks: async (tx, fundId) => {
    const result = await sql<ClientFundStockRow>`
      select stock_name as "stockName", quarter_label as "quarterLabel",
             weight_percent::text as "weightPercent", sort_order as "sortOrder"
      from fund_stock_disclosures
      where fund_id = ${fundId} and state = 'active'
      order by sort_order asc, stock_name asc
    `.execute(tx)
    return result.rows
  },

  findDisclosure: async (tx, fundId) => {
    const result = await sql<ClientFundDisclosureRow>`
      select d.version as "version", d.title as "title", d.body as "body",
             d.effective_from as "effectiveFrom"
      from funds f
      join fund_versions fv on fv.id = f.current_published_version_id
      join fund_disclosure_versions d on d.id = fv.disclosure_version_id
      where f.id = ${fundId}
    `.execute(tx)
    return result.rows[0] ?? null
  },
})
