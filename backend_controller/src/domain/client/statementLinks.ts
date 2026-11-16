import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ClientValueEntryRepository } from "../../repositories/clientValueEntryRepository.js"
import type { SipEarlyExitRepository } from "../../repositories/earlyExitRepository.js"
import type { StatementLinkRepository } from "../../repositories/statementLinkRepository.js"
import { derivePortfolio } from "./portfolioLedger.js"
import { toLedgerEntries } from "./portfolioProjection.js"
import { deriveStatements, type StatementPeriod } from "./statements.js"

const PERIOD_ORDER_MESSAGE = "The first month must not be after the last month."

export interface StatementLinkDeps {
  readonly statementLinkRepository: StatementLinkRepository
  readonly clientValueEntryRepository: Pick<ClientValueEntryRepository, "listByUser">
  readonly sipEarlyExitRepository: Pick<SipEarlyExitRepository, "listByUser">
  readonly crypto: Pick<CryptoContext, "generateVerificationToken" | "hashToken">
  readonly clock: () => Date
  readonly config: Readonly<{ linkTtlMs: number }>
}

export interface StatementLinkRequest {
  readonly userId: string
  readonly fromPeriod: string
  readonly toPeriod: string
}

export interface IssuedStatementLink {
  readonly token: string
}

export interface StatementEarlyExit {
  readonly fundName: string
  readonly effectiveDate: string
  readonly amountPaise: bigint
}

export interface StatementDocument {
  readonly holderName: string
  readonly preparedAt: Date
  readonly fromPeriod: string
  readonly toPeriod: string
  readonly periods: readonly StatementPeriod[]
  readonly lastUpdated: string | null
  readonly earlyExits: readonly StatementEarlyExit[]
}

export type OpenedStatementLink =
  | Readonly<{ kind: "statement"; document: StatementDocument }>
  | Readonly<{ kind: "unavailable" }>

const statementsOf = async (tx: Transaction, deps: StatementLinkDeps, userId: string) => {
  const entries = toLedgerEntries(await deps.clientValueEntryRepository.listByUser(tx, userId))
  return { periods: deriveStatements(entries), lastUpdated: derivePortfolio(entries).lastActivityDate }
}

export const issueStatementLink = async (
  tx: Transaction,
  deps: StatementLinkDeps,
  input: StatementLinkRequest,
): Promise<IssuedStatementLink> => {
  if (input.fromPeriod > input.toPeriod) {
    throw new AppError("VALIDATION_FAILED", { fields: { toPeriod: [PERIOD_ORDER_MESSAGE] } })
  }
  if (!(await deps.statementLinkRepository.lockActiveClient(tx, input.userId))) throw new AppError("ACCOUNT_NOT_ACTIVE")
  const owned = new Set((await statementsOf(tx, deps, input.userId)).periods.map((period) => period.period))
  if (!owned.has(input.fromPeriod) || !owned.has(input.toPeriod)) throw new AppError("RESOURCE_NOT_FOUND")

  const now = deps.clock()
  const minted = deps.crypto.generateVerificationToken()
  const expiresAt = new Date(now.getTime() + deps.config.linkTtlMs)
  await deps.statementLinkRepository.issue(tx, {
    userId: input.userId,
    tokenHash: minted.hash,
    tokenKeyVersion: minted.keyVersion,
    fromPeriod: input.fromPeriod,
    toPeriod: input.toPeriod,
    expiresAt,
    now,
  })
  return { token: minted.token }
}

export const openStatementLink = async (
  tx: Transaction,
  deps: StatementLinkDeps,
  rawToken: string,
): Promise<OpenedStatementLink> => {
  const now = deps.clock()
  const link = await deps.statementLinkRepository.consume(tx, { tokenHash: deps.crypto.hashToken(rawToken).hash, now })
  if (link === null) return { kind: "unavailable" }

  const { periods, lastUpdated } = await statementsOf(tx, deps, link.userId)
  const covers = (date: string): boolean => date.slice(0, 7) >= link.fromPeriod && date.slice(0, 7) <= link.toPeriod
  const earlyExits = (await deps.sipEarlyExitRepository.listByUser(tx, link.userId))
    .filter((row) => covers(row.effectiveDate))
    .map((row) => ({ fundName: row.fundName, effectiveDate: row.effectiveDate, amountPaise: BigInt(row.amountPaise) }))
  return {
    kind: "statement",
    document: {
      holderName: link.fullName,
      preparedAt: now,
      fromPeriod: link.fromPeriod,
      toPeriod: link.toPeriod,
      periods: periods.filter((period) => period.period >= link.fromPeriod && period.period <= link.toPeriod).reverse(),
      lastUpdated,
      earlyExits,
    },
  }
}
