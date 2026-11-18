import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"
import type {
  InvestmentGrowthBases,
  InvestmentGrowthPlan,
  PlannedInvestmentEntry,
  PlannedInvestmentPart,
} from "../domain/admin/investmentGrowth.js"
import {
  clientFundGrowthBases,
  type ClientFundGrowthBases,
  type InvestmentDescription,
} from "../domain/admin/investmentGrowthBases.js"
import { refKey } from "../domain/client/investmentBreakdownFacts.js"
import type { GrowthMailPart, WrittenGrowthEntry } from "../domain/email/investmentGrowthMail.js"
import { formatCalendarDate, formatRupeesFromPaise } from "../email/emailMoney.js"
import { AppError } from "../http/errorCatalog.js"
import type { ClientGrowthRepository } from "../repositories/clientGrowthRepository.js"
import type { InvestmentBreakdownRepository } from "../repositories/investmentBreakdownRepository.js"
import { investmentRefBody } from "./adminInvestmentProjection.js"

export interface FundGrowthBasesDeps {
  readonly clientGrowthRepository: Pick<ClientGrowthRepository, "listFundPositionBases">
  readonly investmentBreakdownRepository: Pick<InvestmentBreakdownRepository, "loadBreakdownContexts">
}

export interface LoadedFundGrowthBases {
  readonly bases: InvestmentGrowthBases
  readonly perUser: ReadonlyMap<string, ClientFundGrowthBases>
}

export const loadFundGrowthBases = async (
  deps: FundGrowthBasesDeps,
  db: Kysely<Database>,
  fundId: string,
  onlyUserId: string | null = null,
): Promise<LoadedFundGrowthBases> => {
  const userIds =
    onlyUserId === null ? (await deps.clientGrowthRepository.listFundPositionBases(db, fundId)).map((row) => row.userId) : [onlyUserId]
  const contexts = await deps.investmentBreakdownRepository.loadBreakdownContexts(db, userIds)
  const perUser = new Map(
    userIds.flatMap((userId) => {
      const input = contexts.get(userId)?.input
      const bases = input === undefined ? null : clientFundGrowthBases(userId, fundId, input)
      return bases === null ? [] : [[userId, bases] as const]
    }),
  )
  const all = [...perUser.values()]
  return {
    bases: { positions: all.map((entry) => entry.position), investments: all.flatMap((entry) => entry.investments) },
    perUser,
  }
}

const descriptionOf = (loaded: LoadedFundGrowthBases, userId: string, part: PlannedInvestmentPart): InvestmentDescription => {
  const description = loaded.perUser.get(userId)?.descriptions.get(refKey(part.ref))
  if (description === undefined) throw new AppError("INTERNAL_ERROR")
  return description
}

const labelOf = (description: InvestmentDescription, part: PlannedInvestmentPart): string => {
  if (description.kind === "sip") return "SIP"
  const name = description.kind === "one_time" ? "One-time investment" : "Investment"
  const amount = part.investedPaise >= 0n ? ` of ${formatRupeesFromPaise(part.investedPaise.toString())}` : ""
  const date = description.firstDate === null ? "" : ` from ${formatCalendarDate(description.firstDate)}`
  return `${name}${amount}${date}`
}

export const partBody = (loaded: LoadedFundGrowthBases, userId: string, part: PlannedInvestmentPart): Record<string, unknown> => ({
  ref: investmentRefBody(part.ref),
  label: labelOf(descriptionOf(loaded, userId, part), part),
  investedPaise: part.investedPaise.toString(),
  beforePaise: part.beforePaise.toString(),
  deltaPaise: part.deltaPaise.toString(),
  afterPaise: part.afterPaise.toString(),
})

export const entryBody = (loaded: LoadedFundGrowthBases, entry: PlannedInvestmentEntry): Record<string, unknown> => ({
  userId: entry.userId,
  beforePaise: entry.beforePaise.toString(),
  deltaPaise: entry.deltaPaise.toString(),
  afterPaise: entry.afterPaise.toString(),
  parts: entry.parts.map((part) => partBody(loaded, entry.userId, part)),
})

export const planBody = (loaded: LoadedFundGrowthBases, plan: InvestmentGrowthPlan): Record<string, unknown> => ({
  targetCount: plan.entries.length,
  totalDeltaPaise: plan.totalDeltaPaise.toString(),
  entries: plan.entries.map((entry) => entryBody(loaded, entry)),
  skipped: plan.skipped.map((skip) => ({
    userId: skip.userId,
    ref: skip.ref === null ? null : investmentRefBody(skip.ref),
    reason: skip.reason,
  })),
})

const mailPartOf = (loaded: LoadedFundGrowthBases, userId: string, part: PlannedInvestmentPart): GrowthMailPart => {
  const description = descriptionOf(loaded, userId, part)
  if (description.kind === "sip") return { kind: "sip", deltaPaise: part.deltaPaise }
  if (description.firstDate === null || part.investedPaise < 0n) throw new AppError("INTERNAL_ERROR")
  return { kind: description.kind, investedPaise: part.investedPaise, effectiveDate: description.firstDate, deltaPaise: part.deltaPaise }
}

export const mailEntryOf = (loaded: LoadedFundGrowthBases, entry: PlannedInvestmentEntry): WrittenGrowthEntry => ({
  userId: entry.userId,
  deltaPaise: entry.deltaPaise,
  parts: entry.parts.map((part) => mailPartOf(loaded, entry.userId, part)),
})
