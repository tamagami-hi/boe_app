import { isoOrNull } from "./adminRouteKit.js"

export interface FundTermsRow {
  readonly name: string | null
  readonly category: string | null
  readonly objective: string | null
  readonly riskLevel: string | null
  readonly returnTier: string | null
  readonly currency: string | null
  readonly minimumSipPaise: string | null
  readonly minimumPurchasePaise: string | null
}

export interface FundSizeRow {
  readonly aumPaise: string | null
  readonly aumAsOfDate: string | null
  readonly aumUpdatedAt: Date | null
}

export const mapFundTerms = (row: FundTermsRow): Record<string, unknown> => ({
  name: row.name,
  category: row.category,
  objective: row.objective,
  riskLevel: row.riskLevel,
  returnTier: row.returnTier,
  currency: row.currency ?? "INR",
  minimumSipPaise: row.minimumSipPaise,
  minimumPurchasePaise: row.minimumPurchasePaise,
})

export const mapFundSize = (
  row: FundSizeRow,
): Readonly<{ aumPaise: string; asOfDate: string | null; updatedAt: string | null }> | null =>
  row.aumPaise === null
    ? null
    : {
        aumPaise: row.aumPaise,
        asOfDate: row.aumAsOfDate,
        updatedAt: isoOrNull(row.aumUpdatedAt),
      }
