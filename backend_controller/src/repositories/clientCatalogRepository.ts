import { sql } from "kysely"

import {
  ACTIVE_STOCK_COUNT_LATERAL,
  FUND_AUM_PROJECTION,
  FUND_TERMS_PROJECTION,
  LATEST_SNAPSHOT_LATERAL,
} from "./fundAumOrdering.js"

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
  readonly aumPaise: string | null
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
  listStocks: (tx: Transaction, fundId: string) => Promise<readonly ClientFundStockRow[]>
  findDisclosure: (tx: Transaction, fundId: string) => Promise<ClientFundDisclosureRow | null>
}

const FUND_SELECT = sql`
  select
    f.id as "id",
    f.slug as "slug",
    ${FUND_TERMS_PROJECTION},
    fv.minimum_duration_months as "minimumDurationMonths",
    fv.recommended_holding_months as "recommendedHoldingMonths",
    fv.id as "currentVersionId",
    ${FUND_AUM_PROJECTION},
    f.published_at as "publishedAt",
    f.created_at as "createdAt"
  from funds f
  join fund_versions fv on fv.id = f.current_published_version_id
  ${LATEST_SNAPSHOT_LATERAL}
  ${ACTIVE_STOCK_COUNT_LATERAL}
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
