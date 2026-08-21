import { sql } from "kysely"

export const LATEST_SNAPSHOT_ORDER = sql`as_of_date desc, revision desc, created_at desc, id desc`

export const LATEST_SNAPSHOT_PER_FUND_ORDER = sql`fund_id asc, ${LATEST_SNAPSHOT_ORDER}`

export const LATEST_SNAPSHOT_LATERAL = sql`
  left join lateral (
    select aum_paise, as_of_date, created_at from fund_aum_snapshots
    where fund_id = f.id
    order by ${LATEST_SNAPSHOT_ORDER} limit 1
  ) aum on true
`

export const ACTIVE_STOCK_COUNT_LATERAL = sql`
  left join lateral (
    select count(*) as count from fund_stock_disclosures
    where fund_id = f.id and state = 'active'
  ) stocks on true
`

export const FUND_AUM_PROJECTION = sql`
  aum.aum_paise::text as "aumPaise",
  aum.as_of_date::text as "aumAsOfDate",
  aum.created_at as "aumUpdatedAt",
  coalesce(stocks.count, 0)::int as "stockCount"
`

export const FUND_TERMS_PROJECTION = sql`
  fv.name as "name",
  fv.category as "category",
  fv.objective as "objective",
  fv.risk_level as "riskLevel",
  fv.return_tier as "returnTier",
  fv.currency as "currency",
  fv.minimum_sip_paise::text as "minimumSipPaise",
  fv.minimum_purchase_paise::text as "minimumPurchasePaise",
  fv.version as "currentVersion"
`
