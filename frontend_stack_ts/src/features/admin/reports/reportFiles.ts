import { indiaDateTimeText, paiseToRupeeText, toCsv } from "./reportCsv"
import type { ClientBalance, MonthContribution } from "./reportQueries"

const BYTE_ORDER_MARK = "﻿"
const REVOKE_DELAY_MS = 1_000

const BALANCE_HEADER = [
  "As of date (IST)",
  "Client name",
  "Client email",
  "Client ID",
  "Fund",
  "Fund ID",
  "Invested (INR)",
  "Value (INR)",
] as const

const CONTRIBUTION_HEADER = [
  "Entry ID",
  "Effective date",
  "Recorded at (IST)",
  "Client name",
  "Client email",
  "Client ID",
  "Fund",
  "Fund ID",
  "Category",
  "Amount (INR)",
  "Reversed",
  "Reversed at (IST)",
] as const

const byText = (left: string, right: string): number => left.localeCompare(right, "en-IN")

const compareBalances = (left: ClientBalance, right: ClientBalance): number =>
  byText(left.clientName, right.clientName) ||
  byText(left.userId, right.userId) ||
  byText(left.fundName, right.fundName) ||
  byText(left.fundId, right.fundId)

const compareContributions = (left: MonthContribution, right: MonthContribution): number =>
  byText(left.effectiveDate, right.effectiveDate) ||
  byText(left.recordedAt, right.recordedAt) ||
  byText(left.entryId, right.entryId)

export const balancesCsv = (asOfDate: string, rows: readonly ClientBalance[]): string =>
  toCsv(
    BALANCE_HEADER,
    [...rows]
      .sort(compareBalances)
      .map((row) => [
        asOfDate,
        row.clientName,
        row.clientEmail,
        row.userId,
        row.fundName,
        row.fundId,
        paiseToRupeeText(row.investedPaise),
        paiseToRupeeText(row.valuePaise),
      ]),
  )

export const contributionsCsv = (rows: readonly MonthContribution[]): string =>
  toCsv(
    CONTRIBUTION_HEADER,
    [...rows]
      .sort(compareContributions)
      .map((row) => [
        row.entryId,
        row.effectiveDate,
        indiaDateTimeText(row.recordedAt),
        row.clientName,
        row.clientEmail,
        row.userId,
        row.fundName,
        row.fundId,
        row.categoryLabel,
        paiseToRupeeText(row.amountPaise),
        row.reversedAt === null ? "No" : "Yes",
        row.reversedAt === null ? "" : indiaDateTimeText(row.reversedAt),
      ]),
  )

export const saveCsvFile = (fileName: string, csv: string): void => {
  const url = URL.createObjectURL(new Blob([BYTE_ORDER_MARK, csv], { type: "text/csv;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.rel = "noopener"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, REVOKE_DELAY_MS)
}
