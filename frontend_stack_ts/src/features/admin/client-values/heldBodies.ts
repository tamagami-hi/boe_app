import { AdminRecordedContributionBody } from "@beonedge/contracts"
import type { z } from "zod"

import {
  appendAdminIndividualClientGrowth,
  commitAdminCollectiveClientGrowth,
  markAdminClientMatured,
  reinvestAdminClientMaturity,
  updateAdminWithdrawalPayout,
  withdrawAdminClientMaturity,
} from "~/api/generated/operations"
import { asRecord, parseWith } from "~/features/admin/shared/heldWriteStore"

import type {
  CollectiveGrowthCommitBody,
  CollectiveGrowthHold,
  IndividualGrowthBody,
  IndividualGrowthHold,
} from "./growthQueries"
import type { LedgerReversalBody } from "./ledgerReversalQueries"
import type { MarkMaturityBody, PayoutUpdateInput, SettlementInput } from "./maturityQueries"
import type { RecordedContributionBody } from "./recordingQueries"

const isText = (value: unknown): value is string => typeof value === "string" && value !== ""

const textOf = (record: Readonly<Record<string, unknown>> | null, key: string): string | null => {
  const value = record?.[key]
  return isText(value) ? value : null
}

const parseContribution = parseWith<AdminRecordedContributionBody>(AdminRecordedContributionBody)

export const parseRecordedContribution = (value: unknown): RecordedContributionBody | null => {
  const input = asRecord(value)
  const userId = textOf(input, "userId")
  if (input === null || userId === null) return null
  const body = parseContribution(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "userId")))
  return body === null ? null : { userId, ...body }
}

const parseIndividualBody = parseWith<IndividualGrowthBody>(appendAdminIndividualClientGrowth.request.body)

export const parseIndividualGrowth = (value: unknown): IndividualGrowthHold | null => {
  const body = parseIndividualBody(asRecord(value)?.body)
  return body === null ? null : { body }
}

const parseCollectiveBody = parseWith<CollectiveGrowthCommitBody>(commitAdminCollectiveClientGrowth.request.body)

export const parseCollectiveCommit = (value: unknown): CollectiveGrowthHold | null => {
  const body = parseCollectiveBody(asRecord(value)?.body)
  return body === null ? null : { body }
}

export const parseLedgerReversal = (value: unknown): LedgerReversalBody | null => {
  const input = asRecord(value)
  const userId = textOf(input, "userId")
  const entryId = textOf(input, "entryId")
  const reasonCode = textOf(input, "reasonCode")
  return userId === null || entryId === null || reasonCode === null ? null : { userId, entryId, reasonCode }
}

export const parseMarkMaturity = parseWith<MarkMaturityBody>(markAdminClientMatured.request.body)

const parseWithdrawal = parseWith<z.input<typeof withdrawAdminClientMaturity.request.body>>(
  withdrawAdminClientMaturity.request.body,
)
const parseReinvestment = parseWith<z.input<typeof reinvestAdminClientMaturity.request.body>>(
  reinvestAdminClientMaturity.request.body,
)

export const parseSettlement = (value: unknown): SettlementInput | null => {
  const input = asRecord(value)
  const maturityId = textOf(input, "maturityId")
  if (input === null || maturityId === null) return null
  if (input.kind === "withdrawal") {
    const body = parseWithdrawal(input.body)
    return body === null ? null : { kind: "withdrawal", maturityId, body }
  }
  if (input.kind !== "reinvestment") return null
  const body = parseReinvestment(input.body)
  return body === null ? null : { kind: "reinvestment", maturityId, body }
}

const parsePayoutBody = parseWith<PayoutUpdateInput["body"]>(updateAdminWithdrawalPayout.request.body)

export const parsePayoutUpdate = (value: unknown): PayoutUpdateInput | null => {
  const input = asRecord(value)
  const payoutId = textOf(input, "payoutId")
  if (input === null || payoutId === null) return null
  const body = parsePayoutBody(input.body)
  return body === null ? null : { payoutId, body }
}
