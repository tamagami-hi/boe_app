/**
 * Admin catalog repository.
 *
 * A fund is a pool of money, not a priced instrument. So this repository handles:
 *   - the fund and its published version (terms + disclosure, no price); and
 *   - the administrator-curated stock list investors see, tagged by quarter.
 *
 * The pool's size is read from `fund_aum_snapshots` (the latest published
 * snapshot wins); writing snapshots belongs to the AUM instruction flow.
 *
 * Money is `bigint` paise crossing the boundary as strings. Published versions,
 * disclosures, and AUM snapshots are append-only; only the fund's lifecycle state,
 * its current-version pointer, and a stock's own row are ever updated.
 */
import { sql } from "kysely"

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
  /** Latest published AUM snapshot, and the date it is effective as of. */
  readonly aumPaise: string | null
  readonly aumAsOfDate: string | null
  readonly aumUpdatedAt: Date | null
  /** Count of active stocks on the disclosed list. */
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
  readonly effectiveFrom: Date
  readonly createdAt: Date
}

export interface FundPageQuery {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  readonly limit: number
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
  findOne: (tx: Transaction, fundId: string) => Promise<FundListRow | null>
  lock: (tx: Transaction, fundId: string) => Promise<Fund | null>
  slugExists: (tx: Transaction, slug: string) => Promise<boolean>
  insertFund: (tx: Transaction, input: InsertFundInput) => Promise<Fund>
  setState: (tx: Transaction, input: SetFundStateInput) => Promise<Fund>
  setCurrentVersion: (
    tx: Transaction,
    input: { readonly fundId: string; readonly versionId: string; readonly now: Date },
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
    fv.name as "name",
    fv.category as "category",
    fv.objective as "objective",
    fv.risk_level as "riskLevel",
    fv.return_tier as "returnTier",
    fv.currency as "currency",
    fv.minimum_sip_paise::text as "minimumSipPaise",
    fv.minimum_purchase_paise::text as "minimumPurchasePaise",
    fv.version as "currentVersion",
    aum.aum_paise::text as "aumPaise",
    aum.as_of_date::text as "aumAsOfDate",
    aum.created_at as "aumUpdatedAt",
    coalesce(stocks.count, 0)::int as "stockCount",
    f.published_at as "publishedAt",
    f.created_at as "createdAt",
    f.updated_at as "updatedAt",
    f.version::text as "version"
  from funds f
  left join fund_versions fv on fv.id = f.current_published_version_id
  left join lateral (
    select aum_paise, as_of_date, created_at from fund_aum_snapshots
    where fund_id = f.id
    order by as_of_date desc, revision desc, created_at desc, id desc limit 1
  ) aum on true
  left join lateral (
    select count(*) as count from fund_stock_disclosures
    where fund_id = f.id and state = 'active'
  ) stocks on true
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
    const keyset =
      query.afterCreatedAt !== undefined && query.afterId !== undefined
        ? sql`where (f.created_at < ${query.afterCreatedAt}
            or (f.created_at = ${query.afterCreatedAt} and f.id < ${query.afterId}))`
        : sql``
    const result = await sql<FundListRow>`
      ${FUND_SELECT} ${keyset}
      order by f.created_at desc, f.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
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
        ...(input.state === "published" ? { published_at: input.now } : {}),
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
        state: "published",
        published_at: sql`coalesce(published_at, ${input.now})`,
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
      returning id as "id", version as "version", title as "title",
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
      select id as "id", version as "version", title as "title",
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
