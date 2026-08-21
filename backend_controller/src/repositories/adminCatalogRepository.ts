import { sql } from "kysely"

import {
  ACTIVE_STOCK_COUNT_LATERAL,
  FUND_AUM_PROJECTION,
  FUND_TERMS_PROJECTION,
  LATEST_SNAPSHOT_LATERAL,
} from "./fundAumOrdering.js"
import type { Fund, FundVersion, Transaction } from "../db/repositories.js"
import type { FundReturnTier, FundRiskLevel, FundState } from "../db/types.js"

export interface FundListRow {
  readonly id: string
  readonly slug: string
  readonly state: FundState
  readonly currentVersionId: string | null
  readonly name: string | null
  readonly category: string | null
  readonly objective: string | null
  readonly riskLevel: FundRiskLevel | null
  readonly returnTier: FundReturnTier | null
  readonly currency: string | null
  readonly minimumSipPaise: string | null
  readonly minimumPurchasePaise: string | null
  readonly currentVersion: number | null
  readonly aumPaise: string | null
  readonly aumAsOfDate: string | null
  readonly aumUpdatedAt: Date | null
  readonly stockCount: number
  readonly publishedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
}

export interface FundVersionRow {
  readonly id: string
  readonly version: number
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
  readonly disclosureVersionId: string
  readonly createdAt: Date
}

export interface StockDisclosureRow {
  readonly id: string
  readonly stockName: string
  readonly quarterLabel: string
  readonly weightPercent: string | null
  readonly state: string
  readonly sortOrder: number
  readonly exitedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface DisclosureRow {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly body: string
  readonly effectiveFrom: Date
  readonly createdAt: Date
}

export interface FundPageQuery {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  readonly limit: number
  readonly state?: FundState
  readonly search?: string
}

export interface FundStateSummary {
  readonly total: number
  readonly byState: Readonly<Record<FundState, number>>
}

export interface InsertFundInput {
  readonly slug: string
  readonly createdByUserId: string
}

export interface InsertDisclosureInput {
  readonly fundId: string
  readonly version: number
  readonly title: string
  readonly body: string
  readonly contentSha256: Buffer
  readonly effectiveFrom: Date
  readonly publishedByUserId: string
}

export interface InsertFundVersionInput {
  readonly fundId: string
  readonly version: number
  readonly name: string
  readonly category: string
  readonly objective: string
  readonly riskLevel: FundRiskLevel
  readonly returnTier: FundReturnTier | null
  readonly minimumSipPaise: string
  readonly minimumPurchasePaise: string
  readonly minimumDurationMonths: number | null
  readonly recommendedHoldingMonths: number | null
  readonly disclosureVersionId: string
  readonly termsSha256: Buffer
  readonly createdByUserId: string
}

export interface InsertStockInput {
  readonly fundId: string
  readonly stockName: string
  readonly quarterLabel: string
  readonly weightPercent: string | null
  readonly sortOrder: number
  readonly addedByUserId: string
}

export interface UpdateStockInput {
  readonly stockName: string
  readonly quarterLabel: string
  readonly weightPercent: string | null
  readonly sortOrder: number
}

export interface SetFundStateInput {
  readonly fundId: string
  readonly state: FundState
  readonly now: Date
}

export interface AdminCatalogRepository {
  list: (tx: Transaction, query: FundPageQuery) => Promise<readonly FundListRow[]>
  countByState: (tx: Transaction) => Promise<FundStateSummary>
  findOne: (tx: Transaction, fundId: string) => Promise<FundListRow | null>
  lock: (tx: Transaction, fundId: string) => Promise<Fund | null>
  slugExists: (tx: Transaction, slug: string) => Promise<boolean>
  insertFund: (tx: Transaction, input: InsertFundInput) => Promise<Fund>
  setState: (tx: Transaction, input: SetFundStateInput) => Promise<Fund>
  setCurrentVersion: (
    tx: Transaction,
    input: { readonly fundId: string; readonly versionId: string },
  ) => Promise<Fund>

  nextVersion: (tx: Transaction, fundId: string) => Promise<number>
  nextDisclosureVersion: (tx: Transaction, fundId: string) => Promise<number>
  insertDisclosure: (tx: Transaction, input: InsertDisclosureInput) => Promise<DisclosureRow>
  insertVersion: (tx: Transaction, input: InsertFundVersionInput) => Promise<FundVersion>
  listVersions: (tx: Transaction, fundId: string) => Promise<readonly FundVersionRow[]>
  listDisclosures: (tx: Transaction, fundId: string) => Promise<readonly DisclosureRow[]>

  listStocks: (tx: Transaction, fundId: string) => Promise<readonly StockDisclosureRow[]>
  findStock: (tx: Transaction, fundId: string, stockId: string) => Promise<StockDisclosureRow | null>
  insertStock: (tx: Transaction, input: InsertStockInput) => Promise<StockDisclosureRow>
  updateStock: (
    tx: Transaction,
    fundId: string,
    stockId: string,
    input: UpdateStockInput,
  ) => Promise<StockDisclosureRow>
  markStockExited: (tx: Transaction, fundId: string, stockId: string, now: Date) => Promise<StockDisclosureRow>
}

const FUND_SELECT = sql`
  select
    f.id as "id",
    f.slug as "slug",
    f.state as "state",
    f.current_published_version_id as "currentVersionId",
    ${FUND_TERMS_PROJECTION},
    ${FUND_AUM_PROJECTION},
    f.published_at as "publishedAt",
    f.created_at as "createdAt",
    f.updated_at as "updatedAt",
    f.version::text as "version"
  from funds f
  left join fund_versions fv on fv.id = f.current_published_version_id
  ${LATEST_SNAPSHOT_LATERAL}
  ${ACTIVE_STOCK_COUNT_LATERAL}
`

const STOCK_COLUMNS = sql`
  id as "id",
  stock_name as "stockName",
  quarter_label as "quarterLabel",
  weight_percent::text as "weightPercent",
  state as "state",
  sort_order as "sortOrder",
  exited_at as "exitedAt",
  created_at as "createdAt",
  updated_at as "updatedAt"
`

export const createAdminCatalogRepository = (): AdminCatalogRepository => ({
  list: async (tx, query) => {
    const conditions = [
      query.afterCreatedAt !== undefined && query.afterId !== undefined
        ? sql`(f.created_at, f.id) < (${query.afterCreatedAt}, ${query.afterId}::uuid)`
        : null,
      query.state === undefined ? null : sql`f.state = ${query.state}::fund_state`,
      query.search === undefined
        ? null
        : sql`(f.slug ilike ${`%${query.search}%`} or fv.name ilike ${`%${query.search}%`})`,
    ].filter((condition) => condition !== null)
    const where = conditions.length === 0
      ? sql``
      : sql`where ${sql.join(conditions, sql` and `)}`
    const result = await sql<FundListRow>`
      ${FUND_SELECT} ${where}
      order by f.created_at desc, f.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  countByState: async (tx) => {
    const result = await sql<{ state: FundState; count: string }>`
      select state as "state", count(*)::text as "count" from funds group by state
    `.execute(tx)
    const byState: Record<FundState, number> = {
      draft: 0,
      published: 0,
      paused: 0,
      archived: 0,
    }
    let total = 0
    for (const row of result.rows) {
      const count = Number(row.count)
      byState[row.state] = count
      total += count
    }
    return { total, byState }
  },

  findOne: async (tx, fundId) => {
    const result = await sql<FundListRow>`${FUND_SELECT} where f.id = ${fundId}`.execute(tx)
    return result.rows[0] ?? null
  },

  lock: async (tx, fundId) => {
    const result = await sql<Fund>`select * from funds where id = ${fundId} for update`.execute(tx)
    return result.rows[0] ?? null
  },

  slugExists: async (tx, slug) => {
    const row = await tx.selectFrom("funds").select("id").where("slug", "=", slug).executeTakeFirst()
    return row !== undefined
  },

  insertFund: async (tx, input) =>
    tx
      .insertInto("funds")
      .values({ slug: input.slug, state: "draft", created_by_user_id: input.createdByUserId })
      .returningAll()
      .executeTakeFirstOrThrow(),

  setState: async (tx, input) =>
    tx
      .updateTable("funds")
      .set({
        state: input.state,
        ...(input.state === "published"
          ? { published_at: sql`coalesce(published_at, ${input.now})` }
          : {}),
        ...(input.state === "paused" ? { paused_at: input.now } : {}),
        ...(input.state === "archived" ? { archived_at: input.now } : {}),
        updated_at: sql`now()`,
        version: sql`version + 1`,
      })
      .where("id", "=", input.fundId)
      .returningAll()
      .executeTakeFirstOrThrow(),

  setCurrentVersion: async (tx, input) =>
    tx
      .updateTable("funds")
      .set({
        current_published_version_id: input.versionId,
        updated_at: sql`now()`,
        version: sql`version + 1`,
      })
      .where("id", "=", input.fundId)
      .returningAll()
      .executeTakeFirstOrThrow(),

  nextVersion: async (tx, fundId) => {
    const result = await sql<{ next: number }>`
      select coalesce(max(version), 0) + 1 as "next" from fund_versions where fund_id = ${fundId}
    `.execute(tx)
    return Number(result.rows[0]?.next ?? 1)
  },

  nextDisclosureVersion: async (tx, fundId) => {
    const result = await sql<{ next: number }>`
      select coalesce(max(version), 0) + 1 as "next"
      from fund_disclosure_versions where fund_id = ${fundId}
    `.execute(tx)
    return Number(result.rows[0]?.next ?? 1)
  },

  insertDisclosure: async (tx, input) => {
    const result = await sql<DisclosureRow>`
      insert into fund_disclosure_versions
        (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id)
      values (${input.fundId}, ${input.version}, ${input.title}, ${input.body},
              ${input.contentSha256}, ${input.effectiveFrom}, ${input.publishedByUserId})
      returning id as "id", version as "version", title as "title", body as "body",
                effective_from as "effectiveFrom", created_at as "createdAt"
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("fund_disclosure_versions insert returned no row")
    return row
  },

  insertVersion: async (tx, input) =>
    tx
      .insertInto("fund_versions")
      .values({
        fund_id: input.fundId,
        version: input.version,
        name: input.name,
        category: input.category,
        objective: input.objective,
        risk_level: input.riskLevel,
        return_tier: input.returnTier,
        minimum_sip_paise: input.minimumSipPaise,
        minimum_purchase_paise: input.minimumPurchasePaise,
        minimum_duration_months: input.minimumDurationMonths,
        recommended_holding_months: input.recommendedHoldingMonths,
        disclosure_version_id: input.disclosureVersionId,
        terms_sha256: input.termsSha256,
        created_by_user_id: input.createdByUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  listVersions: async (tx, fundId) => {
    const result = await sql<FundVersionRow>`
      select
        id as "id", version as "version", name as "name", category as "category",
        objective as "objective", risk_level as "riskLevel", return_tier as "returnTier",
        currency as "currency", minimum_sip_paise::text as "minimumSipPaise",
        minimum_purchase_paise::text as "minimumPurchasePaise",
        minimum_duration_months as "minimumDurationMonths",
        recommended_holding_months as "recommendedHoldingMonths",
        disclosure_version_id as "disclosureVersionId", created_at as "createdAt"
      from fund_versions where fund_id = ${fundId}
      order by version desc
    `.execute(tx)
    return result.rows
  },

  listDisclosures: async (tx, fundId) => {
    const result = await sql<DisclosureRow>`
      select id as "id", version as "version", title as "title", body as "body",
             effective_from as "effectiveFrom", created_at as "createdAt"
      from fund_disclosure_versions where fund_id = ${fundId}
      order by version desc
    `.execute(tx)
    return result.rows
  },

  listStocks: async (tx, fundId) => {
    const result = await sql<StockDisclosureRow>`
      select ${STOCK_COLUMNS} from fund_stock_disclosures
      where fund_id = ${fundId}
      order by state asc, sort_order asc, stock_name asc
    `.execute(tx)
    return result.rows
  },

  findStock: async (tx, fundId, stockId) => {
    const result = await sql<StockDisclosureRow>`
      select ${STOCK_COLUMNS} from fund_stock_disclosures
      where fund_id = ${fundId} and id = ${stockId}
    `.execute(tx)
    return result.rows[0] ?? null
  },

  insertStock: async (tx, input) => {
    const result = await sql<StockDisclosureRow>`
      insert into fund_stock_disclosures
        (fund_id, stock_name, quarter_label, weight_percent, sort_order, added_by_user_id)
      values (${input.fundId}, ${input.stockName}, ${input.quarterLabel},
              ${input.weightPercent}::numeric, ${input.sortOrder}, ${input.addedByUserId})
      returning ${STOCK_COLUMNS}
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("fund_stock_disclosures insert returned no row")
    return row
  },

  updateStock: async (tx, fundId, stockId, input) => {
    const result = await sql<StockDisclosureRow>`
      update fund_stock_disclosures set
        stock_name = ${input.stockName},
        quarter_label = ${input.quarterLabel},
        weight_percent = ${input.weightPercent}::numeric,
        sort_order = ${input.sortOrder},
        updated_at = now()
      where fund_id = ${fundId} and id = ${stockId}
      returning ${STOCK_COLUMNS}
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("fund_stock_disclosures update returned no row")
    return row
  },

  markStockExited: async (tx, fundId, stockId, now) => {
    const result = await sql<StockDisclosureRow>`
      update fund_stock_disclosures set state = 'exited', exited_at = ${now}, updated_at = now()
      where fund_id = ${fundId} and id = ${stockId}
      returning ${STOCK_COLUMNS}
    `.execute(tx)
    const row = result.rows[0]
    if (row === undefined) throw new Error("fund_stock_disclosures exit returned no row")
    return row
  },
})
