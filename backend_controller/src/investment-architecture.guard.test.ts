import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

/**
 * Guards the greenfield investment-fund architecture (core mechanism spec §4.1,
 * §9.2, §12.3).
 *
 * The unit/NAV era is gone: ownership is dated client value entries, payments
 * settle through PhonePe into an admin review, and growth is posted by batch.
 * Reintroducing a deleted module, letting a client serializer leak admin-only
 * review fields, or crossing the payment/AUM/growth dependency walls would
 * silently fork the money model, so this fails the build rather than letting
 * that happen.
 */

/** Modules removed by the reset, with their replacements. */
const DELETED_MODULES: readonly string[] = [
  // Order/payment lifecycle replaced by the PhonePe checkout + review flow:
  // routes/clientOrderRoutes.ts keeps only order creation; later waves rebuild
  // begin/confirm on payment_attempts + provider_events.
  "domain/client/beginPayment.ts",
  "domain/client/bookOrder.ts",
  "domain/client/confirmPayment.ts",
  "domain/client/settlePayment.ts",
  // Pool-gain allocation replaced by client_growth_batches (017) writing
  // client_value_entries growth adjustments (018).
  "domain/client/allocateGain.ts",
  "domain/admin/poolGainDistribution.ts",
  "domain/admin/poolGainDistribution.test.ts",
  // Redemptions are out of the model; so are mandates and the SIP scheduler.
  "domain/client/requestRedemption.ts",
  "domain/client/settleRedemption.ts",
  "domain/client/sip.ts",
  "domain/client/activateMandate.ts",
  "domain/client/generateSipInstallments.ts",
  // Repositories whose tables no longer exist.
  "repositories/investorLedgerRepository.ts",
  "repositories/redemptionRepository.ts",
  "repositories/mandateRepository.ts",
  "repositories/sipRepository.ts",
  "repositories/paymentRepository.ts",
  // Routes/workers for the retired flows; the PhonePe callback route is rebuilt
  // against provider_events by a later wave.
  "routes/paymentWebhookRoutes.ts",
  "routes/mandateWebhookRoutes.ts",
  "routes/clientSipRoutes.ts",
  "paymentWorker.ts",
  "paymentWorker.test.ts",
  "sipWorker.ts",
  "sipWorker.test.ts",
]

/**
 * Dropped tables. Nothing in `src/` may name them — not even `db/types.ts`,
 * which no longer declares them. (This file lists them in literals, which is
 * why the scan below skips test files.)
 */
const DROPPED_TABLES: readonly string[] = [
  "fund_aum_updates",
  "investor_ledger_entries",
  "redemption_requests",
  "fund_nav_prices",
  "holding_lots",
  "holding_lot_movements",
  "investment_executions",
]

/** Client responses never carry admin-only review/allocation fields (§9.2). */
const CLIENT_FORBIDDEN_FIELDS: readonly string[] = [
  "allocationId",
  "bankVerified",
  "reviewer",
  "privateNote",
]

const listSourceFiles = async (): Promise<readonly string[]> => {
  const root = fileURLToPath(new URL("./", import.meta.url))
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => `${entry.parentPath.slice(root.length)}/${entry.name}`.replace(/^\//u, ""))
}

/** Compare code only: a doc comment explaining a retirement is not a reference. */
const codeOf = async (relativePath: string): Promise<string> =>
  (await readFile(fileURLToPath(new URL(`./${relativePath}`, import.meta.url)), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "")

const isPaymentModule = (path: string): boolean =>
  /^repositories\/payment/iu.test(path) ||
  /^routes\/payment/iu.test(path) ||
  /^domain\/[^/]+\/payment/iu.test(path) ||
  /^providers\//u.test(path)

const isAumModule = (path: string): boolean => /aum/iu.test(path)

const isClientGrowthModule = (path: string): boolean =>
  /clientGrowth/iu.test(path) || /client_growth/iu.test(path)

describe("investment architecture guard", () => {
  test.each(DELETED_MODULES)("%s remains deleted", (relativePath) => {
    const absolutePath = fileURLToPath(new URL(`./${relativePath}`, import.meta.url))
    expect(existsSync(absolutePath)).toBe(false)
  })

  test("no module references a dropped table", async () => {
    const files = await listSourceFiles()
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(".test.ts")) continue
      const code = await codeOf(file)
      for (const table of DROPPED_TABLES) {
        if (code.includes(table)) offenders.push(`${file}: ${table}`)
      }
      // `mandates`/`holdings` as bare table names (word-boundary, snake plural).
      // db/seedContent.ts is marketing copy ("portfolio holdings"), not SQL.
      if (file === "db/seedContent.ts") continue
      if (/\bholdings\b/u.test(code)) offenders.push(`${file}: holdings`)
      if (/\bmandates\b/u.test(code)) offenders.push(`${file}: mandates`)
    }

    expect(offenders).toEqual([])
  })

  test("client route serializers never leak admin-only review fields", async () => {
    const files = await listSourceFiles()
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(".test.ts")) continue
      if (!/^routes\/client/iu.test(file)) continue
      const code = await codeOf(file)
      for (const field of CLIENT_FORBIDDEN_FIELDS) {
        if (code.includes(field)) offenders.push(`${file}: ${field}`)
      }
    }

    expect(offenders).toEqual([])
  })

  test("the §4.1 dependency walls hold: payments, AUM, and client growth stay separate", async () => {
    const files = await listSourceFiles()
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(".test.ts")) continue
      const code = await codeOf(file)
      if (isPaymentModule(file)) {
        // Payment code never reaches into the value/AUM side of the model.
        if (/aum|clientValue|client_value|growth/iu.test(code)) offenders.push(`${file}: payment -> aum/value/growth`)
      } else if (isAumModule(file)) {
        // AUM code never reaches into payments, reviews, or client values.
        if (/payment|review|allocation|clientValue|client_value/iu.test(code)) {
          offenders.push(`${file}: aum -> payment/review/allocation/client_value`)
        }
      } else if (isClientGrowthModule(file)) {
        // Client growth never reads AUM repositories.
        if (/aum/iu.test(code)) offenders.push(`${file}: client growth -> aum`)
      }
    }

    expect(offenders).toEqual([])
  })

  test("the portfolio derivation is the only source of an investor's balances", async () => {
    const code = await codeOf("domain/client/portfolioLedger.ts")
    expect(code).not.toMatch(/\bnav\b/iu)
    expect(code).not.toMatch(/\bunits\b/iu)
  })
})
