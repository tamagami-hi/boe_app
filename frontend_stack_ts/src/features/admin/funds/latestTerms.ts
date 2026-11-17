import type { getAdminFund } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { paiseToRupeeText } from "~/features/admin/client-values/rupeeAmount"

import type { FundTerms } from "./FundTermsForm"

export type FundDetail = DataOf<typeof getAdminFund>

type FundVersion = FundDetail["versions"][number]

export type LatestTerms =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; version: number; versionId: string; terms: FundTerms }>

const NONE: LatestTerms = { kind: "none" }
const UNREADABLE: LatestTerms = { kind: "unreadable" }

const newestOf = (versions: readonly FundVersion[]): FundVersion | null =>
  versions.reduce<FundVersion | null>((newest, entry) => (newest === null || entry.version > newest.version ? entry : newest), null)

export const latestTermsOf = (detail: FundDetail): LatestTerms => {
  const latest = newestOf(detail.versions)
  const { currentVersion } = detail.fund
  if (latest === null) return currentVersion === null ? NONE : UNREADABLE
  if (currentVersion !== null && !detail.versions.some((entry) => entry.version === currentVersion)) return UNREADABLE
  const disclosure = detail.disclosures.find((entry) => entry.id === latest.disclosureVersionId)
  if (disclosure === undefined) return UNREADABLE
  return {
    kind: "found",
    version: latest.version,
    versionId: latest.id,
    terms: {
      name: latest.name,
      category: latest.category,
      objective: latest.objective,
      riskLevel: latest.riskLevel,
      returnTier: latest.returnTier,
      minimumSipRupees: paiseToRupeeText(latest.minimumSipPaise),
      minimumPurchaseRupees: paiseToRupeeText(latest.minimumPurchasePaise),
      minimumDurationMonths: latest.minimumDurationMonths,
      recommendedHoldingMonths: latest.recommendedHoldingMonths,
      disclosure: { title: disclosure.title, body: disclosure.body },
    },
  }
}
