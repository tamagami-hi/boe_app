import type {
  AdminClientInvestmentFund,
  AdminClientInvestmentsData,
  AdminEarlierGrowth,
  AdminInvestmentRef,
} from "@beonedge/contracts"

import { clientPagePath } from "~/features/admin/shared/clientPageLink"

export type InvestmentRef = AdminInvestmentRef

export type CleanupFund = AdminClientInvestmentFund

export type SplittableFund = CleanupFund & Readonly<{ earlierGrowth: AdminEarlierGrowth }>

export type CleanupCounts = Readonly<{
  uncategorised: number
  fundsWithUncategorised: number
  fundsNeedingSplit: number
}>

export const refKey = (ref: InvestmentRef): string =>
  ref.kind === "sip" ? `sip:${ref.scheduleId}` : `one_time:${ref.allocationId}`

export const needsSplit = (fund: CleanupFund): fund is SplittableFund => fund.earlierGrowth?.needsConfirmation === true

export const cleanupCountsOf = (data: AdminClientInvestmentsData): CleanupCounts => ({
  uncategorised: data.funds.reduce((count, fund) => count + fund.uncategorised.length, 0),
  fundsWithUncategorised: data.funds.filter((fund) => fund.uncategorised.length > 0).length,
  fundsNeedingSplit: data.funds.filter(needsSplit).length,
})

export const proposedAmountOf = (growth: AdminEarlierGrowth, ref: InvestmentRef): string =>
  growth.proposal.find((part) => refKey(part.ref) === refKey(ref))?.amountPaise ?? "0"

export const splitFormKeyOf = (fund: SplittableFund): string =>
  [fund.fundId, fund.earlierGrowth.cutoffEntryId, ...fund.investments.map((investment) => refKey(investment.ref))].join(":")

export const clientLedgerPath = (userId: string): string => `${clientPagePath(userId)}?tab=ledger`
