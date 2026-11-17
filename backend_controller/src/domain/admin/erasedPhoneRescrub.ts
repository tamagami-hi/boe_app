import type { Kysely } from "kysely"

import type { Transaction } from "../../db/repositories.js"
import type { Database } from "../../db/types.js"
import type { ClientErasureInspectRepository } from "../../repositories/clientErasureInspectRepository.js"
import type { ClientErasureWriteRepository } from "../../repositories/clientErasureWriteRepository.js"
import type { ErasedClientRepository } from "../../repositories/erasedClientRepository.js"
import { CLIENT_SCRUB_TARGETS, RECEIPT_SCRUB_TARGET, scrubTarget } from "../../repositories/erasureScrubTargets.js"
import { ERASED_PHONE, erasedEmailFor, type ContactScrubber } from "./erasureContacts.js"
import { mentionsIndianMobile, replaceIndianMobiles, walkJsonStrings } from "./erasurePhoneForms.js"

export interface ErasedPhoneRescrubDeps {
  readonly erasedClientRepository: ErasedClientRepository
  readonly erasureInspectRepository: Pick<ClientErasureInspectRepository, "listOwnedEntities">
  readonly erasureWriteRepository: Pick<ClientErasureWriteRepository, "markErasing">
}

export interface RescrubbedRow {
  readonly table: string
  readonly id: string
}

export interface ErasedPhoneRescrubReport {
  readonly mode: "dry_run" | "applied"
  readonly erasedClients: number
  readonly tables: Readonly<Record<string, number>>
  readonly rows: readonly RescrubbedRow[]
}

interface RescrubFindings {
  readonly erasedClients: number
  readonly rows: readonly RescrubbedRow[]
}

const RESCRUB_TARGETS = [...CLIENT_SCRUB_TARGETS, RECEIPT_SCRUB_TARGET]
const HISTORY_TABLE = "user_contact_history"
const RESCRUB_TABLES = [...RESCRUB_TARGETS.map(({ table }) => table), HISTORY_TABLE]

const scrubMobiles = (value: string): string => replaceIndianMobiles(value, ERASED_PHONE)

export const mobilePatternScrubber: ContactScrubber = {
  emails: [],
  phones: [],
  text: scrubMobiles,
  ownText: scrubMobiles,
  json: (value) => walkJsonStrings(value, scrubMobiles),
  mentions: mentionsIndianMobile,
}

const rescrubClient = async (
  tx: Transaction,
  deps: ErasedPhoneRescrubDeps,
  userId: string,
): Promise<readonly RescrubbedRow[]> => {
  const applicationIds = await deps.erasedClientRepository.listErasedApplications(tx, userId, erasedEmailFor(userId))
  const owned = await deps.erasureInspectRepository.listOwnedEntities(tx, { id: userId }, applicationIds)
  const owner = { userId, applicationIds, owned }
  const rows: RescrubbedRow[] = []
  for (const target of RESCRUB_TARGETS) {
    const ids = await scrubTarget(tx, target, owner, mobilePatternScrubber)
    rows.push(...ids.map((id) => ({ table: target.table, id })))
  }
  await deps.erasureWriteRepository.markErasing(tx, userId)
  const reasons = await deps.erasedClientRepository.clearHistoryReasons(tx, userId, mobilePatternScrubber.mentions)
  return [...rows, ...reasons.map((id) => ({ table: HISTORY_TABLE, id }))]
}

const rescrubAll = async (tx: Transaction, deps: ErasedPhoneRescrubDeps): Promise<RescrubFindings> => {
  const clients = await deps.erasedClientRepository.listErasedClients(tx)
  const rows: RescrubbedRow[] = []
  for (const userId of clients) rows.push(...(await rescrubClient(tx, deps, userId)))
  return { erasedClients: clients.length, rows }
}

const countsByTable = (rows: readonly RescrubbedRow[]): Readonly<Record<string, number>> =>
  Object.fromEntries(RESCRUB_TABLES.map((table) => [table, rows.filter((row) => row.table === table).length]))

export const runErasedPhoneRescrub = async (
  database: Kysely<Database>,
  deps: ErasedPhoneRescrubDeps,
  options: Readonly<{ apply: boolean }>,
): Promise<ErasedPhoneRescrubReport> => {
  const tx = await database.startTransaction().execute()
  const found = await rescrubAll(tx, deps).catch(async (error: unknown) => {
    await tx.rollback().execute()
    throw error
  })
  await (options.apply ? tx.commit() : tx.rollback()).execute()
  return {
    mode: options.apply ? "applied" : "dry_run",
    erasedClients: found.erasedClients,
    tables: countsByTable(found.rows),
    rows: found.rows,
  }
}
